import { readFileSync } from "node:fs";

import { z } from "zod";

import { createRegistry, defineEntityType, defineGame } from "../../../game/define";
import { materialField, pointField, shapeField, tagsField } from "../../../game/fields";
import type { SceneSystem } from "../../../game/types";
import { makeIssue } from "../../issues";

/** A registry without a game: the engine's primitives. */
export const engine = createRegistry();

export const engineYardText = readFileSync(
  new URL("../../../scenes/engine-yard.json", import.meta.url),
  "utf8",
);

const inert = (): SceneSystem => ({
  spawn: () => {},
  despawn: () => {},
  clear: () => {},
  size: () => 0,
});

/** Box-only one-way pads, with plain and material bulk keys. */
const pad = defineEntityType({
  type: "pad",
  description: "A one-way pad, box only.",
  base: "solid",
  fields: (env) => ({
    shape: shapeField("Pad shape, box only.", { types: ["box"], id: "PadShape", owner: "a pad's" }),
    material: materialField(env),
  }),
  bulk: { form: "shape", materials: true, description: "One-way pads, box only." },
});

/** Point bulk form. */
const flag = defineEntityType({
  type: "flag",
  description: "A finish flag.",
  base: "marker",
  fields: { at: pointField("Where the flag stands."), tags: tagsField("Labels.") },
  bulk: { form: "point", description: "Finish flags." },
});

/** Based on sensor, so a reference to sensors may name it. */
const button = defineEntityType({
  type: "button",
  description: "A button a door listens to.",
  base: "sensor",
  fields: { shape: shapeField("Button shape."), tags: tagsField("Labels.") },
});

/** Its own system, a reference field, and a field the engine knows nothing about. */
const door = defineEntityType({
  type: "door",
  description: "A door its switch opens.",
  system: inert,
  fields: {
    shape: shapeField("Door shape."),
    opens: z.string().optional().describe("The sensor that opens it.").meta({ title: "Opens" }),
    speed: z.number().positive().describe("How fast it opens, px/s.").meta({ title: "Speed" }),
  },
  refs: [{ field: "opens", targets: ["sensor"] }],
});

export const fakeGame = defineGame({
  id: "fake",
  types: [pad, flag, button, door],
  actions: [{ action: "jump", keys: ["Space"], description: "Jump." }],
  materials: { mud: { friction: 2, restitution: 0, description: "Sticky ground." } },
  settings: {
    lives: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Lives per run.")
      .meta({ title: "Lives" }),
  },
  issues: {
    "fake/no-flag": { severity: "warn", summary: "No flag.", hint: "Add a flag.", fixable: false },
  },
  validators: [
    (def, { registry }) =>
      Array.isArray(def.flag) && def.flag.length > 0
        ? []
        : [
            makeIssue(
              "fake/no-flag",
              { message: "the scene has no flag", path: "" },
              registry.issueCodes,
            ),
          ],
  ],
  createRuntime: () => ({ snapshot: () => null }),
});

export const fake = createRegistry(fakeGame);
