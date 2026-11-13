import { fileURLToPath } from "node:url";

import type { ProjectFile } from "../../../types";

export { readHeld } from "../../../../__tests__/fixtures/held-project";

/** The engine's own project: its scenes, prefabs, art and data under `packages/engine/scenes`. */
export const ENGINE_DIR = fileURLToPath(new URL("../../../../scenes/", import.meta.url));

export const ENGINE_PROJECT: ProjectFile = {
  kind: "project",
  v: 1,
  id: "engine",
  name: "Engine",
  game: null,
};
