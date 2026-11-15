import { describe, expect, it } from "vite-plus/test";

import { renderSynth, SYNTH_SAMPLE_RATE, synthDurationMs, synthWav } from "../audio/synth";
import { CLICK_PATCH, mutateSynth, randomSynth, SYNTH_PRESETS } from "../audio/synth-presets";
import { readWav } from "../project/inspect/wav";
import {
  SYNTH_BOUNDS,
  SYNTH_WAVES,
  synthKind,
  type SynthFile,
  type SynthNumberPath,
} from "../project/kinds/synth";
import { Rng } from "../sim-kit/rng";

const schema = synthKind.schema();
const valid = (patch: unknown) => schema.safeParse(patch).success;

const patch = (over: Partial<SynthFile> = {}): SynthFile => ({
  kind: "synth",
  v: 1,
  wave: "square",
  freq: 440,
  sustainMs: 100,
  decayMs: 100,
  ...over,
});

const samplesIn = (ms: number) => Math.round((ms * SYNTH_SAMPLE_RATE) / 1000);

/** Sign changes between `from` and `to` (sample indices), zero counted as positive. */
function crossings(samples: Float32Array, from = 0, to = samples.length): number {
  let n = 0;
  for (let i = from + 1; i < to; i++) if (samples[i - 1]! < 0 !== samples[i]! < 0) n++;
  return n;
}

const rms = (samples: Float32Array, from = 0, to = samples.length) => {
  let sum = 0;
  for (let i = from; i < to; i++) sum += samples[i]! ** 2;
  return Math.sqrt(sum / (to - from));
};

const bytesOf = (a: Float32Array) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);

function setPath(p: SynthFile, path: SynthNumberPath, v: number): SynthFile {
  const [head, leaf] = path.split(".") as [string, string | undefined];
  const out = structuredClone(p) as Record<string, unknown>;
  if (leaf === undefined) out[head] = v;
  else {
    const filled: Record<string, Record<string, number>> = {
      jump: { atMs: 10, semitones: 2 },
      vibrato: { semitones: 1, hz: 5 },
      lowpass: { hz: 1_000 },
      highpass: { hz: 100 },
    };
    out[head] = { ...filled[head], ...(out[head] as object), [leaf]: v };
  }
  return out as SynthFile;
}

describe("synth schema", () => {
  it("accepts the spec's example and the empty patch", () => {
    expect(
      valid({
        kind: "synth",
        v: 1,
        wave: "square",
        duty: 0.5,
        freq: 880,
        jump: { atMs: 60, semitones: 5 },
        sustainMs: 60,
        punch: 0.4,
        decayMs: 240,
      }),
    ).toBe(true);
    expect(valid(synthKind.empty())).toBe(true);
    expect(valid(CLICK_PATCH)).toBe(true);
  });

  it("holds every numeric field to its bounds", () => {
    for (const [path, [min, max]] of Object.entries(SYNTH_BOUNDS) as [
      SynthNumberPath,
      readonly [number, number],
    ][]) {
      expect(valid(setPath(patch(), path, min)), `${path} at ${min}`).toBe(true);
      expect(valid(setPath(patch(), path, max)), `${path} at ${max}`).toBe(true);
      const span = max - min;
      expect(valid(setPath(patch(), path, min - span * 0.01)), `${path} below`).toBe(false);
      expect(valid(setPath(patch(), path, max + span * 0.01)), `${path} above`).toBe(false);
    }
  });

  it("names the spec's bounds", () => {
    expect(SYNTH_BOUNDS.freq).toEqual([20, 8_000]);
    expect(SYNTH_BOUNDS.attackMs).toEqual([0, 1_000]);
    expect(SYNTH_BOUNDS.sustainMs).toEqual([0, 2_000]);
    expect(SYNTH_BOUNDS.decayMs).toEqual([0, 2_000]);
    expect(SYNTH_BOUNDS.duty).toEqual([0.05, 0.95]);
    expect(SYNTH_BOUNDS.punch).toEqual([0, 1]);
    expect(SYNTH_BOUNDS.volume).toEqual([0, 1]);
  });

  it("caps a patch at 5 s", () => {
    const longest = patch({ attackMs: 1_000, sustainMs: 2_000, decayMs: 2_000 });
    expect(valid(longest)).toBe(true);
    expect(synthDurationMs(longest)).toBe(5_000);
    expect(renderSynth(longest).length).toBe(220_500);
  });

  it("refuses unknown waves, extra fields and a bad seed", () => {
    expect(valid(patch({ wave: "organ" as never }))).toBe(false);
    expect(valid({ ...patch(), reverb: 1 })).toBe(false);
    expect(valid(patch({ seed: 0 }))).toBe(false);
    expect(valid(patch({ seed: 1.5 }))).toBe(false);
    expect(valid(patch({ seed: 0xffff_ffff }))).toBe(true);
  });
});

describe("renderSynth", () => {
  it("lasts the three envelope times", () => {
    expect(synthDurationMs(patch({ attackMs: 12, sustainMs: 34, decayMs: 56 }))).toBe(102);
    expect(synthDurationMs(patch({ sustainMs: 34, decayMs: 56 }))).toBe(90);
  });

  it("returns exactly round(duration × 44.1) samples, each finite and within ±1", () => {
    for (const wave of SYNTH_WAVES) {
      const p = patch({
        wave,
        attackMs: 7,
        sustainMs: 33,
        decayMs: 61,
        punch: 1,
        lowpass: { hz: 3_000, resonance: 1, sweep: 3 },
        highpass: { hz: 60, sweep: 2 },
        vibrato: { semitones: 3, hz: 9 },
        slide: 4,
        slideAccel: 30,
      });
      const out = renderSynth(p);
      expect(out.length).toBe(samplesIn(synthDurationMs(p)));
      for (const s of out) {
        expect(Number.isFinite(s)).toBe(true);
        expect(Math.abs(s)).toBeLessThanOrEqual(1);
      }
    }
    expect(renderSynth(patch({ sustainMs: 0, decayMs: 0 })).length).toBe(0);
  });

  it("renders a patch byte for byte the same twice", () => {
    for (const preset of SYNTH_PRESETS) {
      const p = randomSynth(preset, Rng.from(preset));
      expect(bytesOf(renderSynth(p))).toEqual(bytesOf(renderSynth(p)));
    }
  });

  it("changes a noise render with the seed and no other wave's", () => {
    for (const wave of SYNTH_WAVES) {
      const a = bytesOf(renderSynth(patch({ wave, seed: 1 })));
      const b = bytesOf(renderSynth(patch({ wave, seed: 2 })));
      if (wave === "noise") expect(a).not.toEqual(b);
      else expect(a).toEqual(b);
    }
  });

  it("crosses zero 880 ± 1 times in a second at 440 Hz", () => {
    const out = renderSynth(patch({ wave: "sine", freq: 440, sustainMs: 1_000, decayMs: 0 }));
    expect(out.length).toBe(SYNTH_SAMPLE_RATE);
    expect(Math.abs(crossings(out) - 880)).toBeLessThanOrEqual(1);
  });

  it("doubles the pitch over a second at slide 1", () => {
    const out = renderSynth(
      patch({ wave: "sine", freq: 440, slide: 1, sustainMs: 2_000, decayMs: 0 }),
    );
    const half = SYNTH_SAMPLE_RATE / 2;
    const early = crossings(out, 0, half);
    const late = crossings(out, SYNTH_SAMPLE_RATE, SYNTH_SAMPLE_RATE + half);
    expect(late / early).toBeGreaterThan(2 * 0.98);
    expect(late / early).toBeLessThan(2 * 1.02);
  });

  it("steps the pitch at the jump's atMs", () => {
    const out = renderSynth(
      patch({
        wave: "sine",
        freq: 440,
        jump: { atMs: 500, semitones: 12 },
        sustainMs: 1_000,
        decayMs: 0,
      }),
    );
    const at = samplesIn(500);
    const before = crossings(out, 0, at);
    const after = crossings(out, at, out.length);
    expect(Math.abs(before - 440)).toBeLessThanOrEqual(2);
    expect(Math.abs(after - 880)).toBeLessThanOrEqual(2);
  });

  it("restarts the pitch every retriggerMs", () => {
    const p = patch({ wave: "sine", freq: 300, slide: 4, retriggerMs: 250 });
    const out = renderSynth({ ...p, sustainMs: 1_000, decayMs: 0 });
    const period = samplesIn(250);
    const first = crossings(out, 0, period);
    for (let k = 1; k < 4; k++) {
      expect(Math.abs(crossings(out, k * period, (k + 1) * period) - first)).toBeLessThanOrEqual(2);
    }
  });

  it("ends in silence", () => {
    for (const wave of SYNTH_WAVES) {
      const out = renderSynth(patch({ wave, lowpass: { hz: 500, resonance: 0.9 } }));
      expect(Math.abs(out[out.length - 1]!)).toBeLessThan(0.01);
    }
    const cut = renderSynth(patch({ sustainMs: 50, decayMs: 0 }));
    expect(Math.abs(cut[cut.length - 1]!)).toBeLessThan(0.01);
  });

  it("more than halves a 4 kHz square's RMS through a 200 Hz low-pass", () => {
    const base = patch({ wave: "square", freq: 4_000, sustainMs: 500, decayMs: 0 });
    const end = samplesIn(400);
    const open = rms(renderSynth(base), samplesIn(100), end);
    const shut = rms(renderSynth({ ...base, lowpass: { hz: 200 } }), samplesIn(100), end);
    expect(shut).toBeLessThan(open / 2);
  });

  it("cuts lows through a high-pass and scales by volume", () => {
    const base = patch({ wave: "sine", freq: 100, sustainMs: 500, decayMs: 0 });
    const from = samplesIn(100);
    const to = samplesIn(400);
    const open = rms(renderSynth(base), from, to);
    expect(rms(renderSynth({ ...base, highpass: { hz: 4_000 } }), from, to)).toBeLessThan(open / 2);
    expect(rms(renderSynth({ ...base, volume: 0.5 }), from, to)).toBeCloseTo(open / 2, 3);
  });

  it("follows the envelope: silent at the start of an attack, lifted by punch", () => {
    const out = renderSynth(
      patch({ wave: "square", attackMs: 100, sustainMs: 100, decayMs: 100, punch: 1 }),
    );
    expect(out[0]).toBe(0);
    const sustainStart = Math.abs(out[samplesIn(101)]!);
    const sustainEnd = Math.abs(out[samplesIn(199)]!);
    expect(sustainStart).toBeGreaterThan(sustainEnd * 1.8);
    expect(sustainStart).toBeLessThanOrEqual(1);
  });

  it("sweeps a square's duty", () => {
    const highShare = (p: SynthFile, from: number, to: number) => {
      const out = renderSynth(p);
      let high = 0;
      for (let i = from; i < to; i++) if (out[i]! > 0) high++;
      return high / (to - from);
    };
    const p = patch({ duty: 0.2, dutySweep: 1, sustainMs: 600, decayMs: 0 });
    expect(highShare(p, 0, samplesIn(50))).toBeCloseTo(0.22, 1);
    expect(highShare(p, samplesIn(500), samplesIn(550))).toBeCloseTo(0.72, 1);
  });
});

describe("synthWav", () => {
  it("writes 16-bit mono PCM at 44,100 Hz with the render's samples", () => {
    const p = patch({ wave: "triangle", sustainMs: 30, decayMs: 20 });
    const wav = synthWav(p);
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    const text = (at: number) => String.fromCharCode(...wav.subarray(at, at + 4));
    expect(text(0)).toBe("RIFF");
    expect(view.getUint32(4, true)).toBe(wav.length - 8);
    expect(text(8)).toBe("WAVE");
    expect(text(12)).toBe("fmt ");
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(44_100);
    expect(view.getUint16(34, true)).toBe(16);
    expect(text(36)).toBe("data");
    const samples = renderSynth(p);
    expect(view.getUint32(40, true)).toBe(samples.length * 2);
    expect(wav.length).toBe(44 + samples.length * 2);
    const mid = samples.length >> 1;
    expect(view.getInt16(44 + mid * 2, true)).toBe(Math.round(samples[mid]! * 32_767));
  });
  it("reads back through the WAV header reader as the patch's length, one channel, 44,100 Hz", () => {
    for (const p of [patch({ attackMs: 5, sustainMs: 40, decayMs: 80 }), CLICK_PATCH]) {
      const header = readWav(synthWav(p));
      if ("reason" in header) throw new Error(header.reason);
      expect(header.channels).toBe(1);
      expect(header.sampleRate).toBe(44_100);
      expect(Math.abs(header.durationMs - synthDurationMs(p))).toBeLessThan(1000 / 44_100);
    }
  });
});

describe("presets", () => {
  it("lists the seven presets", () => {
    expect(SYNTH_PRESETS).toEqual([
      "pickup",
      "jump",
      "hit",
      "explosion",
      "laser",
      "powerup",
      "blip",
    ]);
    expect(Object.isFrozen(CLICK_PATCH)).toBe(true);
    expect(CLICK_PATCH.wave).toBe("square");
    expect(synthDurationMs(CLICK_PATCH)).toBeLessThanOrEqual(50);
  });

  it("draws a valid patch from each preset over 1,000 seeds, and a valid mutation of each", () => {
    for (const preset of SYNTH_PRESETS) {
      const rng = Rng.from(`synth-${preset}`);
      for (let seed = 0; seed < 1_000; seed++) {
        const drawn = randomSynth(preset, rng);
        const parsed = schema.safeParse(drawn);
        expect(parsed.success, `${preset} #${seed}: ${JSON.stringify(drawn)}`).toBe(true);
        const mutated = mutateSynth(drawn, rng);
        expect(valid(mutated), `${preset} #${seed} mutated: ${JSON.stringify(mutated)}`).toBe(true);
        expect(valid(mutateSynth(drawn, rng, 1)), `${preset} #${seed} mutated by 1`).toBe(true);
      }
    }
  });

  it("draws the same patch from the same stream", () => {
    for (const preset of SYNTH_PRESETS) {
      expect(randomSynth(preset, Rng.from(7))).toEqual(randomSynth(preset, Rng.from(7)));
    }
  });

  it("mutates within the amount, leaves the wave and the original alone", () => {
    const original = patch({ jump: { atMs: 50, semitones: 4 }, duty: 0.5 });
    const before = structuredClone(original);
    const mutated = mutateSynth(original, Rng.from(3), 0.05);
    expect(original).toEqual(before);
    expect(mutated.wave).toBe(original.wave);
    const [lo, hi] = SYNTH_BOUNDS.freq;
    expect(Math.abs(mutated.freq - original.freq)).toBeLessThanOrEqual((hi - lo) * 0.05 + 0.1);
    expect(mutated.jump).not.toBe(original.jump);
    expect(mutateSynth(original, Rng.from(3), 0)).toEqual(original);
  });

  it("clamps a mutation to the schema", () => {
    const edge = patch({ freq: 8_000, duty: 0.95, volume: 1, sustainMs: 2_000, decayMs: 2_000 });
    for (let seed = 1; seed < 50; seed++) {
      const mutated = mutateSynth(edge, Rng.from(seed), 1);
      expect(valid(mutated)).toBe(true);
      expect(synthDurationMs(mutated)).toBeLessThanOrEqual(5_000);
    }
  });
});
