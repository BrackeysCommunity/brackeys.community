import { describe, expect, it } from "vite-plus/test";

import { renderSynth, SYNTH_SAMPLE_RATE, synthDurationMs, synthWav } from "../audio/synth";
import { CLICK_PATCH, mutateSynth, randomSynth, SYNTH_PRESETS } from "../audio/synth-presets";
import blip from "../collab/__tests__/fixtures/blip.synth.json";
import { readWav } from "../project/inspect/wav";
import {
  SYNTH_BOUNDS,
  SYNTH_WAVES,
  synthKind,
  type SynthFile,
  type SynthNumberPath,
} from "../project/kinds/synth";
import clink from "../scenes/audio/clink.synth.json";
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

/** FNV-1a over a render's bytes. */
function hashOf(a: Float32Array): string {
  let h = 0x811c9dc5;
  for (const x of bytesOf(a)) h = Math.imul(h ^ x, 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
}

/** The power at `hz` over the window (a single Goertzel bin). */
function powerAt(samples: Float32Array, hz: number, from: number, to: number): number {
  const w = (2 * Math.PI * hz) / SYNTH_SAMPLE_RATE;
  const c = 2 * Math.cos(w);
  let s1 = 0;
  let s2 = 0;
  for (let i = from; i < to; i++) {
    const s0 = samples[i]! + c * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return (s1 * s1 + s2 * s2 - c * s1 * s2) / (to - from) ** 2;
}

/** How much of a window's energy is in its sample-to-sample change: higher is brighter. */
function brightness(samples: Float32Array, from: number, to: number): number {
  let diff = 0;
  let sum = 0;
  for (let i = from + 1; i < to; i++) {
    diff += (samples[i]! - samples[i - 1]!) ** 2;
    sum += samples[i]! ** 2;
  }
  return Math.sqrt(diff / sum);
}

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
      osc2: { wave: "saw" } as never,
      osc3: { wave: "saw" } as never,
      filter: { cutoff: 1_000 },
      filterEnv: {},
      lfo: { wave: "sine", hz: 5 } as never,
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

  it("accepts the subtractive voice's blocks and refuses a fractional octave or noise oscillator", () => {
    const full = patch({
      level: 0.8,
      osc2: { wave: "saw", octave: -1, detune: 7, level: 0.6 },
      osc3: { wave: "square" },
      noise: 0.2,
      ampDecayMs: 120,
      ampSustain: 0.5,
      filter: { cutoff: 800, resonance: 0.7, envAmount: 3, keyTrack: 0.5, drive: 0.3 },
      filterEnv: { attackMs: 5, decayMs: 200, sustain: 0.2, releaseMs: 80 },
      lfo: { wave: "random", hz: 8, pitch: 1, cutoff: 1, amp: 0.3 },
    });
    expect(valid(full)).toBe(true);
    expect(valid(patch({ osc2: { wave: "saw", octave: 0.5 } }))).toBe(false);
    expect(valid(patch({ osc2: { wave: "noise" as never } }))).toBe(false);
    expect(valid(patch({ lfo: { wave: "organ" as never, hz: 1 } }))).toBe(false);
    expect(valid(patch({ filter: { cutoff: 800, q: 2 } as never }))).toBe(false);
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
  it("renders a patch without the subtractive voice's fields exactly as before it had them", () => {
    // Hashes of the one-oscillator renderer's output, taken before the mixer, ladder and LFO existed.
    const base = { kind: "synth", v: 1, freq: 440, sustainMs: 100, decayMs: 100 } as const;
    const every = (wave: SynthFile["wave"]): SynthFile => ({
      ...base,
      wave,
      duty: 0.3,
      dutySweep: 0.5,
      attackMs: 7,
      sustainMs: 33,
      decayMs: 61,
      punch: 1,
      lowpass: { hz: 3_000, resonance: 1, sweep: 3 },
      highpass: { hz: 60, sweep: 2 },
      vibrato: { semitones: 3, hz: 9 },
      jump: { atMs: 20, semitones: 5 },
      retriggerMs: 40,
      slide: 4,
      slideAccel: 30,
      seed: 99,
      volume: 0.7,
    });
    const golden: [SynthFile, string][] = [
      [clink as SynthFile, "8b66b794"],
      [blip as SynthFile, "95c6f31d"],
      [{ ...base, wave: "square" }, "ee1e03f9"],
      [every("square"), "8818ec8d"],
      [{ ...base, wave: "saw" }, "e82c16f4"],
      [every("saw"), "5093685f"],
      [{ ...base, wave: "triangle" }, "8d0cb864"],
      [every("triangle"), "8831ee50"],
      [{ ...base, wave: "sine" }, "76c2a570"],
      [every("sine"), "f2dc6f5f"],
      [{ ...base, wave: "noise" }, "5a9fcee0"],
      [every("noise"), "c5825047"],
    ];
    for (const [p, hash] of golden) expect(hashOf(renderSynth(p)), JSON.stringify(p)).toBe(hash);
    // Writing a default out changes nothing.
    const plain = golden[2]![0];
    expect(hashOf(renderSynth({ ...plain, level: 1, ampSustain: 1, noise: 0 }))).toBe("ee1e03f9");
  });

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

  // Ten fixed 5 s renders: about 0.65 s on a quiet machine, past 5 s on a loaded CI runner.
  it("stays finite and within ±1 with every block at its edge, each wave, 5 s at most", () => {
    for (const wave of SYNTH_WAVES) {
      for (const edge of [0, 1]) {
        const p = patch({
          wave,
          freq: edge ? 8_000 : 20,
          attackMs: 1_000,
          sustainMs: 2_000,
          decayMs: 2_000,
          punch: 1,
          level: 1,
          osc2: { wave: "saw", octave: edge ? 3 : -3, detune: 100, level: 1 },
          osc3: { wave: "square", octave: edge ? -3 : 3, detune: -100, level: 1 },
          noise: 1,
          ampDecayMs: 2_000,
          ampSustain: edge,
          filter: {
            cutoff: edge ? 20_000 : 20,
            resonance: 1,
            envAmount: edge ? 8 : -8,
            keyTrack: 1,
            drive: 1,
          },
          filterEnv: { attackMs: 2_000, decayMs: 2_000, sustain: 1, releaseMs: 2_000 },
          lfo: { wave: "random", hz: 40, pitch: 12, cutoff: 4, amp: 1 },
        });
        expect(valid(p)).toBe(true);
        const out = renderSynth(p);
        expect(out.length).toBe(220_500);
        // One expect per render: an expect per sample is slower than the render.
        const bad = out.findIndex((s) => !Number.isFinite(s) || Math.abs(s) > 1);
        expect(bad, `${wave} edge ${edge}`).toBe(-1);
        expect(Math.abs(out[out.length - 1]!)).toBeLessThan(0.01);
      }
    }
  }, 30_000);

  it("cuts a sine two octaves above the ladder's cutoff about twice as deep as the 12 dB low-pass", () => {
    const base = patch({ wave: "sine", freq: 4_000, sustainMs: 500, decayMs: 0 });
    const from = samplesIn(100);
    const to = samplesIn(400);
    const open = rms(renderSynth(base), from, to);
    const twelve = rms(renderSynth({ ...base, lowpass: { hz: 1_000 } }), from, to) / open;
    const ladder = rms(renderSynth({ ...base, filter: { cutoff: 1_000 } }), from, to) / open;
    // Two octaves: about −24 dB for two poles, −48 dB for four.
    expect(twelve).toBeGreaterThan(0.04);
    expect(ladder).toBeLessThan(0.012);
    // Well under the cutoff it passes.
    const low = patch({ wave: "sine", freq: 100, sustainMs: 500, decayMs: 0 });
    const passed = rms(renderSynth({ ...low, filter: { cutoff: 2_000 } }), from, to);
    expect(passed / rms(renderSynth(low), from, to)).toBeGreaterThan(0.85);
  });

  it("lifts the harmonic at the cutoff as the resonance rises", () => {
    const base = patch({ wave: "square", freq: 110, sustainMs: 500, decayMs: 0 });
    const at = (resonance: number) =>
      powerAt(
        renderSynth({ ...base, filter: { cutoff: 990, resonance } }),
        990,
        samplesIn(100),
        samplesIn(400),
      );
    expect(at(0.9)).toBeGreaterThan(at(0) * 8);
    expect(at(0.5)).toBeGreaterThan(at(0));
  });

  it("opens the cutoff with the filter envelope and closes it as it decays", () => {
    const p = patch({
      wave: "saw",
      freq: 110,
      sustainMs: 600,
      decayMs: 0,
      filter: { cutoff: 200, envAmount: 5 },
      filterEnv: { decayMs: 200, sustain: 0 },
    });
    const out = renderSynth(p);
    const early = brightness(out, samplesIn(10), samplesIn(60));
    const late = brightness(out, samplesIn(400), samplesIn(500));
    expect(early).toBeGreaterThan(late * 2);
    // With no envelope amount the same window is as dark as the end.
    const still = renderSynth({ ...p, filter: { cutoff: 200 } });
    expect(brightness(still, samplesIn(10), samplesIn(60))).toBeCloseTo(late, 1);
  });

  it("follows the pitch with key tracking", () => {
    const at = (freq: number, keyTrack: number) =>
      brightness(
        renderSynth(
          patch({
            wave: "saw",
            freq,
            sustainMs: 300,
            decayMs: 0,
            filter: { cutoff: 300, keyTrack },
          }),
        ),
        samplesIn(100),
        samplesIn(250),
      );
    expect(at(1_000, 1) / at(1_000, 0)).toBeGreaterThan(1.5);
  });

  it("falls to the amp sustain level over the amp decay", () => {
    const out = renderSynth(
      patch({ wave: "square", sustainMs: 400, decayMs: 0, ampDecayMs: 100, ampSustain: 0.25 }),
    );
    const start = rms(out, 0, samplesIn(5));
    const held = rms(out, samplesIn(200), samplesIn(350));
    expect(held / start).toBeCloseTo(0.25, 1);
  });

  it("tunes the second oscillator by octave and mixes the noise from the seed", () => {
    const p = patch({
      wave: "sine",
      level: 0,
      osc2: { wave: "sine", octave: 1 },
      sustainMs: 1_000,
      decayMs: 0,
    });
    expect(crossings(renderSynth(p), 0, SYNTH_SAMPLE_RATE)).toBeGreaterThan(1_755);
    expect(crossings(renderSynth(p), 0, SYNTH_SAMPLE_RATE)).toBeLessThan(1_765);
    const noisy = patch({ wave: "sine", noise: 0.5 });
    expect(bytesOf(renderSynth({ ...noisy, seed: 1 }))).not.toEqual(
      bytesOf(renderSynth({ ...noisy, seed: 2 })),
    );
    expect(bytesOf(renderSynth(noisy))).toEqual(bytesOf(renderSynth(noisy)));
  });

  it("swings the volume with the LFO's amp", () => {
    const base = patch({ wave: "sine", freq: 1_000, sustainMs: 1_000, decayMs: 0 });
    const out = renderSynth({ ...base, lfo: { wave: "square", hz: 2, amp: 1 } });
    // A square LFO at 2 Hz is up for the first quarter second, down for the next.
    expect(rms(out, samplesIn(20), samplesIn(230))).toBeGreaterThan(0.5);
    expect(rms(out, samplesIn(270), samplesIn(480))).toBeLessThan(0.01);
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
  it("lists the presets", () => {
    expect(SYNTH_PRESETS).toEqual([
      "pickup",
      "jump",
      "hit",
      "explosion",
      "laser",
      "powerup",
      "blip",
      "bass",
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

  it("draws a bass through the ladder, its filter envelope set, its octave whole", () => {
    const rng = Rng.from("bass");
    for (let i = 0; i < 100; i++) {
      const bass = randomSynth("bass", rng);
      expect(bass.filter).toBeDefined();
      expect(bass.filterEnv).toBeDefined();
      expect(Number.isInteger(mutateSynth(bass, rng, 1).osc3?.octave)).toBe(true);
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
