import { readFileProject, sceneCollabServer } from "@jams/engine/vite";
import wasm from "vite-plugin-wasm";

import { coinGame } from "./coin-game";

/** The `plugins` of a host's `vite.config.ts`; `scenes/` holds a `jams.project.json`. */
export const devPlugins = [
  wasm(),
  sceneCollabServer({ projects: [await readFileProject("scenes", { game: coinGame })] }),
];
