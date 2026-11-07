import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Registry } from "../game/types";
import { formatPrefab } from "../scene/format";
import { parsePrefab, PREFABS_DIR } from "../scene/prefab";
import type { Prefab, PrefabLibrary, SceneIssue } from "../scene/types";
import { resolveScenePath, sceneNameOf } from "./scene-paths";

/** `<scenes dir>/prefabs`: where a scenes directory keeps its prefab files. */
export const prefabsDirOf = (scenesDir: string) => join(scenesDir, PREFABS_DIR);

/** The file for prefab `id` in a scenes directory; ids follow scene names' rules. */
export const prefabPath = (scenesDir: string, id: string) =>
  resolveScenePath(prefabsDirOf(scenesDir), id);

export type PrefabFiles = {
  prefabs: PrefabLibrary;
  /** Each prefab file's text as read, by id. */
  texts: Map<string, string>;
  /** Files that didn't parse, or whose `id` isn't their file name; they are left out. */
  problems: { id: string; issues: SceneIssue[] }[];
};

/** Reads every prefab in a scenes directory; a missing `prefabs/` is an empty library. */
export async function readPrefabFiles(scenesDir: string, registry: Registry): Promise<PrefabFiles> {
  const dir = prefabsDirOf(scenesDir);
  const files = await readdir(dir).catch(() => [] as string[]);
  const prefabs = new Map<string, Prefab>();
  const texts = new Map<string, string>();
  const problems: PrefabFiles["problems"] = [];
  for (const file of files.sort()) {
    const id = sceneNameOf(file);
    if (!id) continue;
    const text = await readFile(join(dir, file), "utf8");
    const parsed = parsePrefab(text, registry);
    if (!parsed.ok) {
      problems.push({ id, issues: parsed.issues });
      continue;
    }
    if (parsed.prefab.id !== id) {
      problems.push({
        id,
        issues: [
          {
            severity: "error",
            code: "bad-id",
            message: `prefabs/${file} has the id "${parsed.prefab.id}"; a prefab's id is its file name`,
            path: "/id",
            entityIds: [],
          },
        ],
      });
      continue;
    }
    prefabs.set(id, parsed.prefab);
    texts.set(id, text);
  }
  return { prefabs, texts, problems };
}

/**
 * Writes the prefabs whose canonical text differs from `texts` (the files as
 * last read or written) and deletes the files of ids that left the library.
 * Returns the texts now on disk.
 */
export async function writePrefabFiles(
  scenesDir: string,
  texts: ReadonlyMap<string, string>,
  prefabs: PrefabLibrary,
): Promise<Map<string, string>> {
  const out = new Map(texts);
  for (const [id, prefab] of prefabs) {
    const text = formatPrefab(prefab);
    if (texts.get(id) === text) continue;
    const file = prefabPath(scenesDir, id);
    await mkdir(prefabsDirOf(scenesDir), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, text, "utf8");
    await rename(tmp, file);
    out.set(id, text);
  }
  for (const id of texts.keys()) {
    if (prefabs.has(id)) continue;
    await rm(prefabPath(scenesDir, id), { force: true });
    out.delete(id);
  }
  return out;
}
