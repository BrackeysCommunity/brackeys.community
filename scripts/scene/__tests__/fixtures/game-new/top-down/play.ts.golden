import type { GamePlayDef } from "@jams/engine/game";

import { REACHED, type Snapshot } from "./types";

/** Won when the hero reaches a goal. */
export const PLAY: GamePlayDef<Snapshot> = {
  results: ["won"],
  focus: (snapshot) => snapshot.at,
  movementActions: ["move"],
  outcome({ events }) {
    const goal = events.find((e) => e.type === REACHED);
    return goal
      ? { result: "won", cause: "the hero reached the goal", entityId: goal.entityId }
      : null;
  },
};
