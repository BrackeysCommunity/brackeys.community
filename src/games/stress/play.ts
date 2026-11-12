import type { GamePlayDef } from "@jams/engine/game";
import { z } from "zod";

import { COUNTERS, type Counter, type Snapshot } from "./types";

const atLeast = z.number().int().min(0).optional();

/** No run is won or lost; a script waits on the snapshot's counters with `counts`. */
export const PLAY: GamePlayDef<Snapshot> = {
  predicates: {
    counts: {
      description:
        "Holds while each counter named is at least the number given: agents and pellets alive, pellets spawned and destroyed, sensor enters and exits.",
      arg: z.strictObject(
        Object.fromEntries(COUNTERS.map((c) => [c, atLeast])) as Record<Counter, typeof atLeast>,
      ),
      test: (arg, { snapshot }) =>
        COUNTERS.every((c) => snapshot[c] >= ((arg as Partial<Record<Counter, number>>)[c] ?? 0)),
    },
  },
};
