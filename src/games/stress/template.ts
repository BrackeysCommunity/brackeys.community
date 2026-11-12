import type { SceneTemplate } from "@jams/engine/game";

/** A walled room with one spawner over the floor, in metres. */
export const TEMPLATE: SceneTemplate = {
  bounds: [0, 0, 8, 6],
  solid: [
    ["box", 4, 0.1, 4, 0.1],
    ["box", 4, 5.9, 4, 0.1],
    ["box", 0.1, 3, 0.1, 2.8],
    ["box", 7.9, 3, 0.1, 2.8],
  ],
  entities: [{ id: "spawner", type: "spawner", at: [4, 1] }],
};
