import type { SceneTemplate } from "@jams/engine/game";

/** A new skirmish: the 12 × 8 m board with a knight on each side, facing across it. */
export const TACTICS_TEMPLATE: SceneTemplate = {
  bounds: [0, 0, 12, 8],
  entities: [
    { id: "blue-1", type: "unit", at: [1.5, 3.5], side: "blue", class: "knight" },
    { id: "red-1", type: "unit", at: [10.5, 4.5], side: "red", class: "knight" },
  ],
};
