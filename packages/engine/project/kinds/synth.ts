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

/** The pitched waves a second or third oscillator plays; noise has its own mixer level. */
export const SYNTH_OSC_WAVES = ["square", "saw", "triangle", "sine"] as const;
export type SynthOscWave = (typeof SYNTH_OSC_WAVES)[number];

/** The LFO's shapes; `random` holds a new seeded value each cycle (sample and hold). */
export const SYNTH_LFO_WAVES = ["sine", "triangle", "square", "saw", "random"] as const;
export type SynthLfoWave = (typeof SYNTH_LFO_WAVES)[number];

/** An oscillator beside the first, tuned from it. */
export type SynthOsc = {
  wave: SynthOscWave;
  /** Whole octaves from the first oscillator. */
  octave?: number;
  /** Cents from the first oscillator. */
  detune?: number;
  /** Its mixer level, default 1. */
  level?: number;
};

/** Attack, decay, sustain level and release; the gate is the patch's attack plus sustain. */
export type SynthAdsr = {
  attackMs?: number;
  decayMs?: number;
  sustain?: number;
  releaseMs?: number;
};

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
  /** The first oscillator's mixer level, default 1. */
  level?: number;
  osc2?: SynthOsc;
  osc3?: SynthOsc;
  /** White noise in the mixer, 0–1. */
  noise?: number;
  /**
   * The amp envelope's decay to `ampSustain` (default 1, so no decay) during
   * `sustainMs`, the gate; `decayMs` is then its release.
   */
  ampDecayMs?: number;
  ampSustain?: number;
  /**
   * A resonant four-pole (24 dB per octave) ladder low-pass after the mixer.
   * `envAmount` is octaves at the filter envelope's peak, `keyTrack` how far
   * the cutoff follows the pitch from middle C, `drive` how hard it's pushed.
   */
  filter?: {
    cutoff: number;
    resonance?: number;
    envAmount?: number;
    keyTrack?: number;
    drive?: number;
  };
  filterEnv?: SynthAdsr;
  /** `pitch` semitones, `cutoff` octaves and `amp` (0–1) of modulation at full swing. */
  lfo?: { wave: SynthLfoWave; hz: number; pitch?: number; cutoff?: number; amp?: number };
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
  | "volume"
  | "level"
  | "osc2.octave"
  | "osc2.detune"
  | "osc2.level"
  | "osc3.octave"
  | "osc3.detune"
  | "osc3.level"
  | "noise"
  | "ampDecayMs"
  | "ampSustain"
  | "filter.cutoff"
  | "filter.resonance"
  | "filter.envAmount"
  | "filter.keyTrack"
  | "filter.drive"
  | "filterEnv.attackMs"
  | "filterEnv.decayMs"
  | "filterEnv.sustain"
  | "filterEnv.releaseMs"
  | "lfo.hz"
  | "lfo.pitch"
  | "lfo.cutoff"
  | "lfo.amp";

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
    level: [0, 1],
    "osc2.octave": [-3, 3],
    "osc2.detune": [-100, 100],
    "osc2.level": [0, 1],
    "osc3.octave": [-3, 3],
    "osc3.detune": [-100, 100],
    "osc3.level": [0, 1],
    noise: [0, 1],
    ampDecayMs: [0, 2_000],
    ampSustain: [0, 1],
    "filter.cutoff": [20, 20_000],
    "filter.resonance": [0, 1],
    "filter.envAmount": [-8, 8],
    "filter.keyTrack": [0, 1],
    "filter.drive": [0, 1],
    "filterEnv.attackMs": [0, 2_000],
    "filterEnv.decayMs": [0, 2_000],
    "filterEnv.sustain": [0, 1],
    "filterEnv.releaseMs": [0, 2_000],
    "lfo.hz": [0, 40],
    "lfo.pitch": [0, 12],
    "lfo.cutoff": [0, 4],
    "lfo.amp": [0, 1],
  });

/** Whether the numeric field at `path` holds whole numbers (an oscillator's octave). */
export const isWholeSynthField = (path: SynthNumberPath): boolean => path.endsWith(".octave");

/** The number at `path` in `patch`; undefined when it or its block is unset. */
export function synthField(patch: SynthFile, path: SynthNumberPath): number | undefined {
  let node: unknown = patch;
  for (const key of path.split(".")) {
    node =
      node !== null && typeof node === "object"
        ? (node as Record<string, unknown>)[key]
        : undefined;
  }
  return typeof node === "number" ? node : undefined;
}

/**
 * A copy of `patch` with `value` at dot `path` (undefined removes it), the
 * blocks on the way copied too, so `patch` itself never changes.
 */
export function withSynthField(patch: SynthFile, path: string, value: unknown): SynthFile {
  const keys = path.split(".");
  const write = (node: unknown, at: number): Record<string, unknown> => {
    const copy: Record<string, unknown> =
      node !== null && typeof node === "object" ? { ...(node as Record<string, unknown>) } : {};
    const key = keys[at]!;
    const next = at === keys.length - 1 ? value : write(copy[key], at + 1);
    if (next === undefined) delete copy[key];
    else copy[key] = next;
    return copy;
  };
  return write(patch, 0) as SynthFile;
}

/** What the renderer reads for these when unset; every other unset number is 0. */
export const SYNTH_DEFAULTS: Readonly<{
  duty: number;
  volume: number;
  seed: number;
  level: number;
  oscLevel: number;
  ampSustain: number;
}> = Object.freeze({ duty: 0.5, volume: 1, seed: 1, level: 1, oscLevel: 1, ampSustain: 1 });

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
  const number = isWholeSynthField(path) ? z.number().int() : z.number();
  const n = number.min(min).max(max).describe(`${description} ${min} to ${max}.`);
  return Object.keys(meta).length > 0 ? n.meta(meta) : n;
};

function oscSchema(osc: "osc2" | "osc3") {
  return z.strictObject({
    wave: z.enum(SYNTH_OSC_WAVES).describe("Its wave: square, saw, triangle or sine."),
    octave: bounded(`${osc}.octave`, "Whole octaves from the first oscillator; default 0.", {
      title: "Octave",
    }).optional(),
    detune: bounded(`${osc}.detune`, "Cents from the first oscillator; default 0.", {
      unit: "ct",
      title: "Detune",
    }).optional(),
    level: bounded(`${osc}.level`, `Its mixer level; default ${SYNTH_DEFAULTS.oscLevel}.`, {
      default: SYNTH_DEFAULTS.oscLevel,
    }).optional(),
  });
}

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
    dutySweep: bounded("dutySweep", "Square only: the duty's change per second.", {
      unit: "/s",
    }).optional(),
    freq: bounded("freq", "The pitch at the start, Hz.", { ...WHOLE_HZ, title: "Frequency" }),
    slide: bounded("slide", "Pitch slide, octaves per second; negative falls.", {
      unit: "oct/s",
    }).optional(),
    slideAccel: bounded("slideAccel", "The slide's change, octaves per second².", {
      unit: "oct/s²",
    }).optional(),
    jump: z
      .strictObject({
        atMs: bounded("jump.atMs", "When the step happens, ms in.", { unit: "ms", title: "At" }),
        semitones: bounded("jump.semitones", "The step, semitones.", { unit: "st", title: "Step" }),
      })
      .optional()
      .describe("One pitch step part way through, as a pickup's second note."),
    vibrato: z
      .strictObject({
        semitones: bounded("vibrato.semitones", "Depth, semitones.", {
          unit: "st",
          title: "Depth",
        }),
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
        sweep: bounded("lowpass.sweep", "Cutoff change, octaves per second.", {
          unit: "oct/s",
        }).optional(),
        resonance: bounded("lowpass.resonance", "Peak at the cutoff; default 0.").optional(),
      })
      .optional()
      .describe("Cuts what is above the cutoff."),
    highpass: z
      .strictObject({
        hz: bounded("highpass.hz", "Cutoff, Hz.", { ...WHOLE_HZ, title: "Cutoff" }),
        sweep: bounded("highpass.sweep", "Cutoff change, octaves per second.", {
          unit: "oct/s",
        }).optional(),
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
    level: bounded(
      "level",
      `The first oscillator's mixer level; default ${SYNTH_DEFAULTS.level}.`,
      {
        default: SYNTH_DEFAULTS.level,
        title: "Osc 1 level",
      },
    ).optional(),
    osc2: oscSchema("osc2").optional().describe("A second oscillator, tuned from the first."),
    osc3: oscSchema("osc3").optional().describe("A third oscillator, tuned from the first."),
    noise: bounded("noise", "White noise in the mixer; default 0.").optional(),
    ampDecayMs: bounded(
      "ampDecayMs",
      "The volume's fall to the amp sustain level during the sustain, ms; default 0.",
      { unit: "ms", title: "Amp decay" },
    ).optional(),
    ampSustain: bounded(
      "ampSustain",
      `The level the volume falls to during the sustain; default ${SYNTH_DEFAULTS.ampSustain}.`,
      { default: SYNTH_DEFAULTS.ampSustain, title: "Amp sustain" },
    ).optional(),
    filter: z
      .strictObject({
        cutoff: bounded("filter.cutoff", "Cutoff, Hz.", { ...WHOLE_HZ, title: "Cutoff" }),
        resonance: bounded(
          "filter.resonance",
          "Peak at the cutoff, ringing near 1; default 0.",
        ).optional(),
        envAmount: bounded(
          "filter.envAmount",
          "Octaves the filter envelope moves the cutoff at its peak; default 0.",
          { title: "Envelope" },
        ).optional(),
        keyTrack: bounded(
          "filter.keyTrack",
          "How far the cutoff follows the pitch from middle C; default 0.",
          { title: "Key track" },
        ).optional(),
        drive: bounded("filter.drive", "Pushes the filter into saturation; default 0.").optional(),
      })
      .optional()
      .describe("A resonant 24 dB per octave ladder low-pass after the mixer."),
    filterEnv: z
      .strictObject({
        attackMs: bounded("filterEnv.attackMs", "Rise, ms; default 0.", {
          unit: "ms",
          title: "Attack",
        }).optional(),
        decayMs: bounded("filterEnv.decayMs", "Fall to the sustain level, ms; default 0.", {
          unit: "ms",
          title: "Decay",
        }).optional(),
        sustain: bounded("filterEnv.sustain", "Level held until the gate ends; default 0.", {
          title: "Sustain",
        }).optional(),
        releaseMs: bounded("filterEnv.releaseMs", "Fall to 0 after the gate, ms; default 0.", {
          unit: "ms",
          title: "Release",
        }).optional(),
      })
      .optional()
      .describe("The filter's envelope; the gate is the attack plus the sustain."),
    lfo: z
      .strictObject({
        wave: z.enum(SYNTH_LFO_WAVES).describe("Its shape: sine, triangle, square, saw or random."),
        hz: bounded("lfo.hz", "Rate, Hz.", { unit: "Hz", title: "Rate" }),
        pitch: bounded("lfo.pitch", "Pitch swing, semitones; default 0.").optional(),
        cutoff: bounded("lfo.cutoff", "Cutoff swing, octaves; default 0.").optional(),
        amp: bounded("lfo.amp", "Volume swing; default 0.", { title: "Amp" }).optional(),
      })
      .optional()
      .describe("A slow oscillator that moves the pitch, the cutoff or the volume."),
  })
  .describe(
    "A sound effect's recipe, rendered once to a one-channel buffer and played like any clip. Presentation only.",
  ) as unknown as z.ZodType<SynthFile>;

/** What the schema says of a numeric field: whether a patch may leave it out, and the default its meta names. */
export type SynthFieldMeta = { optional: boolean; default?: number };

/** The schema's word on the numeric field at `path`, read from the schema itself. */
export function synthFieldMeta(path: SynthNumberPath): SynthFieldMeta {
  let field: z.ZodType = synthSchema as unknown as z.ZodType;
  for (const key of path.split(".")) {
    let object: z.core.$ZodType = field;
    while ("innerType" in object._zod.def)
      object = (object._zod.def as { innerType: z.core.$ZodType }).innerType;
    field = (object as z.ZodObject).shape[key] as z.ZodType;
  }
  const optional = field.safeParse(undefined).success;
  for (let s: z.ZodType | undefined = field; s; ) {
    const fallback = s.meta()?.default;
    if (typeof fallback === "number") return { optional, default: fallback };
    const def = s._zod.def as { innerType?: z.ZodType };
    s = def.innerType;
  }
  return { optional };
}

/** Sound-effect recipes a sound's variants name in place of a clip; presentation only. */
export const synthKind = defineAssetKind({
  kind: SYNTH_KIND,
  title: "Synth patch",
  description:
    "A sound effect's recipe (oscillators, pitch slide, envelopes, a ladder filter, an LFO), rendered once to a buffer and played like a clip.",
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
