/** Starting points for a patch, and small random changes to one. Pure. */
import { clamp } from "../math";
import {
  SYNTH_BOUNDS,
  SYNTH_KIND,
  SYNTH_VERSION,
  synthField,
  withSynthField,
  type SynthFile,
  type SynthNumberPath,
  type SynthWave,
} from "../project/kinds/synth";
import { unitFloat, type Rng } from "../sim-kit/rng";

export const SYNTH_PRESETS = [
  "pickup",
  "jump",
  "hit",
  "explosion",
  "laser",
  "powerup",
  "blip",
] as const;
export type SynthPreset = (typeof SYNTH_PRESETS)[number];

/** The calibration click when `calibrateLatency` is given no sound: a short square blip. */
export const CLICK_PATCH: SynthFile = Object.freeze({
  kind: SYNTH_KIND,
  v: SYNTH_VERSION,
  wave: "square",
  freq: 1_000,
  sustainMs: 8,
  decayMs: 12,
});

const between = (rng: Rng, lo: number, hi: number): number => lo + (hi - lo) * unitFloat(rng);
const pickWave = (rng: Rng, waves: readonly SynthWave[]): SynthWave => rng.pick(waves);

/** Whole ms, Hz to a tenth, everything else to a thousandth: a patch file stays readable. */
function tidy(path: SynthNumberPath, v: number): number {
  const [min, max] = SYNTH_BOUNDS[path];
  const step = path.endsWith("Ms") ? 1 : path === "freq" || path.endsWith(".hz") ? 10 : 1_000;
  const rounded = step === 1 ? Math.round(v) : Math.round(v * step) / step;
  return clamp(rounded, min, max);
}

/** Every numeric field the patch holds, rounded and held to the schema's bounds. */
function settle(patch: SynthFile): SynthFile {
  let out = patch;
  for (const path of Object.keys(SYNTH_BOUNDS) as SynthNumberPath[]) {
    const v = synthField(out, path);
    if (v !== undefined) out = withSynthField(out, path, tidy(path, v));
  }
  return out;
}

function draw(preset: SynthPreset, rng: Rng): SynthFile {
  const base = { kind: SYNTH_KIND, v: SYNTH_VERSION } as const;
  switch (preset) {
    case "pickup":
      return {
        ...base,
        wave: pickWave(rng, ["square", "saw", "triangle"]),
        duty: between(rng, 0.2, 0.6),
        freq: between(rng, 600, 1_600),
        jump: { atMs: between(rng, 40, 120), semitones: rng.range(3, 12) },
        sustainMs: between(rng, 40, 120),
        punch: between(rng, 0.2, 0.6),
        decayMs: between(rng, 120, 400),
      };
    case "jump":
      return {
        ...base,
        wave: pickWave(rng, ["square", "triangle"]),
        duty: between(rng, 0.2, 0.6),
        freq: between(rng, 200, 600),
        slide: between(rng, 1, 4),
        sustainMs: between(rng, 60, 160),
        decayMs: between(rng, 80, 260),
        highpass: unitFloat(rng) < 0.5 ? { hz: between(rng, 40, 300) } : undefined,
      };
    case "hit":
      return {
        ...base,
        wave: pickWave(rng, ["noise", "square", "saw"]),
        freq: between(rng, 100, 900),
        slide: between(rng, -6, -1),
        sustainMs: between(rng, 10, 60),
        punch: between(rng, 0, 0.6),
        decayMs: between(rng, 60, 260),
        lowpass: unitFloat(rng) < 0.5 ? { hz: between(rng, 800, 6_000) } : undefined,
      };
    case "explosion":
      return {
        ...base,
        wave: "noise",
        freq: between(rng, 40, 400),
        slide: between(rng, -3, 0),
        sustainMs: between(rng, 80, 400),
        punch: between(rng, 0.3, 0.9),
        decayMs: between(rng, 400, 1_600),
        lowpass:
          unitFloat(rng) < 0.6
            ? { hz: between(rng, 600, 4_000), sweep: between(rng, -3, 0) }
            : undefined,
        vibrato:
          unitFloat(rng) < 0.3
            ? { semitones: between(rng, 0.5, 4), hz: between(rng, 4, 20) }
            : undefined,
        seed: rng.range(1, 0xffff_ffff),
      };
    case "laser":
      return {
        ...base,
        wave: pickWave(rng, ["square", "saw", "sine"]),
        duty: between(rng, 0.1, 0.5),
        dutySweep: between(rng, -1, 1),
        freq: between(rng, 800, 4_000),
        slide: between(rng, -7, -2),
        slideAccel: between(rng, -4, 4),
        sustainMs: between(rng, 40, 200),
        decayMs: between(rng, 40, 300),
        highpass: unitFloat(rng) < 0.3 ? { hz: between(rng, 100, 800) } : undefined,
      };
    case "powerup":
      return {
        ...base,
        wave: pickWave(rng, ["square", "saw", "triangle"]),
        duty: between(rng, 0.2, 0.6),
        freq: between(rng, 200, 700),
        slide: between(rng, 0.5, 3),
        vibrato:
          unitFloat(rng) < 0.5
            ? { semitones: between(rng, 0.2, 2), hz: between(rng, 6, 18) }
            : undefined,
        retriggerMs: unitFloat(rng) < 0.5 ? between(rng, 60, 160) : undefined,
        sustainMs: between(rng, 200, 500),
        decayMs: between(rng, 100, 500),
      };
    case "blip":
      return {
        ...base,
        wave: pickWave(rng, ["square", "sine", "triangle"]),
        duty: between(rng, 0.3, 0.7),
        freq: between(rng, 400, 2_000),
        sustainMs: between(rng, 20, 80),
        decayMs: between(rng, 20, 120),
      };
  }
}

/** Drops the optional blocks a preset left out, so the patch carries no `undefined` keys. */
function dropUnset(patch: SynthFile): SynthFile {
  const record = patch as Record<string, unknown>;
  for (const key of Object.keys(record)) if (record[key] === undefined) delete record[key];
  return patch;
}

/** A random patch inside the preset's ranges. */
export function randomSynth(preset: SynthPreset, rng: Rng): SynthFile {
  const patch = dropUnset(draw(preset, rng));
  if (patch.wave !== "square") {
    delete patch.duty;
    delete patch.dutySweep;
  }
  return settle(patch);
}

/** Every numeric field moved by up to `amount` of its range (default 0.05), clamped to the schema. */
export function mutateSynth(patch: SynthFile, rng: Rng, amount = 0.05): SynthFile {
  let out = patch;
  const reach = clamp(amount, 0, 1);
  for (const path of Object.keys(SYNTH_BOUNDS) as SynthNumberPath[]) {
    const v = synthField(out, path);
    if (v === undefined) continue;
    const [min, max] = SYNTH_BOUNDS[path];
    out = withSynthField(out, path, v + between(rng, -1, 1) * reach * (max - min));
  }
  return settle(out);
}
