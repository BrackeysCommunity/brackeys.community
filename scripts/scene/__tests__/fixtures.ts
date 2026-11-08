import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import type { GameDefinition } from "@jams/engine/game";
import { PROJECT_FILE } from "@jams/engine/project";

import { openProject, type ProjectHandle } from "../projects";

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
