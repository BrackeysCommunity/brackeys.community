import type { GamePlayDef } from "@jams/engine/game";
import { z } from "zod";

import { PLAYER_HEIGHT, PLAYER_WIDTH } from "./entities/player";
import type { PlayerSnapshot } from "./runtime";

/**
 * How the runner plays headless and from the editor. It declares no
 * results yet, so its playtests end in `timeout`, `script-end` or `stuck`
 * until the platformer defines goals.
 */
export const PLATFORMER_PLAY: GamePlayDef<PlayerSnapshot> = {
  spawnShape: { type: "box", hw: PLAYER_WIDTH / 2, hh: PLAYER_HEIGHT / 2 },
  focus: (snapshot) => snapshot.position,
  movementActions: ["move_left", "move_right"],
  predicates: {
    grounded: {
      description: "The player is (true) or isn't (false) standing on something.",
      arg: z.boolean(),
      test: (arg, { snapshot }) => snapshot.grounded === arg,
    },
  },
};
