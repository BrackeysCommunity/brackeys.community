import { createRegistry } from "@jams/engine/game";
import { sceneCollabServer } from "@jams/engine/vite";
import wasm from "vite-plugin-wasm";

import { coinGame } from "./coin-game";

/** The `plugins` of a host's `vite.config.ts`. */
export const devPlugins = [
  wasm(),
  sceneCollabServer({ homes: [{ dir: "scenes", registry: createRegistry(coinGame) }] }),
];
