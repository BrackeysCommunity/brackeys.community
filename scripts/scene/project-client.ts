import {
  HocuspocusProvider,
  HocuspocusProviderWebsocket,
  WebSocketStatus,
} from "@hocuspocus/provider";
import {
  applyProjectBatch,
  createProjectSession,
  docMeta,
  docToPrefab,
  docToScene,
  isPrefabDoc,
  isSeedStaleClose,
  layoutFromDoc,
  sessionPrefabSource,
  type AwarenessLike,
  type DocOrigin,
  type KeyGen,
  type OpenDoc,
  type OpenedDoc,
  type PrefabWriter,
  type ProjectApplyOptions,
  type ProjectSession,
  type SessionDoc,
} from "@jams/engine/collab";
import type { Registry } from "@jams/engine/game";
import {
  ContentStoreError,
  isSha256,
  SCENE_KIND_NAME,
  type AssetEntry,
  type AssetId,
  type ContentStore,
  type KindRegistry,
  type ProjectApplyResult,
  type ProjectId,
  type ProjectOpBatch,
  type ProjectView,
  type Sha256,
} from "@jams/engine/project";
import { formatScene, type SceneIssue } from "@jams/engine/scene";
import { PROJECT_ROUTE, SCENE_COLLAB_PATH } from "@jams/engine/vite";
import * as Y from "yjs";

import {
  createAgentSyncTokens,
  HostedError,
  hostedContentStore,
  hostedSite,
  isHostedUrl,
  isPlainHttpUrl,
  requireAgentToken,
  siteUrlRule,
  type AgentSyncTokens,
  type HostedSite,
  type HostedSyncToken,
} from "./hosted";
import { projectById, unknownProjectMessage, type ProjectHandle } from "./projects";

/** The dev server's collab endpoint (`package.json`'s `dev` script serves port 3000). */
export const DEFAULT_PROJECT_URL = `ws://localhost:3000${SCENE_COLLAB_PATH}`;
export const PROJECT_TIMEOUT_MS = 10_000;
/** The agent id a live batch is logged under when `--agent` is left out. */
export const DEFAULT_AGENT_ID = "scene-cli";

/** Why a live call couldn't go ahead; `exitCode` 2 is a usage error that `--project` fixes. */
export class ProjectClientError extends Error {
  constructor(
    message: string,
    readonly exitCode: 1 | 2 = 1,
  ) {
    super(message);
    this.name = "ProjectClientError";
  }
}

/** The `agent` origin for `--agent` and `--on-behalf-of`; the docs' logs name it as the actor. */
export function agentOrigin(flags: { agent?: string; onBehalfOf?: string } = {}): DocOrigin {
  return {
    kind: "agent",
    agentId: flags.agent || DEFAULT_AGENT_ID,
    ...(flags.onBehalfOf ? { onBehalfOf: flags.onBehalfOf } : {}),
  };
}

/** A sync token for one doc; asked for each time the doc authenticates. Null on the dev server. */
export type ProjectClientToken = (doc: string) => string | Promise<string>;

export type ProjectClientOptions = {
  project: ProjectId;
  /** The collab endpoint; default `DEFAULT_PROJECT_URL`. */
  url?: string;
  registry: Registry;
  kinds: KindRegistry;
  /** The client's origin, which undo tracks; default `agentOrigin()`. */
  origin?: DocOrigin;
  /** A hosted server's tokens; the dev server takes none. */
  token?: ProjectClientToken | null;
  /** How long connecting, a doc's first sync and a push may each take. */
  timeoutMs?: number;
  store?: ContentStore;
  buildAt?: number;
  prefabWriter?: PrefabWriter;
  key?: KeyGen;
  now?: () => number;
  /** A `WebSocket` constructor, for a runtime without a global one. */
  WebSocket?: unknown;
  /** Resolve instances against, and write prefab ops to, the project's prefab docs (`sessionPrefabSource`). */
  prefabs?: boolean;
};

export type ProjectClient = {
  readonly url: string;
  readonly origin: DocOrigin;
  readonly session: ProjectSession;
  /** Every doc this client has opened, in order, the project doc first. */
  readonly opened: readonly string[];
  /** Applies a batch as this client's origin and waits for the server to acknowledge it. */
  apply(batch: ProjectOpBatch, opts?: ProjectApplyOptions): Promise<ProjectApplyResult>;
  /**
   * What `apply` would do, worked out on copies of the docs: nothing reaches
   * the server. `store` stands in for the session's to inspect blobs from.
   */
  trial(
    batch: ProjectOpBatch,
    opts?: ProjectApplyOptions & { store?: ContentStore },
  ): Promise<ProjectApplyResult>;
  /** Resolves once the server has acknowledged every local change, in every doc opened. */
  pushed(): Promise<void>;
  /**
   * Waits for the push, then closes every doc and the socket; tears down even
   * when the push times out. Rejects with `seedStaleError` when a doc was
   * reseeded under the client: from then on every call fails with it.
   */
  close(): Promise<void>;
};

/**
 * The server reseeded `doc` (a lost cache, a reset row) while the client held
 * it: its copy came from the old seed, and reattaching would merge nothing it
 * can trust, so the command ends and is run again on the new seed.
 */
export function seedStaleError(doc: string): ProjectClientError {
  return new ProjectClientError(
    `The server reset ${doc} while this command had it open, so its copy is out of date; nothing more was sent. Run the command again.`,
  );
}

async function until(check: () => boolean, ms: number, what: string): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end)
      throw new ProjectClientError(`Timed out after ${ms}ms waiting for ${what}.`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** Resolves once the socket opens; rejects when it closes, or times out, first. */
function connected(
  socket: HocuspocusProviderWebsocket,
  url: string,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined = undefined;
    const settle = (error?: ProjectClientError) => {
      clearTimeout(timer);
      socket.off("open", onOpen);
      socket.off("close", onClose);
      if (error) reject(error);
      else resolve();
    };
    const local = /^wss?:\/\/(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);
    const unreachable = (why: string) =>
      new ProjectClientError(
        `Can't reach the project collab server at ${url} (${why})${local ? "; is `vp dev` running?" : "."}`,
      );
    const onOpen = () => settle();
    const onClose = () => settle(unreachable("the connection closed"));
    timer = setTimeout(() => settle(unreachable(`no answer in ${timeoutMs}ms`)), timeoutMs);
    if (socket.status === WebSocketStatus.Connected) return settle();
    socket.on("open", onOpen);
    socket.on("close", onClose);
  });
}

/**
 * The project `project` on a collab server, as a `ProjectSession` in Bun
 * or Node: one `HocuspocusProviderWebsocket`, and a `HocuspocusProvider`
 * on it for each doc the session opens. Only the project doc opens up
 * front; the rest open when a batch or a caller asks for them, and stay
 * open (and synced) until the client closes.
 */
export async function openProjectClient(opts: ProjectClientOptions): Promise<ProjectClient> {
  const url = opts.url ?? DEFAULT_PROJECT_URL;
  const timeoutMs = opts.timeoutMs ?? PROJECT_TIMEOUT_MS;
  const origin = opts.origin ?? agentOrigin();
  if (opts.WebSocket === undefined && typeof globalThis.WebSocket !== "function")
    throw new ProjectClientError(
      "This runtime has no global WebSocket; run the CLI under Bun or Node 22+.",
    );

  const socket = new HocuspocusProviderWebsocket({
    url,
    ...(opts.WebSocket === undefined ? {} : { WebSocketPolyfill: opts.WebSocket }),
  });
  try {
    await connected(socket, url, timeoutMs);
  } catch (e) {
    socket.destroy();
    throw e;
  }

  const providers = new Set<HocuspocusProvider>();
  /**
   * Each doc's provider, opened once and kept until the client closes. A doc
   * let go of stays synced, ready to open again: Hocuspocus can't take a doc
   * closed and reopened at once on one socket (the new provider reaches the
   * closing connection and never syncs), which a trial's copy followed by
   * the write would otherwise do.
   */
  const pool = new Map<string, Promise<OpenedDoc>>();
  const opened: string[] = [];
  let ended = false;
  /** Set once a doc was reseeded under the client: every call after fails with it. */
  let fatal: ProjectClientError | null = null;
  /** The opens still waiting for their first sync, rejected at once when the client fails. */
  const waiting = new Set<(error: ProjectClientError) => void>();
  const failClient = (error: ProjectClientError) => {
    if (fatal || ended) return;
    fatal = error;
    for (const reject of [...waiting]) reject(error);
    // Every doc shares the socket: destroying it stops each provider reattaching.
    socket.destroy();
  };
  const alive = () => {
    if (fatal) throw fatal;
  };

  const unsynced = () => [...providers].some((p) => p.hasUnsyncedChanges);

  const connectDoc = (name: string) =>
    new Promise<OpenedDoc>((resolve, reject) => {
      opened.push(name);
      const doc = new Y.Doc();
      let synced = false;
      let timer: ReturnType<typeof setTimeout> | undefined = undefined;
      const fail = (error: ProjectClientError) => {
        if (synced) return;
        waiting.delete(fail);
        clearTimeout(timer);
        providers.delete(provider);
        provider.destroy();
        doc.destroy();
        reject(error);
      };
      const refuse = (why: string) =>
        fail(new ProjectClientError(`The server refused ${name}: ${why}.`));
      const token = opts.token;
      const provider = new HocuspocusProvider({
        websocketProvider: socket,
        name,
        document: doc,
        token: token ? async () => token(name) : null,
        onSynced: ({ state }) => {
          if (!state || synced) return;
          const awareness = provider.awareness;
          if (!awareness)
            return fail(new ProjectClientError(`${name} synced without an awareness.`));
          synced = true;
          waiting.delete(fail);
          clearTimeout(timer);
          resolve({ doc, awareness, close() {} });
        },
        onAuthenticationFailed: ({ reason }) => refuse(reason || "authentication failed"),
        onClose: ({ event }) => {
          if (isSeedStaleClose(event.code, event.reason)) {
            const error = seedStaleError(name);
            fail(error);
            failClient(error);
          } else if (event.code >= 4000) refuse(event.reason || `close code ${event.code}`);
        },
      });
      providers.add(provider);
      waiting.add(fail);
      provider.attach();
      timer = setTimeout(
        () =>
          fail(
            new ProjectClientError(`Timed out after ${timeoutMs}ms waiting for ${name} to sync.`),
          ),
        timeoutMs,
      );
    });

  const openDoc: OpenDoc = (name) => {
    if (fatal) return Promise.reject(fatal);
    if (ended) return Promise.reject(new ProjectClientError("The project client is closed."));
    let pending = pool.get(name);
    if (!pending) {
      const connecting = connectDoc(name);
      pool.set(name, connecting);
      connecting.catch(() => {
        if (pool.get(name) === connecting) pool.delete(name);
      });
      pending = connecting;
    }
    return pending;
  };

  const sessionOptions = {
    project: opts.project,
    origin,
    registry: opts.registry,
    kinds: opts.kinds,
    ...(opts.store ? { store: opts.store } : {}),
    ...(opts.buildAt === undefined ? {} : { buildAt: opts.buildAt }),
    ...(opts.key ? { key: opts.key } : {}),
    ...(opts.now ? { now: opts.now } : {}),
  };
  let session: ProjectSession;
  let prefabSource: ReturnType<typeof sessionPrefabSource> | null = null;
  try {
    session = await createProjectSession({
      ...sessionOptions,
      openDoc,
      ...(opts.prefabWriter ? { prefabWriter: opts.prefabWriter } : {}),
    });
    if (opts.prefabs) {
      prefabSource = sessionPrefabSource(session);
      await prefabSource.ready();
    }
  } catch (e) {
    prefabSource?.destroy();
    for (const p of providers) p.destroy();
    socket.destroy();
    throw e;
  }

  /** A doc as the server has it now, copied from its pooled provider's. */
  const copyOf: OpenDoc = async (name) => {
    const state = Y.encodeStateAsUpdate((await openDoc(name)).doc);
    const doc = new Y.Doc();
    Y.applyUpdate(doc, state);
    return { doc, awareness: localAwareness(doc), close: () => doc.destroy() };
  };

  const pushed = () =>
    until(
      () => {
        alive();
        return !unsynced();
      },
      timeoutMs,
      "the server to acknowledge every change",
    );

  return {
    url,
    origin,
    session,
    opened,
    async apply(batch, applyOpts) {
      alive();
      const result = await applyProjectBatch(session, batch, origin, applyOpts);
      if (result.ok) await pushed();
      return result;
    },
    async trial(batch, { store, ...applyOpts } = {}) {
      alive();
      const scratch = await createProjectSession({
        ...sessionOptions,
        ...(store ? { store } : {}),
        openDoc: copyOf,
      });
      const prefabs = sessionPrefabSource(scratch);
      try {
        await prefabs.ready();
        return await applyProjectBatch(scratch, batch, origin, applyOpts);
      } finally {
        prefabs.destroy();
        scratch.destroy();
      }
    },
    pushed,
    async close() {
      if (ended) return;
      const failed = fatal;
      ended = true;
      try {
        if (!failed) await pushed();
      } finally {
        prefabSource?.destroy();
        session.destroy();
        for (const p of providers) {
          p.destroy();
          p.document.destroy();
        }
        providers.clear();
        pool.clear();
        socket.destroy();
      }
      if (failed) throw failed;
    },
  };
}

/** An awareness nobody else sees, for the docs a trial works on. */
function localAwareness(doc: Y.Doc): AwarenessLike {
  const states = new Map<number, Record<string, unknown>>();
  return {
    clientID: doc.clientID,
    getLocalState: () => states.get(doc.clientID) ?? null,
    setLocalStateField(field, value) {
      states.set(doc.clientID, { ...states.get(doc.clientID), [field]: value });
    },
    getStates: () => states,
    on() {},
    off() {},
  };
}

// ─── The dev server's HTTP routes ────────────────────────

/** `ws://host/__scene-collab` → `http://host/__project<path>`. */
export function projectRouteUrl(url: string, path = ""): string {
  const u = new URL(url);
  u.protocol = u.protocol === "wss:" ? "https:" : "http:";
  u.pathname = `${PROJECT_ROUTE}${path}`;
  u.search = "";
  return u.toString();
}

const unreachable = (url: string, why: string) =>
  new ProjectClientError(
    `Can't reach the project collab server at ${url} (${why}); is \`vp dev\` running?`,
  );

export type LiveProjectInfo = { id: ProjectId; name: string; game: string | null };

/** The projects a dev server serves (`GET /__project`); also how a live call finds out fast that no server is running. */
export async function listLiveProjects(
  url: string,
  timeoutMs = PROJECT_TIMEOUT_MS,
): Promise<LiveProjectInfo[]> {
  let listed: unknown;
  try {
    const res = await fetch(projectRouteUrl(url), { signal: AbortSignal.timeout(timeoutMs) });
    listed = ((await res.json()) as { projects?: unknown }).projects;
  } catch (e) {
    throw unreachable(url, (e as Error).message);
  }
  if (!Array.isArray(listed)) return [];
  return listed.flatMap((p: Partial<LiveProjectInfo> | null) =>
    typeof p?.id === "string"
      ? [{ id: p.id, name: typeof p.name === "string" ? p.name : p.id, game: p.game ?? null }]
      : [],
  );
}

/**
 * The dev server's content store for one project: `POST /__project/<id>/blob`
 * stores bytes (refused with `hash-mismatch` when they hash otherwise), and
 * `GET /__project/<id>/blob/<sha256>` reads them back.
 */
export function devContentStore(
  url: string,
  project: ProjectId,
  timeoutMs = PROJECT_TIMEOUT_MS,
): ContentStore {
  const blobUrl = (hash?: Sha256) =>
    projectRouteUrl(url, `/${encodeURIComponent(project)}/blob${hash ? `/${hash}` : ""}`);
  const get = async (hash: Sha256): Promise<Uint8Array | null> => {
    if (!isSha256(hash)) return null;
    const res = await fetch(blobUrl(hash), { signal: AbortSignal.timeout(timeoutMs) });
    if (res.status === 404) return null;
    if (!res.ok) throw new ProjectClientError(`GET ${blobUrl(hash)} answered ${res.status}.`);
    return new Uint8Array(await res.arrayBuffer());
  };
  return {
    async has(hash) {
      return (await get(hash)) !== null;
    },
    get,
    async put(bytes, expect) {
      let res: Response;
      try {
        res = await fetch(blobUrl(), {
          method: "POST",
          body: new Uint8Array(bytes),
          headers: {
            "content-type": "application/octet-stream",
            ...(expect ? { "x-expect-sha256": expect } : {}),
          },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (e) {
        throw unreachable(url, (e as Error).message);
      }
      const body = (await res.json().catch(() => ({}))) as {
        sha256?: unknown;
        error?: unknown;
        issue?: SceneIssue;
      };
      if (!res.ok && body.issue) throw new ContentStoreError(body.issue);
      if (!res.ok || typeof body.sha256 !== "string")
        throw new ProjectClientError(
          `The dev server refused the upload (${res.status}${typeof body.error === "string" ? `: ${body.error}` : ""}).`,
        );
      return body.sha256;
    },
  };
}

// ─── Finding a project on the server ─────────────────────

export type OpenLiveOptions = {
  /** The projects the CLI knows; the server's are matched to them by id. */
  projects: readonly ProjectHandle[];
  /** A dev collab server (`ws://…`), or a site (`https://…`) hosting the agent token's project. */
  url?: string;
  /** `--project`: only this one. On a hosted project, the CLI project whose game code judges it. */
  project?: ProjectId;
  /** The asset the call is about: a project whose live registry lacks it is passed over, and two that have it are ambiguous. */
  find?: { id: string; what: string; test: (view: ProjectView) => boolean };
  /** Ignored on a hosted project, where the actor is the agent token's. */
  origin?: DocOrigin;
  prefabs?: boolean;
  /** The call writes: a read-only agent token is refused before any doc opens. */
  write?: boolean;
  /** Hosted: `--token`, else `JAMS_AGENT_TOKEN` in `env`. */
  token?: string;
  env?: Readonly<Record<string, string | undefined>>;
  /** Hosted: the HTTP client the site is called with. */
  fetch?: typeof fetch;
  timeoutMs?: number;
  WebSocket?: unknown;
};

export type LiveProject = { project: ProjectHandle; client: ProjectClient };

/**
 * A client on the project the call is about, on a running dev server or,
 * for a site URL, on the agent token's hosted project. The dev server is
 * asked for its projects first, so a server that isn't running fails fast.
 * With `find`, each candidate project's registry is asked for the asset;
 * without it, the one project there is, or `--project`'s. Blobs go through
 * the server's content store.
 */
export async function openLiveProject(opts: OpenLiveOptions): Promise<LiveProject> {
  const url = opts.url ?? DEFAULT_PROJECT_URL;
  if (isHostedUrl(url)) return openHostedProject({ ...opts, url });
  if (isPlainHttpUrl(url)) throw new ProjectClientError(siteUrlRule(url), 2);
  const timeoutMs = opts.timeoutMs ?? PROJECT_TIMEOUT_MS;
  const served = new Set((await listLiveProjects(url, timeoutMs)).map((p) => p.id));
  let candidates = opts.projects.filter((p) => served.has(p.file.id));
  if (opts.project !== undefined) {
    const named = projectById(opts.projects, opts.project);
    if (!named) throw new ProjectClientError(unknownProjectMessage(opts.projects, opts.project), 2);
    if (!served.has(named.file.id))
      throw new ProjectClientError(
        `The collab server at ${url} doesn't serve project "${named.file.id}" (it serves ${[...served].join(", ") || "none"}).`,
      );
    candidates = [named];
  }
  const open = (project: ProjectHandle) =>
    openProjectClient({
      project: project.file.id,
      url,
      registry: project.registry,
      kinds: project.kinds,
      store: devContentStore(url, project.file.id, timeoutMs),
      timeoutMs,
      ...(opts.origin ? { origin: opts.origin } : {}),
      ...(opts.prefabs ? { prefabs: true } : {}),
      ...(opts.WebSocket === undefined ? {} : { WebSocket: opts.WebSocket }),
    });

  const { find } = opts;
  if (!find) {
    const [only, ...more] = candidates;
    if (!only || more.length > 0)
      throw new ProjectClientError(
        `pass --project to pick one of the collab server's projects (${candidates.map((p) => p.file.id).join(", ") || "none"})`,
        2,
      );
    return { project: only, client: await open(only) };
  }
  const hits: LiveProject[] = [];
  try {
    for (const project of candidates) {
      const client = await open(project);
      if (find.test(client.session.view())) hits.push({ project, client });
      else await client.close();
    }
  } catch (e) {
    await Promise.all(hits.map((h) => h.client.close()));
    throw e;
  }
  const [hit, ...rest] = hits;
  if (hit && rest.length === 0) return hit;
  await Promise.all(hits.map((h) => h.client.close()));
  if (!hit)
    throw new ProjectClientError(
      `The collab server at ${url} has no ${find.what} named ${JSON.stringify(find.id)}.`,
    );
  throw new ProjectClientError(
    `${JSON.stringify(find.id)} is a ${find.what} in more than one project (${hits.map((h) => h.project.file.id).join(", ")}); pass --project to pick one.`,
    2,
  );
}

// ─── Hosted projects ─────────────────────────────────────

/** A hosted call's refusal as the CLI reports it: a missing token or bad URL is a usage error. */
export function hostedFailure(error: unknown): unknown {
  if (!(error instanceof HostedError)) return error;
  return new ProjectClientError(
    error.message,
    error.code === "no-token" || error.code === "bad-url" ? 2 : 1,
  );
}

/**
 * The CLI project whose game code judges hosted project `id`: `--project`'s,
 * else the CLI's project of that id, as a handle carrying the hosted id.
 */
export function hostedCodeProject(
  projects: readonly ProjectHandle[],
  id: ProjectId,
  named?: ProjectId,
): ProjectHandle {
  const local = named === undefined ? projectById(projects, id) : projectById(projects, named);
  if (!local) {
    if (named !== undefined)
      throw new ProjectClientError(unknownProjectMessage(projects, named), 2);
    throw new ProjectClientError(
      `No project of the CLI's is "${id}": pass --project to name the one whose game code judges hosted project "${id}".`,
      2,
    );
  }
  return local.file.id === id ? local : { ...local, file: { ...local.file, id } };
}

/** The site client and sync tokens for an agent token: `--token`, else `JAMS_AGENT_TOKEN`. */
export function hostedAccess(opts: {
  url: string;
  token?: string;
  env?: Readonly<Record<string, string | undefined>>;
  fetch?: typeof fetch;
  projectId?: ProjectId;
  timeoutMs?: number;
}): { site: HostedSite; tokens: AgentSyncTokens } {
  try {
    const agentToken = requireAgentToken(opts.token, opts.env);
    const common = {
      site: opts.url,
      agentToken,
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
      ...(opts.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs }),
    };
    return {
      site: hostedSite(common),
      tokens: createAgentSyncTokens({
        ...common,
        ...(opts.projectId === undefined ? {} : { projectId: opts.projectId }),
      }),
    };
  } catch (error) {
    throw hostedFailure(error);
  }
}

/**
 * The agent token's project on the site `opts.url` hosts it on: the token
 * is traded for a sync token naming the project and the sync service, the
 * docs open there with the token's actor (its `g` and `o` claims) as the
 * origin, and blobs go through the site's blob routes. The game code comes
 * from the CLI's project of the same id, or `--project`'s.
 */
async function openHostedProject(opts: OpenLiveOptions & { url: string }): Promise<LiveProject> {
  const timeoutMs = opts.timeoutMs ?? PROJECT_TIMEOUT_MS;
  const { site, tokens } = hostedAccess({ ...opts, timeoutMs });
  let grant: HostedSyncToken;
  try {
    grant = await tokens.get();
  } catch (error) {
    throw hostedFailure(error);
  }
  if (opts.write && grant.access !== "write")
    throw new ProjectClientError(
      `The agent token for hosted project "${grant.projectId}" is read-only; this call writes.`,
    );
  const project = hostedCodeProject(opts.projects, grant.projectId, opts.project);
  const client = await openProjectClient({
    project: grant.projectId,
    url: grant.url,
    registry: project.registry,
    kinds: project.kinds,
    store: hostedContentStore(site, grant.projectId),
    token: () => tokens.token(),
    origin: {
      kind: "agent",
      agentId: grant.agentId,
      ...(grant.onBehalfOf ? { onBehalfOf: grant.onBehalfOf } : {}),
    },
    timeoutMs,
    ...(opts.prefabs ? { prefabs: true } : {}),
    ...(opts.WebSocket === undefined ? {} : { WebSocket: opts.WebSocket }),
  });
  const { find } = opts;
  if (find && !find.test(client.session.view())) {
    await client.close();
    throw new ProjectClientError(
      `Hosted project "${grant.projectId}" at ${site.origin} has no ${find.what} named ${JSON.stringify(find.id)}.`,
    );
  }
  return { project, client };
}

const sceneEntry = (view: ProjectView, id: string): AssetEntry | undefined => {
  const entry = view.byId.get(id);
  return entry?.kind === "scene" ? entry : undefined;
};

/** Finds a scene by id on the server, for `openLiveProject`. */
export const findScene = (id: string): NonNullable<OpenLiveOptions["find"]> => ({
  id,
  what: "scene",
  test: (view) => sceneEntry(view, id) !== undefined,
});

/** A scene as the dev server's doc has it now, unsaved edits included, in canonical form. */
export async function readLiveScene(
  opts: Omit<OpenLiveOptions, "find" | "origin" | "prefabs"> & { scene: string },
): Promise<{ text: string; project: ProjectId }> {
  const { project, client } = await openLiveProject({ ...opts, find: findScene(opts.scene) });
  try {
    const { session } = client;
    const entry = sceneEntry(session.view(), opts.scene)!;
    const name = session.docNameFor(entry);
    if (!name) throw new ProjectClientError(`${opts.scene} has no doc on the server.`);
    const opened = await session.open(name);
    try {
      if (!docMeta(opened.doc))
        throw new ProjectClientError(`${name} synced empty: the server didn't seed it.`);
      return { text: formatScene(docToScene(opened.doc)).text, project: project.file.id };
    } finally {
      session.release(name);
    }
  } finally {
    await client.close();
  }
}

/** The plain JSON a session doc holds; undefined for a doc no doc kind reads. */
function sessionDocValue(handle: SessionDoc, kind: string): unknown {
  if (handle.layout) return layoutFromDoc(handle.doc, handle.layout);
  if (kind === SCENE_KIND_NAME) return docMeta(handle.doc) ? docToScene(handle.doc) : undefined;
  if (isPrefabDoc(handle.doc)) return docToPrefab(handle.doc);
  return undefined;
}

/**
 * Every live doc asset's value as the server's docs hold it now, by id:
 * what `buildRefIndex` reads. Each doc is opened and let go of in turn.
 */
export async function readLiveValues(session: ProjectSession): Promise<Map<AssetId, unknown>> {
  const values = new Map<AssetId, unknown>();
  for (const entry of session.view().byId.values()) {
    if (session.kinds.get(entry.kind)?.storage !== "doc") continue;
    const name = session.docNameFor(entry);
    if (!name) continue;
    const opened = await session.open(name);
    try {
      const value = sessionDocValue(opened, entry.kind);
      if (value !== undefined) values.set(entry.id, value);
    } finally {
      session.release(name);
    }
  }
  return values;
}
