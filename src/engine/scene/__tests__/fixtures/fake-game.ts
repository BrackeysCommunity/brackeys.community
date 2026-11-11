import { readdirSync, readFileSync } from "node:fs";

import { z } from "zod";

import { defineBehavior } from "../../../game/behaviors";
import { createRegistry, defineEntityType, defineGame } from "../../../game/define";
import {
  angleField,
  materialField,
  pointField,
  shapeField,
  tagsField,
  vectorField,
} from "../../../game/fields";
import type { Registry, SceneSystem } from "../../../game/types";
import { makeIssue } from "../../issues";
import type { Prefab } from "../../types";

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
    speed: z
      .number()
      .positive()
      .describe("How fast it opens, m/s.")
      .meta({ title: "Speed", unit: "m/s" }),
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

/** The v3 prefab fixtures: a migration reads v3 bodies through this lookup. */
const PREFABS_DIR = new URL("./prefabs-v3/", import.meta.url);

const prefabFiles: Record<string, Prefab> = Object.fromEntries(
  readdirSync(PREFABS_DIR).map((f) => {
    const prefab = JSON.parse(readFileSync(new URL(f, PREFABS_DIR), "utf8")) as Prefab;
    return [prefab.id, prefab];
  }),
);

/**
 * The prefab fixtures by id, plus what the frozen kitchen-sink scene's
 * instances name beyond them: a `speed` param on `gate` and a `post` with a
 * `bar`.
 */
export const prefabFixtures: Readonly<Record<string, Prefab>> = {
  ...prefabFiles,
  gate: {
    ...prefabFiles.gate!,
    params: { speed: { description: "Door speed.", targets: ["door.path.speed"] } },
  },
  post: {
    kind: "prefab",
    v: 3,
    id: "post",
    entities: [{ id: "bar", type: "solid", shape: ["box", 0, -10, 60, 10] }],
  },
};

/** A migration's prefab lookup over `prefabFixtures`. */
export const prefabFixture = (id: string): Prefab | undefined => prefabFixtures[id];

const length = (description: string) => z.number().describe(description).meta({ unit: "m" });

const hover = defineBehavior({
  name: "metric/hover",
  description: "Floats above the ground.",
  fields: {
    height: length("How high it floats, m."),
    rise: z.number().optional().describe("How fast it rises, m/s.").meta({ unit: "m/s" }),
    turn: z.number().default(90).describe("How fast it turns, deg/s.").meta({ unit: "deg" }),
    delayMs: z.number().default(0).describe("Before it starts, ms.").meta({ unit: "ms" }),
  },
});

/** A marker with a length field of every shape the unit walker follows. */
const beacon = defineEntityType({
  type: "beacon",
  description: "A beacon with lengths in every kind of field.",
  base: "marker",
  fields: {
    at: pointField("Where it stands."),
    tags: tagsField("Labels."),
    reach: length("How far it reaches, m.").optional(),
    pad: length("Its padding, m.").default(4),
    offsets: z.array(vectorField("An offset.")).optional().describe("Offsets from `at`."),
    ranges: z.record(z.string(), length("A range, m.")).optional().describe("Ranges by name."),
    aim: z
      .discriminatedUnion("kind", [
        z.strictObject({ kind: z.literal("point"), at: pointField("What it aims at.") }),
        z.strictObject({ kind: z.literal("angle"), deg: angleField("Its heading.", "deg") }),
      ])
      .optional()
      .describe("Where it aims."),
    span: z
      .tuple([z.string()], z.number())
      .optional()
      .describe("A label, then lengths, m.")
      .meta({ unit: "m" }),
    weight: z.number().optional().describe("Unitless."),
  },
  bulk: { form: "point", description: "Beacons." },
});

/** A solid with its own bulk shapes, plain and by material. */
const plate = defineEntityType({
  type: "plate",
  description: "A plate.",
  base: "solid",
  fields: (env) => ({ shape: shapeField("Plate shape."), material: materialField(env) }),
  bulk: { form: "shape", materials: true, description: "Plates." },
});

/**
 * A game at `pxPerMetre` px per metre whose types, behavior, settings and
 * prefab contract hold lengths, for the v3 → v4 step's unit sites.
 */
export function metricRegistry(pxPerMetre: number): Registry {
  return createRegistry(
    defineGame({
      id: "metric",
      types: [beacon, plate],
      behaviors: [hover],
      actions: [],
      materials: { ice: { friction: 0, restitution: 0, description: "Slippery." } },
      settings: {
        floorY: length("The floor's height, m.").optional(),
        maxFall: z.number().optional().describe("The fastest fall, m/s.").meta({ unit: "m/s" }),
        label: z.string().optional().describe("A label."),
      },
      prefabContract: { reach: length("How far the prefab reaches, m.").optional() },
      world: { lengthUnit: pxPerMetre },
      createRuntime: () => ({ snapshot: () => null }),
    }),
  );
}
