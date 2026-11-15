import { cp, mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { GameDefinition } from "@jams/engine/game";
import { PROJECT_FILE } from "@jams/engine/project";

import { openProject, type ProjectHandle } from "../projects";

/** The engine's own project: the yards, the kitchen sink and their assets. */
export const ENGINE_SCENES = fileURLToPath(
  new URL("../../../packages/engine/scenes", import.meta.url),
);

/**
 * Copies `src` to `dest` without its `node_modules`: a scene CLI run whose
 * root was the project's own directory leaves its dev cache there, and a copy
 * of it would turn up as project files.
 */
export function copyProject(src: string, dest: string): Promise<void> {
  return cp(src, dest, { recursive: true, filter: (path) => basename(path) !== "node_modules" });
}

/**
 * A project in `dir` for a test: writes its `jams.project.json` (assets
 * `["**"]` unless given) and opens it with `game` in hand. Its cache sits
 * beside the directory, never inside it.
 */
export async function tempProject(
  dir: string,
  opts: { id?: string; game?: GameDefinition | null; assets?: string[] } = {},
): Promise<ProjectHandle> {
  const id = opts.id ?? opts.game?.id ?? basename(dir);
  await mkdir(dir, { recursive: true });
  const file = {
    kind: "project",
    v: 1,
    id,
    name: id,
    game: opts.game ? { module: "./index.ts", export: "game" } : null,
    assets: opts.assets ?? ["**"],
  };
  await writeFile(join(dir, PROJECT_FILE), `${JSON.stringify(file)}\n`);
  return openProject(dir, {
    game: opts.game ?? null,
    cacheDir: join(dirname(dir), ".jams-cache", id),
  });
}
