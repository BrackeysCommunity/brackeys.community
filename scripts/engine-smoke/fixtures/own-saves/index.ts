import { defineGame } from "@jams/engine/game";

import { ACTIONS } from "./actions";
import { PLAY } from "./play";
import { createRuntime } from "./runtime";
import { ownServerStore, saveServerOrigin } from "./store";
import { TEMPLATE } from "./template";
import { GAME_ID, heroType, type Snapshot } from "./types";

/**
 * Own saves: the play smoke's game with its own save backend. A hero to
 * steer round a wall to a goal, and saves that go to the server the page's
 * query names, never through the host.
 */
export const ownSavesGame = defineGame<Snapshot>({
  id: GAME_ID,
  types: [heroType],
  actions: ACTIONS,
  // The hero's body moves into sensors.
  collisionGroups: { dynamic: { collidesWith: ["sensor"] } },
  // Metres in the simulation, 100 px per metre on screen.
  world: {
    physics: "none",
    gravity: [0, 0],
    lengthUnit: 100,
  },
  time: { kind: "fixed", rate: 60 },
  play: PLAY,
  template: TEMPLATE,
  createRuntime,
  saves: { version: 1, store: () => ownServerStore(saveServerOrigin()) },
});
