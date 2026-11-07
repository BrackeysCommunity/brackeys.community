import { fileURLToPath } from "node:url";

import { ENGINE_REGISTRY_ID } from "@jams/engine/game";

import { platformerGame } from "../../src/games/platformer";
import type { GameTable } from "./context";

/** The games the CLI knows, by id. A scene's `game` key picks one. */
export const GAMES: GameTable = { platformer: platformerGame };

const repo = (path: string) => fileURLToPath(new URL(`../../${path}`, import.meta.url));

/**
 * Where scenes live, by home: `src/games/<id>/scenes` for each game, and
 * `src/engine/scenes` (home `engine`) for scenes that name no game.
 */
export function gameScenesDirs(games: GameTable): Record<string, string> {
  return {
    [ENGINE_REGISTRY_ID]: repo("src/engine/scenes"),
    ...Object.fromEntries(Object.keys(games).map((id) => [id, repo(`src/games/${id}/scenes`)])),
  };
}

/** Each home's committed scene JSON Schema, which a scene's `$schema` points at. */
export function gameSchemaFiles(games: GameTable): Record<string, string> {
  return {
    [ENGINE_REGISTRY_ID]: repo("src/engine/scene/scene.schema.json"),
    ...Object.fromEntries(
      Object.keys(games).map((id) => [id, repo(`src/games/${id}/scene.schema.json`)]),
    ),
  };
}
