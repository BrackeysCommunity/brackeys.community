import { watch, type FSWatcher } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { sep } from "node:path";
import type { Duplex } from "node:stream";

import type { DirectConnection, Server as HocuspocusServer } from "@hocuspocus/server";
import * as Y from "yjs";

import { buildAtFrom, stampWins } from "../collab/build-stamp";
import { applyRepairs, reinspectBlobs } from "../collab/project-apply";
import {
  projectAssetsMap,
  projectBuildMap,
  projectCodeMap,
  readEntry,
  readProject,
} from "../collab/project-doc";
import { buildHashes } from "../collab/project-session";
import type { DocOrigin } from "../collab/types";
import type { ContentStore } from "../project/content-store";
import { docNameOf, parseDocName } from "../project/doc-names";
import type { KindEnv } from "../project/kinds";
import { buildRefIndex, referencedTrash } from "../project/refs";
import type { AssetId, AssetKey, ProjectId, ProjectState, ProjectView } from "../project/types";
import { projectView } from "../project/view";
import { ENGINE_VERSION } from "../version";
import { fileContentStore } from "./content-store";
import {
  handleProjectRequest,
  handleSceneRequest,
  projectSceneStore,
  sameOrigin,
  type ProjectSource,
  type SceneStore,
} from "./handler";
import {
  codeModules,
  createProjectFileAdapter,
  isCodePath,
  MOVE_SETTLE_MS,
  type AssetChange,
  type FileProject,
  type ProjectDiskSync,
  type ProjectFileAdapter,
} from "./project-files";

/** Where the dev server accepts collab websockets, for every doc: `project:`, `scene:` and `asset:`. */
export const SCENE_COLLAB_PATH = "/__scene-collab";

/** The stateless message type the server sends on a project doc when a binary's bytes change. */
export const ASSET_CHANGED = "asset:changed";

/** What an `asset:changed` stateless message holds, as JSON: hot reload refetches `sha256`. */
export type AssetChangedMessage = AssetChange & { type: typeof ASSET_CHANGED; project: ProjectId };

export type SceneCollabOptions = {
  /** The projects served; each doc name says which it belongs to. */
  projects: readonly FileProject[];
  /** The websocket path; defaults to `SCENE_COLLAB_PATH`. */
  path?: string;
  /** How long after the last edit a doc is written back, in ms. */
  debounceMs?: number;
  /** How long a file must be quiet before its change is read, in ms. */
  watchDelayMs?: number;
  /** How long an unlink and an add may be apart and still pair into a move, in ms; default `MOVE_SETTLE_MS`. */
  settleMs?: number;
  /** When this build was made, ms since the epoch: the build stamps the server writes. Default when the server starts. */
  buildAt?: number;
  /** Where refused disk changes, repairs and failed loads are reported; defaults to `console.warn`. */
  warn?: (message: string) => void;
  /**
   * The `@hocuspocus/server` module, for a host whose module loader is gone
   * by the time the first client connects (a config loaded through Vite's
   * `runnerImport`). Imported on first use when left out.
   */
  hocuspocus?: Pick<typeof import("@hocuspocus/server"), "Server">;
};

export type SceneCollab = {
  /** The in-process Hocuspocus server; it never listens on its own. */
  server: HocuspocusServer;
  /** Each project's file adapter, by project id. */
  adapters: ReadonlyMap<ProjectId, ProjectFileAdapter>;
  buildAt: number;
  /** The server's copy of a project doc, loading it if needed; it stays loaded while the server lives. */
  projectDoc(id: ProjectId): Promise<Y.Doc>;
  /** Takes an HTTP upgrade for the collab path; returns false for any other URL. */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean;
  /** Resolves once every queued file read and write has finished. */
  idle(): Promise<void>;
  destroy(): Promise<void>;
};

const pathOf = (req: IncomingMessage) => new URL(req.url ?? "/", "http://localhost").pathname;

/** A client that already hung up resets the socket; without a listener that error would crash the host. */
const ignoreErrors = (socket: Duplex) => {
  if (socket.listenerCount("error") === 0) socket.on("error", () => undefined);
};

function refuse(socket: Duplex, status: string): void {
  ignoreErrors(socket);
  if (socket.writable) socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
  else socket.destroy();
}

const BUILD_REPAIR: DocOrigin = { kind: "repair", reason: "build" };
const IN_USE_REPAIR = { kind: "repair", reason: "asset-in-use" } as const;
const HASH_REPAIR: DocOrigin = { kind: "repair", reason: "hash-mismatch" };
const REINSPECT_REPAIR = { kind: "repair", reason: "reinspect" } as const;

type Served = {
  project: FileProject;
  adapter: ProjectFileAdapter;
  store: ContentStore;
  name: string;
  env: KindEnv;
  /** What `reinspectBlobs` last checked each binary at. */
  checked: Map<AssetKey, string>;
  /** The last write `blockedWrite` reported, so a held path warns once. */
  blocked?: string;
  hold?: Promise<DirectConnection>;
};

/**
 * Hocuspocus over the projects' files, in this process. The server is each
 * project's one writer: it seeds `project:<id>` from a scan and each
 * `scene:` and `asset:` doc from its file (or from the state persisted in
 * the project's cache dir, with the file's difference applied as one
 * `disk` transaction), writes back canonical text, sidecars, moves and the
 * trash on store, persists every doc, and turns file changes under the
 * project into `disk` transactions and registry ops. On each store of a
 * project doc it repairs binaries whose bytes the content store lacks
 * (`hash-mismatch`), restores trashed assets a live doc it holds still
 * names (`asset-in-use`; a doc it loads later is judged as it loads), re-inspects binaries whose meta lags their bytes or
 * merged settings, and repairs duplicate ids and paths. It writes the code
 * map and this build's schema stamps when a project doc loads, and sends
 * `asset:changed` on the project doc whenever a binary's hash changes: on
 * disk, by a client's `replaceContent`, or by a repair. Needs
 * `@hocuspocus/server`, imported here and only here, and Node: its
 * websocket adapter refuses to run under Bun.
 */
export async function createSceneCollab(options: SceneCollabOptions): Promise<SceneCollab> {
  const { Server } = options.hocuspocus ?? (await import("@hocuspocus/server"));
  const path = options.path ?? SCENE_COLLAB_PATH;
  const warn = options.warn ?? ((m: string) => console.warn(`[scene-collab] ${m}`));
  const buildAt = options.buildAt === undefined ? Date.now() : buildAtFrom(options.buildAt);
  const settleMs = options.settleMs ?? MOVE_SETTLE_MS;
  const watchDelay = options.watchDelayMs ?? 30;

  const served = new Map<ProjectId, Served>();
  for (const project of options.projects) {
    const id = project.file.id;
    if (served.has(id)) throw new Error(`project "${id}" is served twice`);
    served.set(id, {
      project,
      adapter: createProjectFileAdapter(project, { settleMs }),
      store: fileContentStore(project.cacheDir),
      name: docNameOf({ kind: "project", project: id }),
      env: { registry: project.registry, project: null },
      checked: new Map(),
    });
  }

  const queues = new Map<string, Promise<unknown>>();
  function enqueue<T>(id: ProjectId, task: () => Promise<T>): Promise<T> {
    const run = (queues.get(id) ?? Promise.resolve()).then(task, task);
    const settled = run.catch(() => undefined);
    queues.set(id, settled);
    settled.then(() => {
      if (queues.get(id) === settled) queues.delete(id);
    });
    return run;
  }

  const report = (where: string, result: ProjectDiskSync) => {
    if (result.kind !== "refused") return;
    const first = result.issues?.[0];
    warn(`${where}: ${result.reason}${first ? ` (${first.code}: ${first.message})` : ""}`);
  };

  /**
   * A live entry whose path something unlisted on disk holds stays unwritten,
   * its content kept in the doc, until the path frees: say so once.
   */
  async function warnBlocked(s: Served, doc: Y.Doc): Promise<void> {
    const issue = await s.adapter.blockedWrite(doc);
    const message = issue ? `${s.project.file.id}: ${issue.code}: ${issue.message}` : undefined;
    if (message !== undefined && message !== s.blocked) warn(`${message}; not written yet`);
    s.blocked = message;
  }

  const docOf = (name: string): Y.Doc | undefined => server.hocuspocus.documents.get(name);

  function servedOf(documentName: string) {
    const ref = parseDocName(documentName);
    const s = ref ? served.get(ref.project) : undefined;
    if (!ref || !s)
      throw new Error(
        `${documentName} isn't a doc of a project this server holds (${[...served.keys()].join(", ")}); use project:<id>, scene:<id>.<key> or asset:<id>.<key>.`,
      );
    return { ref, s };
  }

  async function writeCode(s: Served, doc: Y.Doc): Promise<void> {
    const code = await codeModules(s.project);
    const map = projectCodeMap(doc);
    const hashes = await buildHashes(s.project.kinds, s.project.registry);
    const stamps = projectBuildMap(doc);
    doc.transact(() => {
      for (const [file, info] of Object.entries(code))
        if (JSON.stringify(map.get(file)) !== JSON.stringify(info)) map.set(file, info);
      for (const file of [...map.keys()]) if (!Object.hasOwn(code, file)) map.delete(file);
      for (const [kind, hash] of Object.entries(hashes)) {
        const stamp = stamps.get(kind);
        if (stamp?.hash === hash) continue;
        if (stamp && !stampWins(buildAt, hash, stamp)) continue;
        stamps.set(kind, { hash, buildAt, engine: ENGINE_VERSION });
      }
    }, BUILD_REPAIR);
  }

  /**
   * The registry's repairs, with each trashed asset that a live doc the
   * server holds still names restored (`asset-in-use`). Docs it hasn't
   * loaded aren't read: a forced delete stays trashed while its referrers
   * are closed, and one is judged when it loads (`loading`, which the
   * server doesn't list until its load hooks are done).
   */
  function restoreInUse(s: Served, doc: Y.Doc, loading?: { name: string; doc: Y.Doc }): void {
    const state = readProject(doc);
    const view = projectView(state, s.project.kinds);
    const restore = view.deleted.some((e) => !view.byId.has(e.id))
      ? inUse(s, state, view, loading)
      : [];
    const fixed = applyRepairs(doc, restore.length > 0 ? { restore, origin: IN_USE_REPAIR } : {});
    if (fixed.restored.length > 0)
      warn(
        `${s.name}: restored ${fixed.restored.map((k) => state.assets[k]?.id ?? k).join(", ")}, which a doc still names (asset-in-use).`,
      );
  }

  /** The trashed keys a held doc names. */
  function inUse(
    s: Served,
    state: ProjectState,
    view: ProjectView,
    loading?: { name: string; doc: Y.Doc },
  ): AssetKey[] {
    const values = new Map<AssetId, unknown>();
    const held = new Map(server.hocuspocus.documents as Map<string, Y.Doc>);
    if (loading) held.set(loading.name, loading.doc);
    for (const [name, doc] of held) {
      const ref = parseDocName(name);
      if (!ref || ref.kind === "project" || ref.project !== s.project.file.id) continue;
      const entry = state.assets[ref.key];
      if (!entry || entry.deleted) continue;
      try {
        const value = s.adapter.valueOf(name, doc);
        if (value !== undefined) values.set(entry.id, value);
      } catch {
        // A doc whose entry changed kind meanwhile is read again on its next store.
      }
    }
    return referencedTrash(view, buildRefIndex(view, values, s.project.kinds, s.env));
  }

  /** The store-time duties of the project's one writer. */
  async function repair(s: Served, doc: Y.Doc): Promise<void> {
    for (const r of await s.adapter.repairBlobs(doc, HASH_REPAIR))
      warn(
        `${s.name}: ${r.id}'s bytes (${r.from}) aren't in the content store; it points at ${r.to} again (hash-mismatch).`,
      );
    await reinspectBlobs(doc, {
      kinds: s.project.kinds,
      store: s.store,
      origin: REINSPECT_REPAIR,
      checked: s.checked,
    });
    restoreInUse(s, doc);
  }

  function broadcast(s: Served, change: AssetChange): void {
    const message: AssetChangedMessage = {
      type: ASSET_CHANGED,
      project: s.project.file.id,
      ...change,
    };
    server.hocuspocus.documents.get(s.name)?.broadcastStateless(JSON.stringify(message));
  }

  /** Broadcasts every change of a live binary's hash, once per transaction, whoever wrote it. */
  function watchContent(s: Served, doc: Y.Doc): void {
    const assets = projectAssetsMap(doc);
    assets.observeDeep((events) => {
      for (const event of events) {
        const [key] = event.path;
        const change = event.changes.keys.get("sha256");
        if (event.path.length !== 1 || typeof key !== "string" || !change) continue;
        const map = assets.get(key);
        const entry = map ? readEntry(key, map) : null;
        if (!entry || entry.deleted || entry.sha256 === undefined) continue;
        if (s.project.kinds.get(entry.kind)?.storage !== "blob") continue;
        broadcast(s, {
          key,
          id: entry.id,
          kind: entry.kind,
          path: entry.path,
          sha256: entry.sha256,
          bytes: entry.bytes ?? 0,
          previous: typeof change.oldValue === "string" ? change.oldValue : null,
        });
      }
    });
  }

  const server: HocuspocusServer = new Server({
    name: "jams-engine projects",
    quiet: true,
    stopOnSignals: false,
    debounce: options.debounceMs ?? 500,
    maxDebounce: Math.max(options.debounceMs ?? 500, 2_000),
    unloadImmediately: true,
    async onLoadDocument({ documentName, document }) {
      try {
        const { ref, s } = servedOf(documentName);
        if (ref.kind === "project") {
          await enqueue(s.project.file.id, async () => {
            for (const p of await s.adapter.loadProject(document))
              warn(`${s.project.file.id}/${p.path}: ${p.issues.map((i) => i.message).join("; ")}`);
            await writeCode(s, document);
            await repair(s, document);
            watchContent(s, document);
          });
          return;
        }
        await holdProject(s);
        await enqueue(s.project.file.id, () => s.adapter.loadDoc(documentName, document));
      } catch (e) {
        warn(`${documentName}: ${(e as Error).message}`);
        throw e;
      }
    },
    async afterLoadDocument({ documentName, document }) {
      const ref = parseDocName(documentName);
      const s = ref ? served.get(ref.project) : undefined;
      if (!ref || !s) return;
      if (ref.kind === "project") {
        void holdProject(s).catch((e: unknown) => warn(`${s.name}: ${(e as Error).message}`));
        return;
      }
      await enqueue(s.project.file.id, async () => {
        const project = docOf(s.name);
        if (project) restoreInUse(s, project, { name: documentName, doc: document });
      });
    },
    async onStoreDocument({ documentName, document }) {
      const ref = parseDocName(documentName);
      const s = ref ? served.get(ref.project) : undefined;
      if (!ref || !s) return;
      const id = s.project.file.id;
      await enqueue(id, async () => {
        if (ref.kind === "project") {
          await repair(s, document);
          await warnBlocked(s, document);
          await s.adapter.storeProject(document);
          return;
        }
        const project = docOf(s.name);
        const entry = project && readProject(project).assets[ref.key];
        // An outside change the watcher hasn't read yet goes in first, so the write can't clobber it.
        if (project && entry && !entry.deleted)
          handle(s, entry.path, await s.adapter.syncPath(entry.path, docOf, project));
        await s.adapter.storeDoc(documentName, document);
      });
    },
    async beforeUnloadDocument({ documentName, document }) {
      const ref = parseDocName(documentName);
      const s = ref ? served.get(ref.project) : undefined;
      if (s) await enqueue(s.project.file.id, () => s.adapter.persist(documentName, document));
    },
    async afterUnloadDocument({ documentName }) {
      const ref = parseDocName(documentName);
      const s = ref ? served.get(ref.project) : undefined;
      if (!ref || !s) return;
      await enqueue(s.project.file.id, async () => s.adapter.forget(documentName));
    },
  });

  function holdProject(s: Served): Promise<DirectConnection> {
    s.hold ??= server.hocuspocus.openDirectConnection(s.name).catch((e: unknown) => {
      delete s.hold;
      throw e;
    });
    return s.hold;
  }

  // ─── Watching the files ────────────────────────────────

  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const watchers: FSWatcher[] = [];
  let closed = false;

  function later(key: string, delay: number, run: () => Promise<void>): void {
    if (closed) return;
    clearTimeout(timers.get(key));
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        run().catch((e: unknown) => warn(`${key}: ${(e as Error).message}`));
      }, delay),
    );
  }

  /** Acts on a file event's result: waits to pair a pending add or unlink, reports a refusal. */
  function handle(s: Served, where: string, result: ProjectDiskSync): void {
    if (result.kind === "pending") {
      later(`settle:${s.project.file.id}`, settleMs, () =>
        enqueue(s.project.file.id, async () => {
          const project = docOf(s.name);
          if (!project) return;
          for (const r of await s.adapter.settle(docOf, project)) handle(s, s.name, r);
        }),
      );
      return;
    }
    report(where, result);
  }

  /**
   * Any file event while a write is held may be its path freeing: check
   * again, and store the project once what blocks it has changed.
   */
  function recheckBlocked(s: Served): void {
    later(`blocked:${s.project.file.id}`, watchDelay, () =>
      enqueue(s.project.file.id, async () => {
        const project = docOf(s.name);
        if (!project || s.blocked === undefined) return;
        const before = s.blocked;
        await warnBlocked(s, project);
        if (s.blocked !== before) await s.adapter.storeProject(project);
      }),
    );
  }

  // An editor or a script may still be mid-write when the first event
  // arrives; a file that doesn't parse is read once more before it's reported.
  function schedule(s: Served, file: string, delay: number, retried: boolean): void {
    const key = `${s.project.file.id}:${file}`;
    later(key, delay, () =>
      enqueue(s.project.file.id, async () => {
        const project = docOf(s.name);
        if (!project) return;
        const result = await s.adapter.syncPath(file, docOf, project);
        if (result.kind === "refused" && result.issues && !retried && !timers.has(key))
          schedule(s, file, delay * 5, true);
        else handle(s, `${s.project.file.id}/${file}`, result);
      }),
    );
  }

  for (const s of served.values()) {
    try {
      const watcher = watch(s.project.dir, { recursive: true }, (_event, name) => {
        if (!name || !docOf(s.name)) return;
        const file = String(name).split(sep).join("/");
        if (s.adapter.watches(file)) schedule(s, file, watchDelay, false);
        if (s.blocked !== undefined) recheckBlocked(s);
        if (isCodePath(s.project.file, file))
          later(`code:${s.project.file.id}`, watchDelay, () =>
            enqueue(s.project.file.id, async () => {
              const project = docOf(s.name);
              if (project) await writeCode(s, project);
            }),
          );
      });
      watcher.on("error", (e) => warn(`watching ${s.project.dir}: ${e.message}`));
      watchers.push(watcher);
    } catch (e) {
      warn(`can't watch ${s.project.dir}: ${(e as Error).message}`);
    }
  }

  return {
    server,
    adapters: new Map([...served].map(([id, s]) => [id, s.adapter])),
    buildAt,
    async projectDoc(id) {
      const s = served.get(id);
      if (!s) throw new Error(`no project "${id}"`);
      await holdProject(s);
      const doc = docOf(s.name);
      if (!doc) throw new Error(`${s.name} unloaded while it was held`);
      return doc;
    },
    handleUpgrade(req, socket, head) {
      if (pathOf(req) !== path) return false;
      if (closed) {
        refuse(socket, "503 Service Unavailable");
        return true;
      }
      if (!sameOrigin(req.headers)) {
        refuse(socket, "403 Forbidden");
        return true;
      }
      // `Server` owns the websocket adapter and runs it from its own http server's upgrade event.
      server.httpServer.emit("upgrade", req, socket, head);
      return true;
    },
    async idle() {
      while (timers.size > 0 || queues.size > 0) {
        await Promise.all([...queues.values()]);
        if (timers.size > 0) await new Promise((r) => setTimeout(r, 10));
      }
    },
    async destroy() {
      closed = true;
      for (const w of watchers) w.close();
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      for (const s of served.values()) {
        const held = await s.hold?.catch(() => undefined);
        delete s.hold;
        await held?.disconnect();
      }
      await server.destroy();
      await Promise.all([...queues.values()]);
    },
  };
}

// ─── HTTP ────────────────────────────────────────────────

/** The routes' view of the projects: the server's project docs once loaded, else scans of the files. */
function projectSources(
  projects: readonly FileProject[],
  collab: () => SceneCollab | undefined,
): ProjectSource[] {
  return projects.map((project) => {
    const lister = createProjectFileAdapter(project);
    const id = project.file.id;
    return {
      project,
      store: fileContentStore(project.cacheDir),
      state: async (): Promise<ProjectState> => {
        const doc = collab()?.server.hocuspocus.documents.get(
          docNameOf({ kind: "project", project: id }),
        );
        return doc ? readProject(doc) : (await lister.scan()).state;
      },
    };
  });
}

function readBody(req: IncomingMessage, limit: number): Promise<Uint8Array | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on("data", (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > limit) over = true;
      else chunks.push(chunk);
    });
    req.on("end", () => resolve(over ? null : new Uint8Array(Buffer.concat(chunks))));
    req.on("error", reject);
  });
}

/** Answers `/__scene` and `/__project` requests; false for other URLs. */
async function serveRequest(
  scenes: SceneStore,
  sources: readonly ProjectSource[],
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = req.url ?? "";
  const method = req.method ?? "GET";
  const result =
    (await handleSceneRequest({ method, url }, scenes)) ??
    (await handleProjectRequest(
      { method, url, headers: req.headers, body: (limit) => readBody(req, limit) },
      sources,
    ));
  if (!result) return false;
  res.statusCode = result.status;
  const headers = "headers" in result ? result.headers : undefined;
  if (result.body instanceof Uint8Array) {
    for (const [k, v] of Object.entries(headers ?? {})) res.setHeader(k, v);
    res.end(result.body);
  } else {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(result.body));
  }
  return true;
}

type Middleware = (
  req: IncomingMessage,
  res: ServerResponse,
  next: (err?: unknown) => void,
) => void;

type UpgradeListener = (req: IncomingMessage, socket: Duplex, head: Buffer) => void;

/** The subset of a Vite plugin this entry uses, typed here so the package needs no `vite` peer. */
export type SceneCollabPlugin = {
  name: string;
  apply: "serve";
  configureServer(server: {
    middlewares: { use(fn: Middleware): unknown };
    httpServer?: {
      on(event: "upgrade", listener: UpgradeListener): unknown;
      on(event: "close", listener: () => void): unknown;
    } | null;
  }): void;
};

/**
 * The dev server's projects: `GET /__scene` lists the scenes,
 * `GET /__scene/:name` reads one, `/__project` lists the projects and holds
 * their blobs, and websockets on `/__scene-collab` co-edit every project
 * doc. Never part of a build.
 */
export function sceneCollabServer(options: SceneCollabOptions): SceneCollabPlugin {
  const path = options.path ?? SCENE_COLLAB_PATH;
  return {
    name: "jams-engine:scene-collab",
    apply: "serve",
    configureServer(vite) {
      let collab: Promise<SceneCollab> | undefined;
      let ready: SceneCollab | undefined;
      const sources = projectSources(options.projects, () => ready);
      const scenes = projectSceneStore(sources);
      vite.middlewares.use((req, res, next) => {
        serveRequest(scenes, sources, req, res)
          .then((handled) => {
            if (!handled) next();
          })
          .catch(next);
      });
      const http = vite.httpServer;
      if (!http) {
        (options.warn ?? console.warn)(
          "[scene-collab] the dev server has no http server (middleware mode); collab is off.",
        );
        return;
      }
      // Fixed when the dev server starts, so the site's build stamp and the server's agree.
      const buildAt = options.buildAt ?? Date.now();
      http.on("upgrade", (req, socket, head) => {
        if (pathOf(req) !== path) return;
        ignoreErrors(socket);
        collab ??= createSceneCollab({ ...options, buildAt }).then((c) => (ready = c));
        collab
          .then((c) => c.handleUpgrade(req, socket, head))
          .catch((e: unknown) => {
            (options.warn ?? console.warn)(`[scene-collab] ${(e as Error).message}`);
            refuse(socket, "503 Service Unavailable");
          });
      });
      http.on("close", () => {
        collab?.then((c) => c.destroy()).catch(() => undefined);
      });
    },
  };
}

export type ListeningSceneCollab = SceneCollab & {
  /** `ws://host:port/__scene-collab`. */
  url: string;
  /** `http://host:port`, which answers `/__scene` and `/__project`. */
  httpUrl: string;
  port: number;
  close(): Promise<void>;
};

/** The collab server on a port of its own, for tests and for running it outside Vite. */
export async function listenSceneCollab(
  options: SceneCollabOptions & { port?: number; host?: string },
): Promise<ListeningSceneCollab> {
  const collab = await createSceneCollab(options);
  const sources = projectSources(options.projects, () => collab);
  const scenes = projectSceneStore(sources);
  const http = createServer((req, res) => {
    serveRequest(scenes, sources, req, res)
      .then((handled) => {
        if (handled) return;
        res.statusCode = 404;
        res.end();
      })
      .catch(() => {
        res.statusCode = 500;
        res.end();
      });
  });
  // Upgraded sockets leave the http server's bookkeeping, so `close` ends them itself.
  const upgraded = new Set<Duplex>();
  http.on("upgrade", (req, socket, head) => {
    upgraded.add(socket);
    socket.once("close", () => upgraded.delete(socket));
    if (!collab.handleUpgrade(req, socket, head)) refuse(socket, "404 Not Found");
  });
  const host = options.host ?? "127.0.0.1";
  try {
    await new Promise<void>((resolve, reject) => {
      http.once("error", reject);
      http.listen(options.port ?? 0, host, () => resolve());
    });
  } catch (e) {
    await collab.destroy();
    throw e;
  }
  const { port } = http.address() as AddressInfo;
  return {
    ...collab,
    url: `ws://${host}:${port}${options.path ?? SCENE_COLLAB_PATH}`,
    httpUrl: `http://${host}:${port}`,
    port,
    async close() {
      const closed = new Promise<void>((resolve) => http.close(() => resolve()));
      await collab.destroy();
      http.closeAllConnections();
      for (const socket of upgraded) socket.destroy();
      await closed;
    },
  };
}
