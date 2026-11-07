import { readdir, readFile, rename, writeFile } from "node:fs/promises";

import { formatScene } from "../scene/format";
import { sceneHash } from "../scene/hash";
import { parseScene } from "../scene/parse";
import type { SceneIssue } from "../scene/types";
import { validateScene } from "../scene/validate";
import { assertSceneName, resolveScenePath, sceneNameOf, ScenePathError } from "./scene-paths";

export const SCENE_ROUTE = "/__scene";
export const MAX_SCENE_BYTES = 4 * 1024 * 1024;

export type SceneRequest = {
  method: string;
  url: string;
  body?: string;
  /** Lowercase header names; writes need a JSON content type and a same-origin caller. */
  headers?: Record<string, string | undefined>;
};
export type SceneResponse = { status: number; body: unknown };

/** Where scenes are read and written; the dev sink uses files, tests may pass anything. */
export type SceneStore = {
  list(): Promise<string[]>;
  read(name: string): Promise<string | null>;
  write(name: string, text: string): Promise<void>;
};

export function createFileSceneStore(dir: string): SceneStore {
  return {
    async list() {
      const files = await readdir(dir).catch(() => [] as string[]);
      return files
        .map(sceneNameOf)
        .filter((n): n is string => n !== null)
        .sort();
    },
    async read(name) {
      try {
        return await readFile(resolveScenePath(dir, name), "utf8");
      } catch (error) {
        if ((error as { code?: string }).code === "ENOENT") return null;
        throw error;
      }
    },
    async write(name, text) {
      const file = resolveScenePath(dir, name);
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, text, "utf8");
      await rename(tmp, file);
    },
  };
}

const error = (status: number, message: string, issues?: SceneIssue[]): SceneResponse => ({
  status,
  body: issues ? { ok: false, error: message, issues } : { ok: false, error: message },
});

/**
 * A cross-site page can send a no-cors POST with a text/plain body and no
 * preflight; a JSON content type forces one, and fetch metadata or Origin
 * names the caller when the browser sends them.
 */
function writeRefusal(headers: Record<string, string | undefined>): SceneResponse | null {
  const type = headers["content-type"]?.split(";")[0]?.trim().toLowerCase();
  if (type !== "application/json") return error(415, "Send the scene as application/json.");
  const site = headers["sec-fetch-site"];
  if (site !== undefined && site !== "same-origin" && site !== "none")
    return error(403, "Scene writes are same-origin only.");
  const origin = headers.origin;
  if (origin !== undefined && headers.host !== undefined) {
    let host: string | null = null;
    try {
      host = new URL(origin).host;
    } catch {
      host = null;
    }
    if (host !== headers.host) return error(403, "Scene writes are same-origin only.");
  }
  return null;
}

/**
 * `GET /__scene` lists scene names, `GET /__scene/:name` returns the stored
 * text, and `POST /__scene/:name` parses and validates the body and writes
 * its canonical form. Error-severity issues refuse the write with 422.
 * `POST /__scene/:name?base=<hash>` also refuses with 409 when the file on
 * disk no longer has that hash; leave `base` off to overwrite.
 * Returns null for URLs outside the route.
 */
export async function handleSceneRequest(
  req: SceneRequest,
  store: SceneStore,
): Promise<SceneResponse | null> {
  const [path = "", query = ""] = req.url.split("?");
  if (path !== SCENE_ROUTE && !path.startsWith(`${SCENE_ROUTE}/`)) return null;
  let rest: string;
  try {
    rest = decodeURIComponent(path.slice(SCENE_ROUTE.length + 1));
  } catch {
    return error(400, "Malformed scene name.");
  }

  try {
    if (rest === "") {
      if (req.method !== "GET") return error(405, "Use GET to list scenes.");
      return { status: 200, body: { ok: true, scenes: await store.list() } };
    }
    if (req.method === "GET") {
      assertSceneName(rest);
      const text = await store.read(rest);
      if (text === null) return error(404, `No scene named ${JSON.stringify(rest)}.`);
      return { status: 200, body: JSON.parse(text) };
    }
    if (req.method !== "POST") return error(405, "Use GET or POST.");

    assertSceneName(rest);
    const refused = writeRefusal(req.headers ?? {});
    if (refused) return refused;
    const body = req.body ?? "";
    if (body.length > MAX_SCENE_BYTES) return error(413, "Scene is too large.");
    const parsed = parseScene(body);
    if (!parsed.ok) return error(422, "Scene failed to parse.", parsed.issues);
    const { text, lines } = formatScene(parsed.def);
    const issues = validateScene(parsed.def, { lines });
    if (issues.some((i) => i.severity === "error")) {
      return error(422, "Scene has errors.", issues);
    }
    const base = new URLSearchParams(query).get("base");
    if (base) {
      const current = await store.read(rest);
      const onDisk = current === null ? null : parseScene(current);
      const diskHash = onDisk?.ok ? sceneHash(onDisk.def) : null;
      if (current !== null && diskHash !== base) {
        return {
          status: 409,
          body: {
            ok: false,
            error: `${rest} changed on disk since it was loaded.`,
            expected: base,
            got: diskHash,
          },
        };
      }
    }
    await store.write(rest, text);
    return { status: 200, body: { ok: true, hash: sceneHash(parsed.def), issues } };
  } catch (e) {
    if (e instanceof ScenePathError) return error(400, e.message);
    throw e;
  }
}
