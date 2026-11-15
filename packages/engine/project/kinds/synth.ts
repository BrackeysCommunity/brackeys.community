/**
 * The `synth` kind's file: a sound effect's recipe (wave, pitch and its
 * slide, envelope, vibrato, filters, a noise seed) that renders once to a
 * one-channel buffer. Presentation only. The bounds every field is held to
 * live here, so the renderer, the presets and the schema share them. Zod,
 * scene/ and project/ only, so the hosted service reads it.
 */
import { z } from "zod";

import type { SceneIssue } from "../../scene/types";
import { defineAssetKind, folderOf } from "./define";

export const SYNTH_KIND = "synth";
export const SYNTH_VERSION = 1;
export const SYNTH_SCHEMA_ID = `urn:jams-engine:synth:v${SYNTH_VERSION}`;

export const SYNTH_WAVES = ["square", "saw", "triangle", "sine", "noise"] as const;
export type SynthWave = (typeof SYNTH_WAVES)[number];

/** A `synth:v1` file. Times are ms, pitch Hz, slides octaves per second. */
export type SynthFile = {
  $schema?: string;
  kind: typeof SYNTH_KIND;
  v: typeof SYNTH_VERSION;
  wave: SynthWave;
  /** Square only: the high part of the cycle (default `SYNTH_DEFAULTS.duty`), and its change per second. */
  duty?: number;
  dutySweep?: number;
  /** Hz at the start. */
  freq: number;
  /** Octaves per second, negative falls; `slideAccel` changes it, octaves per second². */
  slide?: number;
  slideAccel?: number;
  /** One pitch step, `atMs` in (a pickup's second note). */
  jump?: { atMs: number; semitones: number };
  vibrato?: { semitones: number; hz: number };
  /** The volume envelope; `punch` (0–1) lifts the start of the sustain. */
  attackMs?: number;
  sustainMs: number;
  punch?: number;
  decayMs: number;
  /** `sweep` moves the cutoff, octaves per second. */
  lowpass?: { hz: number; sweep?: number; resonance?: number };
  highpass?: { hz: number; sweep?: number };
  /** Restart pitch and duty every this many ms (a stutter). */
  retriggerMs?: number;
  /** Seeds `noise`; default `SYNTH_DEFAULTS.seed`. */
  seed?: number;
  /** 0–1, default `SYNTH_DEFAULTS.volume`. */
  volume?: number;
};

/** A numeric field's path in a patch, nested fields joined by a dot. */
export type SynthNumberPath =
  | "duty"
  | "dutySweep"
  | "freq"
  | "slide"
  | "slideAccel"
  | "jump.atMs"
  | "jump.semitones"
  | "vibrato.semitones"
  | "vibrato.hz"
  | "attackMs"
  | "sustainMs"
  | "punch"
  | "decayMs"
  | "lowpass.hz"
  | "lowpass.sweep"
  | "lowpass.resonance"
  | "highpass.hz"
  | "highpass.sweep"
  | "retriggerMs"
  | "volume";

/** Every numeric field's least and most value: what the schema holds a patch to and a mutation clamps to. */
export const SYNTH_BOUNDS: Readonly<Record<SynthNumberPath, readonly [min: number, max: number]>> =
  Object.freeze({
    duty: [0.05, 0.95],
    dutySweep: [-4, 4],
    freq: [20, 8_000],
    slide: [-8, 8],
    slideAccel: [-32, 32],
    "jump.atMs": [0, 5_000],
    "jump.semitones": [-24, 24],
    "vibrato.semitones": [0, 12],
    "vibrato.hz": [0, 40],
    attackMs: [0, 1_000],
    sustainMs: [0, 2_000],
    punch: [0, 1],
    decayMs: [0, 2_000],
    "lowpass.hz": [20, 20_000],
    "lowpass.sweep": [-8, 8],
    "lowpass.resonance": [0, 1],
    "highpass.hz": [20, 20_000],
    "highpass.sweep": [-8, 8],
    retriggerMs: [10, 5_000],
    volume: [0, 1],
  });

/** What the renderer reads for an unset `duty`, `volume` and `seed`; every other unset number is 0. */
export const SYNTH_DEFAULTS: Readonly<{ duty: number; volume: number; seed: number }> =
  Object.freeze({ duty: 0.5, volume: 1, seed: 1 });

type BoundedMeta = {
  unit?: string;
  title?: string;
  default?: number;
  /** The editor's arrow step and decimals shown, where the unit's own don't suit. */
  step?: number;
  decimals?: number;
};

/** A cutoff or pitch in whole Hz is as fine as an ear tells apart. */
const WHOLE_HZ = { unit: "Hz", step: 1, decimals: 0 } as const;

const bounded = (path: SynthNumberPath, description: string, meta: BoundedMeta = {}) => {
  const [min, max] = SYNTH_BOUNDS[path];
  const n = z.number().min(min).max(max).describe(`${description} ${min} to ${max}.`);
  return Object.keys(meta).length > 0 ? n.meta(meta) : n;
};

const synthSchema: z.ZodType<SynthFile> = z
  .strictObject({
    $schema: z.string().optional().describe("The synth JSON Schema this file follows."),
    kind: z.literal(SYNTH_KIND).describe('Always "synth".'),
    v: z.literal(SYNTH_VERSION).describe("Synth format version."),
    wave: z.enum(SYNTH_WAVES).describe("The oscillator: square, saw, triangle, sine or noise."),
    duty: bounded(
      "duty",
      `Square only: the high part of the cycle; default ${SYNTH_DEFAULTS.duty}.`,
      { default: SYNTH_DEFAULTS.duty },
    ).optional(),
    dutySweep: bounded("dutySweep", "Square only: the duty's change per second.").optional(),
    freq: bounded("freq", "The pitch at the start, Hz.", { ...WHOLE_HZ, title: "Frequency" }),
    slide: bounded("slide", "Pitch slide, octaves per second; negative falls.").optional(),
    slideAccel: bounded("slideAccel", "The slide's change, octaves per second².").optional(),
    jump: z
      .strictObject({
        atMs: bounded("jump.atMs", "When the step happens, ms in.", { unit: "ms", title: "At" }),
        semitones: bounded("jump.semitones", "The step, semitones.", { title: "Step" }),
      })
      .optional()
      .describe("One pitch step part way through, as a pickup's second note."),
    vibrato: z
      .strictObject({
        semitones: bounded("vibrato.semitones", "Depth, semitones.", { title: "Depth" }),
        hz: bounded("vibrato.hz", "Rate, Hz.", { unit: "Hz", title: "Rate" }),
      })
      .optional()
      .describe("A wobble in pitch."),
    attackMs: bounded("attackMs", "Rise to full volume, ms; default 0.", {
      unit: "ms",
      title: "Attack",
    }).optional(),
    sustainMs: bounded("sustainMs", "Time at full volume, ms.", { unit: "ms", title: "Sustain" }),
    punch: bounded("punch", "Lifts the start of the sustain; default 0.").optional(),
    decayMs: bounded("decayMs", "Fall to silence, ms.", { unit: "ms", title: "Decay" }),
    lowpass: z
      .strictObject({
        hz: bounded("lowpass.hz", "Cutoff, Hz.", { ...WHOLE_HZ, title: "Cutoff" }),
        sweep: bounded("lowpass.sweep", "Cutoff change, octaves per second.").optional(),
        resonance: bounded("lowpass.resonance", "Peak at the cutoff; default 0.").optional(),
      })
      .optional()
      .describe("Cuts what is above the cutoff."),
    highpass: z
      .strictObject({
        hz: bounded("highpass.hz", "Cutoff, Hz.", { ...WHOLE_HZ, title: "Cutoff" }),
        sweep: bounded("highpass.sweep", "Cutoff change, octaves per second.").optional(),
      })
      .optional()
      .describe("Cuts what is below the cutoff."),
    retriggerMs: bounded("retriggerMs", "Restarts pitch and duty every this many ms (a stutter).", {
      unit: "ms",
      title: "Retrigger",
    }).optional(),
    seed: z
      .number()
      .int()
      .min(1)
      .max(0xffff_ffff)
      .optional()
      .describe(`Seeds the noise wave; default ${SYNTH_DEFAULTS.seed}.`)
      .meta({ default: SYNTH_DEFAULTS.seed }),
    volume: bounded("volume", `Loudness; default ${SYNTH_DEFAULTS.volume}.`, {
      default: SYNTH_DEFAULTS.volume,
    }).optional(),
  })
  .describe(
    "A sound effect's recipe, rendered once to a one-channel buffer and played like any clip. Presentation only.",
  ) as unknown as z.ZodType<SynthFile>;

/** Sound-effect recipes a sound's variants name in place of a clip; presentation only. */
export const synthKind = defineAssetKind({
  kind: SYNTH_KIND,
  title: "Synth patch",
  description:
    "A sound effect's recipe (wave, pitch slide, envelope, vibrato, filters), rendered once to a buffer and played like a clip.",
  match: { jsonKind: SYNTH_KIND },
  defaultFolder: (_env, near) => folderOf(near),
  storage: "doc",
  runtime: "view",
  version: SYNTH_VERSION,
  schemaId: SYNTH_SCHEMA_ID,
  schema: () => synthSchema,
  layout: { as: "map", rest: { as: "atomic" } },
  limits: { maxStateBytes: 4_096 },
  validate: (): SceneIssue[] => [],
  /** A short square blip. */
  empty: (): SynthFile => ({
    kind: SYNTH_KIND,
    v: SYNTH_VERSION,
    wave: "square",
    freq: 440,
    sustainMs: 60,
    decayMs: 120,
  }),
});
