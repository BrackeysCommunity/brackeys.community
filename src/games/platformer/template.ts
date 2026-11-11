import type { SceneTemplate } from "@jams/engine/game";

import { TYPE } from "./type-names";

/** A new platformer scene: a floor, a spawn on it, the cheese and the hole, and lava below, in metres. */
export const PLATFORMER_TEMPLATE: SceneTemplate = {
  bounds: [0, 0, 19.2, 10.8],
  solid: [["box", 9.6, 10, 9.6, 0.2]],
  [TYPE.spawn]: [[2, 9.8]],
  entities: [
    { id: "cheese", type: TYPE.goal, shape: ["circle", 15, 9.5, 0.12] },
    { id: "hole", type: TYPE.exit, shape: ["box", 17.5, 9.7, 0.24, 0.1] },
    { id: "kill-plane", type: TYPE.hazard, shape: ["box", 9.6, 10.72, 9.6, 0.08] },
  ],
};
