import { createRegistry, defineEntityType, defineGame } from "../../game/define";
import { angleField, mirrorField, pointField } from "../../game/fields";
import { testGame } from "./test-game";

/** A game type based on the node primitive, with the node's own angle and mirror. */
export const PIVOT = defineEntityType({
  type: "pivot",
  description: "A hub based on the node primitive.",
  base: "node",
  fields: {
    at: pointField("Its origin."),
    rot: angleField("Its angle, degrees clockwise.", "deg").optional(),
    flip: mirrorField("x", "Mirror x in its frame, before `rot`.").optional(),
  },
});

/** The test game with `pivot` added. */
export const pivotGame = defineGame({ ...testGame, types: [...testGame.types, PIVOT] });

export const pivotRegistry = () => createRegistry(pivotGame);
