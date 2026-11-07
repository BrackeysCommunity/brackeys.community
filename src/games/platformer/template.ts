import type { SceneTemplate } from "@jams/engine/game";

import { TYPE } from "./type-names";

/** A new platformer scene: a floor, a spawn on it, the cheese and the hole, and lava below. */
export const PLATFORMER_TEMPLATE: SceneTemplate = {
  bounds: [0, 0, 1920, 1080],
  solid: [["box", 960, 1000, 960, 20]],
  [TYPE.spawn]: [[200, 980]],
  entities: [
    { id: "cheese", type: TYPE.goal, shape: ["circle", 1500, 950, 12] },
    { id: "hole", type: TYPE.exit, shape: ["box", 1750, 970, 24, 10] },
    { id: "kill-plane", type: TYPE.hazard, shape: ["box", 960, 1072, 960, 8] },
  ],
};
