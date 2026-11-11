import {
  formatAssetDoc,
  formatProjectFile,
  GAME_SETTINGS_KIND,
  GAME_SETTINGS_VERSION,
  gameSettingsKind,
  INPUT_MAP_KIND,
  INPUT_MAP_VERSION,
  inputMapKind,
  SCENE_LIST_KIND,
  SCENE_LIST_VERSION,
  sceneListKind,
} from "@jams/engine/project";
import { makeIssue, pointerLines, type SceneIssue } from "@jams/engine/scene";

import type { GameNames, GameOptions } from ".";

/** `jams.project.json`: the game and UI modules, its scenes, scene list and docs as assets, its code. */
export function projectFile(options: GameOptions, names: GameNames, $schema: string): string {
  return formatProjectFile({
    $schema,
    kind: "project",
    v: 1,
    id: options.id,
    name: options.name,
    game: { module: "./index.ts", export: names.gameExport },
    ui: { module: "./ui/index.ts", export: names.hudExport },
    assets: ["scenes/**", "game-settings.json", "input-map.json", "scene-list.json"],
    code: ["**/*.ts", "!**/__tests__/**"],
  });
}

/** `game-settings.json`, with nothing over the engine's and the game's defaults yet. */
export function gameSettingsFile($schema: string): string {
  return formatAssetDoc(gameSettingsKind, {
    $schema,
    kind: GAME_SETTINGS_KIND,
    v: GAME_SETTINGS_VERSION,
    engine: {},
    game: {},
  });
}

/** `input-map.json`: one seat every device drives, and the pad deadzone. */
export function inputMapFile($schema: string): string {
  return formatAssetDoc(inputMapKind, {
    $schema,
    kind: INPUT_MAP_KIND,
    v: INPUT_MAP_VERSION,
    players: { join: "auto", max: 1 },
    deadzone: 0.15,
  });
}

/** `scene-list.json`: the one scene, `main`, as the start. */
export function sceneListFile($schema: string): string {
  return formatAssetDoc(sceneListKind, {
    $schema,
    kind: SCENE_LIST_KIND,
    v: SCENE_LIST_VERSION,
    start: "main",
    scenes: [{ scene: "main" }],
  });
}

/**
 * Whether `id` can be a new project in `projectDir`: `project-id-taken`
 * when a discovered project holds the id, or the directory exists. The
 * issue points at the new project file's `id`, whose text is `text`.
 */
export function projectIdTaken(
  id: string,
  projectDir: string,
  taken: { projects: readonly { dir: string; file: { id: string } }[]; dirExists: boolean },
  text: string,
): SceneIssue | null {
  const line = pointerLines(text).get("/id");
  const holder = taken.projects.find((p) => p.file.id === id);
  if (holder)
    return makeIssue("project-id-taken", {
      message: `project id ${JSON.stringify(id)} is taken by the project in ${holder.dir}`,
      path: "/id",
      line,
      got: JSON.stringify(id),
    });
  if (taken.dirExists)
    return makeIssue("project-id-taken", {
      message: `${projectDir} already exists`,
      path: "/id",
      line,
      got: JSON.stringify(id),
    });
  return null;
}
