import type { GameCommand, GamePlayDef } from "@jams/engine/game";
import { z } from "zod";

import { legal } from "./rules";
import type { TacticsRunSnapshot } from "./runtime";
import { TACTICS_SIDES, tacticsBoard } from "./types";

/**
 * How the skirmish plays headless: `won` when the red side is gone, `lost`
 * when the blue one is. The legal list is the player's orders, so fuzz and
 * `step --legal` only ever play blue; red's turn is the game's own.
 */
export const TACTICS_PLAY: GamePlayDef<TacticsRunSnapshot> = {
  results: ["won", "lost"],
  outcome: ({ snapshot }) =>
    snapshot.result === "won"
      ? { result: "won", cause: "the red side is gone" }
      : snapshot.result === "lost"
        ? { result: "lost", cause: "the blue side is gone" }
        : null,
  commands({ snapshot }): GameCommand[] {
    if (snapshot.side !== "blue") return [];
    return legal(snapshot, snapshot.classes, tacticsBoard(snapshot.grid)).map((c) =>
      c.name === "end-turn" ? { name: c.name } : { name: c.name, args: c.args },
    );
  },
  predicates: {
    turn: {
      description: "The turn number has reached this one (the first turn is 1).",
      arg: z.number().int().min(1),
      test: (arg, { snapshot }) => snapshot.turn >= (arg as number),
    },
    side: {
      description: 'The side to act is this one: "blue" (the player) or "red".',
      arg: z.enum(TACTICS_SIDES),
      test: (arg, { snapshot }) => snapshot.side === arg,
    },
  },
};
