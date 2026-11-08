import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ContentStoreError, type ContentStore } from "../project/content-store";
import { isSha256 } from "../project/hash";
import { SCENE_KIND_NAME } from "../project/ops";
import type { ProjectState } from "../project/types";
import { projectView } from "../project/view";
import { makeIssue } from "../scene/issues";
import type { FileProject } from "./project-files";
import { assertSceneName, ScenePathError } from "./scene-paths";

export const SCENE_ROUTE = "/__scene";
export const PROJECT_ROUTE = "/__project";

export type SceneRequest = { method: string; url: string };
export type SceneResponse = { status: number; body: unknown };

/** Where scenes are read from; the dev server uses files, tests may pass anything. */
export type SceneStore = {
  list(): Promise<string[]>;
  read(name: string): Promise<string | null>;
};

/** One project as the routes see it: its files, its registry as it stands now, and its content store. */
export type ProjectSource = {
  project: FileProject;
  /** The registry now: the server's project doc when it's loaded, else a scan of the files. */
  state: () => Promise<ProjectState>;
  store: ContentStore;
};

/** The live scenes across `sources` by id; an id in more than one is listed once and read from the first. */
export function projectSceneStore(sources: readonly ProjectSource[]): SceneStore {
  async function scenes(): Promise<{ id: string; file: string }[]> {
    const out: { id: string; file: string }[] = [];
    for (const { project, state } of sources)
      for (const entry of projectView(await state(), project.kinds).byId.values())
        if (entry.kind === SCENE_KIND_NAME)
          out.push({ id: entry.id, file: join(project.dir, ...entry.path.split("/")) });
    return out;
  }
  return {
    async list() {
      return [...new Set((await scenes()).map((s) => s.id))].sort();
    },
    async read(name) {
      const hit = (await scenes()).find((s) => s.id === name);
      if (!hit) return null;
      try {
        return await readFile(hit.file, "utf8");
      } catch (error) {
        if ((error as { code?: string }).code === "ENOENT") return null;
        throw error;
      }
    },
  };
}

const error = (status: number, message: string, extra: Record<string, unknown> = {}) => ({
  status,
  body: { ok: false, error: message, ...extra },
});

/** A URL path segment decoded, or null when its percent-escapes are malformed. */
function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/**
 * `GET /__scene` lists scene names and `GET /__scene/:name` returns a
 * scene's stored JSON. Writes go through the collab server's documents, so
 * every other method is 405. Returns null for URLs outside the route.
 */
export async function handleSceneRequest(
  req: SceneRequest,
  store: SceneStore,
): Promise<SceneResponse | null> {
  const [path = ""] = req.url.split("?");
  if (path !== SCENE_ROUTE && !path.startsWith(`${SCENE_ROUTE}/`)) return null;
  if (req.method !== "GET")
    return error(405, "Use GET; scenes are edited through the collab server.");
  const rest = decodeSegment(path.slice(SCENE_ROUTE.length + 1));
  if (rest === null) return error(400, "Malformed scene name.");
  try {
    if (rest === "") return { status: 200, body: { ok: true, scenes: await store.list() } };
    assertSceneName(rest);
    const text = await store.read(rest);
    if (text === null) return error(404, `No scene named ${JSON.stringify(rest)}.`);
    return { status: 200, body: JSON.parse(text) };
  } catch (e) {
    if (e instanceof ScenePathError) return error(400, e.message);
    throw e;
  }
}

type Headers = Readonly<Record<string, string | readonly string[] | undefined>>;

const header = (headers: Headers, name: string): string | undefined => {
  const value = headers[name];
  return typeof value === "string" ? value : value?.[0];
};

/**
 * A browser sends `Origin` with every websocket and every POST; a page on
 * another site must not reach the dev server's projects. Node and Bun
 * clients send none.
 */
export function sameOrigin(headers: Headers): boolean {
  const origin = header(headers, "origin");
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === header(headers, "host");
  } catch {
    return false;
  }
}

export type ProjectRequest = {
  method: string;
  url: string;
  headers: Headers;
  /** The raw body; resolves to null when it's larger than `limit` bytes. */
  body(limit: number): Promise<Uint8Array | null>;
};

export type ProjectResponse = {
  status: number;
  headers?: Record<string, string>;
  /** JSON, or the bytes of a blob. */
  body: unknown;
};

/** What a blob upload may hold: the most any blob kind of the project takes; 0 when it has none. */
function uploadLimit(project: FileProject): number {
  let max = 0;
  for (const def of project.kinds.list())
    if (def.storage === "blob") max = Math.max(max, def.maxBytes);
  return max;
}

/**
 * The dev server's project routes, beside `/__scene`:
 *
 * - `GET /__project`: the projects, `{ ok, projects: [{ id, name, game }] }`.
 * - `POST /__project/<id>/blob`: stores the raw body in the project's
 *   content store and answers `{ sha256, bytes }` with 200. As on the
 *   site's blob route, bytes that don't hash to `x-expect-sha256` are
 *   refused with `hash-mismatch` (422), an over-limit body with
 *   `asset-too-large` (413) and an empty one with 400. Unlike it, the route
 *   ignores `x-asset-kind`: a body may be as large as the project's largest
 *   blob kind allows (importing the asset applies its own kind's cap), a
 *   project with no blob kinds is refused with `asset-kind` (400) before
 *   its body is read, a new blob is 200 rather than 201, and there are no
 *   quotas, rate limit or upload scan.
 * - `GET /__project/<id>/blob/<sha256>`: the bytes, cacheable forever.
 *
 * A request from another site's page is 403. Returns null for URLs outside
 * the route.
 */
export async function handleProjectRequest(
  req: ProjectRequest,
  sources: readonly ProjectSource[],
): Promise<ProjectResponse | null> {
  const [path = ""] = req.url.split("?");
  if (path !== PROJECT_ROUTE && !path.startsWith(`${PROJECT_ROUTE}/`)) return null;
  if (!sameOrigin(req.headers))
    return error(403, "Cross-origin requests can't reach the dev server's projects.");
  const parts = path.slice(PROJECT_ROUTE.length + 1).split("/");
  if (path === PROJECT_ROUTE || (parts.length === 1 && parts[0] === "")) {
    if (req.method !== "GET") return error(405, "Use GET.");
    return {
      status: 200,
      body: {
        ok: true,
        projects: sources.map(({ project }) => ({
          id: project.file.id,
          name: project.file.name,
          game: project.game?.id ?? null,
        })),
      },
    };
  }
  const [segment = "", route, hash, ...extra] = parts;
  const id = decodeSegment(segment);
  if (id === null) return error(404, `No project ${JSON.stringify(segment)}.`);
  const source = sources.find((s) => s.project.file.id === id);
  if (!source) return error(404, `No project ${JSON.stringify(id)}.`);
  if (route !== "blob" || extra.length > 0) return error(404, `No route ${path}.`);

  if (hash === undefined) {
    if (req.method !== "POST") return error(405, "POST the bytes to store them.");
    const limit = uploadLimit(source.project);
    if (limit === 0) {
      const message = "This project defines no blob kinds.";
      return error(400, message, { issue: makeIssue("asset-kind", { message }) });
    }
    const bytes = await req.body(limit);
    if (bytes === null) {
      const message = `A blob may hold at most ${limit} bytes.`;
      return error(413, message, {
        issue: makeIssue("asset-too-large", { message, expected: `≤ ${limit}` }),
      });
    }
    if (bytes.byteLength === 0) return error(400, "The upload is empty.");
    const expect = header(req.headers, "x-expect-sha256");
    try {
      const sha256 = await source.store.put(bytes, expect);
      return { status: 200, body: { sha256, bytes: bytes.byteLength } };
    } catch (e) {
      if (e instanceof ContentStoreError) return error(422, e.message, { issue: e.issue });
      throw e;
    }
  }

  if (req.method !== "GET") return error(405, "Use GET; a blob never changes.");
  if (!isSha256(hash)) return error(400, `${JSON.stringify(hash)} isn't a SHA-256 hash.`);
  const bytes = await source.store.get(hash);
  if (!bytes) return error(404, `Project ${JSON.stringify(id)} holds no blob ${hash}.`);
  return {
    status: 200,
    headers: {
      "content-type": "application/octet-stream",
      "cache-control": "public, max-age=31536000, immutable",
    },
    body: bytes,
  };
}
