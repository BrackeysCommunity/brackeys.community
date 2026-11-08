import {
  DEFAULT_LAYERS,
  defineBehavior,
  defineEntityType,
  defineGame,
  gridField,
  pointField,
  primitiveFields,
} from "@jams/engine/game";
import { z } from "zod";

import { coinGame } from "./coin-game";

/** Data only: game code reads it off `entity.behaviors["coin-game/loot"]`. */
export const loot = defineBehavior({
  name: "coin-game/loot",
  description: "What the entity drops when it's collected.",
  fields: {
    table: z.string().default("common").describe("The loot table it rolls on; default common."),
    rolls: z.number().int().min(1).default(1).describe("How many times it rolls; default 1."),
  },
  inspector: { label: "Loot", order: ["rolls", "table"] },
});

/** A chest always carries loot: three rolls unless a scene says otherwise. */
const chest = defineEntityType({
  type: "chest",
  description: "A chest: entering it opens it.",
  base: "sensor",
  fields: (env) => primitiveFields("sensor", env),
  behaviors: { required: { [loot.name]: { rolls: 3 } } },
});

/** Floor tiles on the scene's grid, local to `at`. */
const floor = defineEntityType({
  type: "floor",
  description: "Painted floor tiles.",
  base: "marker",
  fields: {
    at: pointField("The grid's origin."),
    tiles: gridField("The tiles.", { values: ["stone", "grass", "water"] }),
  },
  behaviors: { forbidden: "all" },
});

export const lootGame = defineGame({
  ...coinGame,
  types: [...coinGame.types, chest, floor],
  behaviors: [loot],
  // Bottom to top: a backdrop that scrolls at half speed, then the engine's four.
  layers: [
    { name: "sky", description: "The far backdrop.", draw: -5, scroll: [0.5, 0.5] },
    ...DEFAULT_LAYERS,
  ],
});
