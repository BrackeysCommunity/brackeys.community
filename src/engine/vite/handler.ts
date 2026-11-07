import { readdir, readFile } from "node:fs/promises";

import { assertSceneName, resolveScenePath, sceneNameOf, ScenePathError } from "./scene-paths";

export const SCENE_ROUTE = "/__scene";

export type SceneRequest = { method: string; url: string };
export type SceneResponse = { status: number; body: unknown };

/** Where scenes are read from; the dev server uses files, tests may pass anything. */
export type SceneStore = {
  list(): Promise<string[]>;
  read(name: string): Promise<string | null>;
};

/** Scenes across `dirs`; a name in more than one is listed once and read from the first. */
export function createFileSceneStore(dirs: string | readonly string[]): SceneStore {
  const all = typeof dirs === "string" ? [dirs] : dirs;
  return {
    async list() {
      const names = new Set<string>();
      for (const dir of all) {
        const files = await readdir(dir).catch(() => [] as string[]);
        for (const f of files) {
          const name = sceneNameOf(f);
          if (name) names.add(name);
        }
      }
      return [...names].sort();
    },
    async read(name) {
      for (const dir of all) {
        try {
          return await readFile(resolveScenePath(dir, name), "utf8");
        } catch (error) {
          if ((error as { code?: string }).code !== "ENOENT") throw error;
        }
      }
      return null;
    },
  };
}

const error = (status: number, message: string): SceneResponse => ({
  status,
  body: { ok: false, error: message },
});

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
  let rest: string;
  try {
    rest = decodeURIComponent(path.slice(SCENE_ROUTE.length + 1));
  } catch {
    return error(400, "Malformed scene name.");
  }
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
