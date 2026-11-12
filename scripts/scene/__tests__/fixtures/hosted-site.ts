import {
  memoryContentStore,
  type CodeModuleInfo,
  type ContentStore,
  type ProjectBundle,
} from "@jams/engine/project";
import * as Y from "yjs";

import { bundleProjectState } from "../../../../src/lib/engine/bundle";
import { prepareLoadedState } from "../../../../src/lib/scene/doc-bytes";
import {
  emptyProjectState,
  seedAssetState,
  seedProjectState,
} from "../../../../src/lib/scene/project-bytes";
import type { ProjectHandle } from "../../projects";

/**
 * A project the site hosts, in memory as the site keeps it: absent while
 * the id is reserved and empty; once pushed, the registry and doc rows
 * `seedHostedProject` writes, each doc laid out as the service lays out
 * its seed on first load (a material left unloaded, with its seed only).
 */
export type HostedProject = {
  registry: Y.Doc;
  docs: Map<string, { prefix: "scene" | "asset"; kind: string; doc: Y.Doc | null; seed: string }>;
  game: string | null;
};

export type HostedSite = {
  /** The site's bundle and blob routes for each reserved project, for the one agent token. */
  readonly fetch: typeof fetch;
  /** Pushed projects by id. */
  readonly projects: Map<string, HostedProject>;
  /** The site's blob bytes; swap it to stand in for a site that lost them. */
  blobs: ContentStore;
  /** Every request, in order, with its bearer header. */
  readonly requests: { method: string; path: string; auth: string | null }[];
  /** Every blob upload's declared kind and content type. */
  readonly uploads: { kind: string | null; type: string | null }[];
};

export type HostedSiteOptions = {
  token: string;
  /** The ids the site has reserved, with the names it gave them. */
  reserved: Readonly<Record<string, string>>;
  /** The local project a push of `id` comes from: its kinds judge the bundle as the site does with its game's. */
  handle(id: string): ProjectHandle;
};

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

const json = (body: unknown, status = 200) => Response.json(body, { status });

/** An in-memory jams.team for `project push` and `project pull`. */
export function hostedSite(opts: HostedSiteOptions): HostedSite {
  const site: HostedSite = {
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input : input.url,
      );
      const headers = new Headers(init?.headers);
      const auth = headers.get("authorization");
      const method = init?.method ?? "GET";
      site.requests.push({ method, path: url.pathname, auth });
      if (auth !== `Bearer ${opts.token}`)
        return json({ message: "That agent token isn't valid." }, 401);
      const id = /^\/api\/engine\/projects\/([^/]+)\//.exec(url.pathname)?.[1];
      const name = id === undefined ? undefined : opts.reserved[id];
      if (id === undefined || name === undefined) return json({ message: "Not found." }, 404);
      const base = `/api/engine/projects/${id}`;
      const hosted = site.projects.get(id);
      if (url.pathname === `${base}/bundle`) {
        if (method === "POST") {
          if (hosted) return json({ message: "exists" }, 409);
          return seed(id, JSON.parse(init?.body as string));
        }
        const registry = hosted
          ? Y.encodeStateAsUpdate(hosted.registry)
          : seedProjectState(emptyProjectState(id, name));
        return json({
          projectId: id,
          name,
          game: hosted?.game ?? null,
          project: b64(registry),
          docs: [...(hosted?.docs ?? [])].map(([key, d]) => ({
            prefix: d.prefix,
            key,
            kind: d.kind,
            state: d.doc ? b64(Y.encodeStateAsUpdate(d.doc)) : null,
            seed: d.doc ? null : d.seed,
          })),
          blobs: [],
        });
      }
      if (url.pathname === `${base}/blobs` && method === "POST") {
        site.uploads.push({
          kind: headers.get("x-asset-kind"),
          type: headers.get("content-type"),
        });
        const bytes = new Uint8Array(init?.body as Uint8Array);
        const sha = await site.blobs.put(bytes, headers.get("x-expect-sha256") ?? undefined);
        return json({ sha256: sha, bytes: bytes.byteLength }, 201);
      }
      const blob = new RegExp(`^${base}/blobs/([0-9a-f]{64})$`).exec(url.pathname);
      if (blob) {
        const bytes = await site.blobs.get(blob[1]!);
        if (!bytes) return json({ message: "Not found." }, 404);
        return new Response(method === "HEAD" ? null : new Uint8Array(bytes));
      }
      return json({ message: "Not found." }, 404);
    }) as typeof fetch,
    projects: new Map(),
    blobs: memoryContentStore(),
    requests: [],
    uploads: [],
  };

  /** What `seedHostedProject` does with a pushed bundle, judged as `bundleProjectState` judges it. */
  async function seed(
    id: string,
    body: { bundle: ProjectBundle; game: string | null; code: Record<string, CodeModuleInfo> },
  ) {
    const handle = opts.handle(id);
    const derived = await bundleProjectState(body.bundle, {
      store: site.blobs,
      kinds: handle.kinds,
      registry: handle.registry,
      code: body.code,
    });
    if (!derived.ok) return json({ problems: derived.problems }, 400);
    const registry = new Y.Doc();
    Y.applyUpdate(registry, seedProjectState(derived.state));
    const env = { registry: handle.registry, project: null };
    const docs: HostedProject["docs"] = new Map();
    for (const d of derived.docs) {
      let doc: Y.Doc | null = null;
      if (d.kind !== "material") {
        doc = new Y.Doc();
        Y.applyUpdate(
          doc,
          d.prefix === "scene"
            ? prepareLoadedState(`${id}.${d.key}`, null, d.seed).state
            : seedAssetState({
                project: id,
                key: d.key,
                kind: d.kind,
                seed: d.seed,
                kinds: handle.kinds,
                env,
              }),
        );
      }
      docs.set(d.key, { prefix: d.prefix, kind: d.kind, doc, seed: d.seed });
    }
    site.projects.set(id, { registry, docs, game: body.game });
    return json({ projectId: id, docs: docs.size, warnings: [] }, 201);
  }

  return site;
}
