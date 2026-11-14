/**
 * The `emitter` kind's file: a particle preset the `emitter` behavior and
 * `present.effects.burst` draw from. Presentation only, so it never joins
 * a run's hash. Zod, scene/ and project/ only, so the hosted service reads it.
 */
import { z } from "zod";

import type { BlendMode } from "../../context";
import { rgbSchema } from "../../game/color";
import { BLEND_MODES } from "../../game/defaults";
import { ID_PATTERN } from "../../game/fields";
import type { SceneIssue } from "../../scene/types";
import { assetInfo, atlasFrameIssue, type AssetInfo } from "../asset-info";
import type { RefSite } from "../refs";
import type { AssetId } from "../types";
import { ATLAS_KIND } from "./atlas";
import { defineAssetKind, folderOf, type KindEnv } from "./define";
import { TEXTURE_KIND } from "./texture";

export const EMITTER_KIND = "emitter";
export const EMITTER_VERSION = 1;
export const EMITTER_SCHEMA_ID = `urn:jams-engine:emitter:v${EMITTER_VERSION}`;

/** How many particles one emitter keeps alive when its preset gives no `max`. */
export const EMITTER_MAX_DEFAULT = 500;
/** The most particles one emitter may keep alive. */
export const EMITTER_MAX_CAP = 4096;

/** A curve over a particle's life: `[t, value]` keys sorted by t in 0–1, linear between. */
export type EmitterCurve = [t: number, value: number][];

/** An `emitter:v1` file. Lengths are world metres, speeds m/s. */
export type EmitterFile = {
  $schema?: string;
  kind: typeof EMITTER_KIND;
  v: typeof EMITTER_VERSION;
  /** A texture, or an atlas with `frame`; omitted, particles draw as small squares. */
  texture?: AssetId;
  frame?: string;
  blend?: BlendMode;
  /** Particles per second while emitting. */
  rate: number;
  bursts?: { atMs: number; count: number }[];
  lifeMs: [min: number, max: number];
  /** m/s. */
  speed: [min: number, max: number];
  /** Degrees, 0 = +x, clockwise (y down). */
  angle: [min: number, max: number];
  /** Constant acceleration, m/s². */
  drift?: [x: number, y: number];
  damping?: number;
  scale?: EmitterCurve;
  alpha?: EmitterCurve;
  tint?: EmitterCurve;
  /** Where particles are born around the emitter, metres. */
  shape?: { kind: "point" } | { kind: "circle"; r: number } | { kind: "box"; w: number; h: number };
  /** "world": particles stay where born; "local": they move with the entity. */
  space?: "world" | "local";
  /** At most this many alive; default 500, hard cap 4,096. */
  max?: number;
  /** How long it emits; omitted, while enabled. */
  durationMs?: number;
};

/** A `[min, max]` pair, refused when min exceeds max. */
const range = (value: z.ZodNumber, what: string) =>
  z
    .tuple([value.describe(`The least ${what}.`), value.describe(`The most ${what}.`)])
    .refine(([min, max]) => min <= max, { message: "min is more than max", path: [1] });

/** `[t, value]` keys, refused when a t is outside 0–1 or comes before the key above it. */
const curve = (value: z.ZodNumber, what: string) =>
  z
    .array(
      z.tuple([
        z.number().min(0).max(1).describe("t: 0 at a particle's birth, 1 at its death."),
        value.describe(what),
      ]),
    )
    .min(1)
    .superRefine((keys, ctx) => {
      keys.forEach(([t], i) => {
        const before = i > 0 ? keys[i - 1]?.[0] : undefined;
        if (before !== undefined && t < before)
          ctx.addIssue({
            code: "custom",
            message: `curve keys are sorted by t; key ${i} (t ${t}) comes after t ${before}`,
            path: [i, 0],
          });
      });
    });

const metres = (description: string) =>
  z.number().positive().meta({ unit: "m" }).describe(description);

const shapeSchema = z
  .discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("point").describe("Born at the emitter's point.") }),
    z.strictObject({
      kind: z.literal("circle").describe("Born anywhere inside a circle."),
      r: metres("Radius, m."),
    }),
    z.strictObject({
      kind: z.literal("box").describe("Born anywhere inside a box centred on the emitter."),
      w: metres("Width, m."),
      h: metres("Height, m."),
    }),
  ])
  .describe("Where particles are born around the emitter; default a point.");

const emitterSchema: z.ZodType<EmitterFile> = z
  .strictObject({
    $schema: z.string().optional().describe("The emitter JSON Schema this file follows."),
    kind: z.literal(EMITTER_KIND).describe('Always "emitter".'),
    v: z.literal(EMITTER_VERSION).describe("Emitter format version."),
    texture: z
      .string()
      .regex(ID_PATTERN)
      .optional()
      .describe(
        "A texture or atlas asset the particles draw; omitted, they draw as small squares.",
      ),
    frame: z.string().optional().describe("With an atlas texture: the frame the particles draw."),
    blend: z.enum(BLEND_MODES).optional().describe("How particles blend; default normal."),
    rate: z.number().min(0).describe("Particles per second while emitting; 0 for bursts only."),
    bursts: z
      .array(
        z.strictObject({
          atMs: z.number().min(0).describe("When the burst fires, ms after emitting starts."),
          count: z.number().int().min(1).describe("How many particles it fires at once."),
        }),
      )
      .optional()
      .describe("Particles fired at once at set times, each co-edited on its own."),
    lifeMs: range(z.number().positive(), "life in ms").describe(
      "How long each particle lives, ms: [min, max], picked per particle.",
    ),
    speed: range(z.number().min(0).meta({ unit: "m/s" }), "speed, m/s")
      .meta({ unit: "m/s" })
      .describe("Each particle's starting speed, m/s: [min, max]."),
    angle: range(z.number().meta({ unit: "deg" }), "angle, degrees")
      .meta({ unit: "deg" })
      .describe("Each particle's heading, degrees, 0 = +x, clockwise (y down): [min, max]."),
    drift: z
      .tuple([z.number().describe("x, m/s²."), z.number().describe("y, m/s²; y is down.")])
      .meta({ unit: "m/s²" })
      .optional()
      .describe("A constant acceleration every particle drifts by, m/s²."),
    damping: z
      .number()
      .min(0)
      .optional()
      .describe("How fast particles slow, per second; default 0."),
    scale: curve(z.number().min(0), "Scale.")
      .optional()
      .describe("Scale over a particle's life: [t, scale] keys sorted by t in 0–1; default 1."),
    alpha: curve(z.number().min(0).max(1), "Alpha, 0–1.")
      .optional()
      .describe("Alpha over a particle's life: [t, alpha] keys sorted by t in 0–1; default 1."),
    tint: curve(rgbSchema, "A colour, 0xRRGGBB as a number.")
      .optional()
      .describe(
        "Tint over a particle's life: [t, 0xRRGGBB] keys sorted by t in 0–1, blended per channel; default white.",
      ),
    shape: shapeSchema.optional(),
    space: z
      .enum(["world", "local"])
      .optional()
      .describe(
        "world: particles stay where born; local: they move with the entity. Default world.",
      ),
    max: z
      .number()
      .int()
      .min(1)
      .max(EMITTER_MAX_CAP)
      .optional()
      .describe(
        `At most this many particles alive at once; default ${EMITTER_MAX_DEFAULT}, at most ${EMITTER_MAX_CAP}.`,
      ),
    durationMs: z
      .number()
      .positive()
      .optional()
      .describe("How long it emits, ms; omitted, it emits while enabled."),
  })
  .describe(
    "A particle preset: rate and bursts, each particle's life, speed and heading, drift, and curves over its life. Drawn only, never simulated.",
  ) as unknown as z.ZodType<EmitterFile>;

/**
 * What's wrong with an emitter preset against the asset its `texture`
 * names, the one check every reader runs. `texture` is that asset's info,
 * or null when the host has none (a missing or wrong-kind asset is the ref
 * index's). An atlas needs a `frame` it has: `asset-frame-unknown`
 * otherwise, with a did-you-mean. Never throws.
 */
export function emitterIssues(
  file: EmitterFile,
  texture: AssetInfo | null | undefined,
): SceneIssue[] {
  const issue = atlasFrameIssue(texture, file.frame, { who: "the emitter", path: "/frame" });
  return issue ? [issue] : [];
}

/** Particle presets the `emitter` behavior and burst effects draw from; presentation only. */
export const emitterKind = defineAssetKind({
  kind: EMITTER_KIND,
  title: "Emitter",
  description:
    "Particle presets: rate, bursts, life, speed, heading, drift and curves over a particle's life, drawn by the emitter behavior and burst effects, never simulated.",
  match: { jsonKind: EMITTER_KIND },
  defaultFolder: (_env, near) => folderOf(near),
  storage: "doc",
  runtime: "view",
  version: EMITTER_VERSION,
  schemaId: EMITTER_SCHEMA_ID,
  schema: () => emitterSchema,
  layout: {
    as: "map",
    fields: { bursts: { as: "list", item: { as: "atomic" } } },
    rest: { as: "atomic" },
  },
  limits: { maxStateBytes: 32_768 },
  validate: (file: EmitterFile, env: KindEnv): SceneIssue[] =>
    emitterIssues(
      file,
      env.project && file.texture !== undefined ? assetInfo(env.project, file.texture) : null,
    ),
  refs: (file: EmitterFile): RefSite[] =>
    file.texture === undefined
      ? []
      : [{ pointer: "/texture", id: file.texture, kinds: [TEXTURE_KIND, ATLAS_KIND] }],
  /** A small upward spray of squares, for the author to tune. */
  empty: (): EmitterFile => ({
    kind: EMITTER_KIND,
    v: EMITTER_VERSION,
    rate: 20,
    lifeMs: [400, 800],
    speed: [1, 2],
    angle: [-120, -60],
  }),
});
