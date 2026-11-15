import type { Vec2 } from "../../../types";
import type { PlayPickGame } from "../../panels/PlayPick";

/** The play bar's Alt+click picking seams, for a stand-in game that doesn't test picking. */
export function pickSeams(): PlayPickGame {
  return {
    router: { register: () => () => {} },
    debug: { pick: async () => null },
    screenToWorld: (p: Vec2) => p,
  } as unknown as PlayPickGame;
}
