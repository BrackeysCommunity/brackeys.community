import * as hocuspocus from "@hocuspocus/server";
import { readFileProject, sceneCollabServer } from "@jams/engine/vite";
import { defineConfig } from "vite";
import wasm from "vite-plugin-wasm";

import { coinGame } from "./coin-game";

export default defineConfig({
  plugins: [
    wasm(),
    sceneCollabServer({
      projects: [await readFileProject("src/game", { game: coinGame })],
      hocuspocus,
    }),
  ],
});
