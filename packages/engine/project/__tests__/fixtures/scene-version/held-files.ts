import { fileURLToPath } from "node:url";

import type { ProjectFile } from "../../../types";
import { ENGINE_HOME } from "../engine-home";

export { readHeld } from "../../../../__tests__/fixtures/held-project";

/** The engine's own project: its scenes, prefabs, art and data under `packages/engine/scenes`. */
export const ENGINE_DIR = fileURLToPath(ENGINE_HOME);

export const ENGINE_PROJECT: ProjectFile = {
  kind: "project",
  v: 1,
  id: "engine",
  name: "Engine",
  game: null,
};
