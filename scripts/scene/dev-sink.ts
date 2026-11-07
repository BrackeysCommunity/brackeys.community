import * as hocuspocus from "@hocuspocus/server";
import { ENGINE_REGISTRY_ID } from "@jams/engine/game";
import { createRegistry } from "@jams/engine/scene";
import { sceneCollabServer, type SceneHome } from "@jams/engine/vite";

import { GAMES, gameScenesDirs } from "./games";

/**
 * The dev server's scene collab server over every home the CLI knows: each
 * game's scenes with its registry, and the engine's gameless scenes with the
 * engine's alone.
 */
export function devSceneCollab() {
  const dirs = gameScenesDirs(GAMES);
  const homes: SceneHome[] = Object.entries(dirs).map(([home, dir]) => ({
    dir,
    registry: home === ENGINE_REGISTRY_ID ? createRegistry() : createRegistry(GAMES[home]!),
  }));
  // Imported here, while the config's module runner is still open.
  return sceneCollabServer({ homes, hocuspocus });
}
