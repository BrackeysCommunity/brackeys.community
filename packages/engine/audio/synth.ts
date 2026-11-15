/**
 * The synth patch renderer: pure, no Web Audio, noise from the seeded Rng.
 * A patch renders one channel, a point the voice's panner places in the
 * stereo field. The voice is a subtractive mono synth: up to three
 * oscillators and noise into a ladder filter with its own envelope, an amp
 * envelope and an LFO. A patch that sets none of the later fields renders
 * as the plain one-oscillator sound effect it always did.
 */
import { clamp } from "../math";
import {
  SYNTH_DEFAULTS,
  type SynthAdsr,
  type SynthFile,
  type SynthLfoWave,
  type SynthOsc,
  type SynthOscWave,
} from "../project/kinds/synth";
import { Rng, unitFloat } from "../sim-kit/rng";
import { pcmWav } from "./wav";

/** Every render's sample rate. */
export const SYNTH_SAMPLE_RATE = 44_100;

/** The noise wave holds this many random values per cycle, so its colour follows the pitch. */
const NOISE_STEPS = 32;
const PITCH_MIN_HZ = 20;
const PITCH_MAX_HZ = 20_000;
const CUTOFF_MIN_HZ = 20;
const CUTOFF_MAX_HZ = SYNTH_SAMPLE_RATE * 0.45;
const DUTY_MIN = 0.05;
const DUTY_MAX = 0.95;

/** attackMs + sustainMs + decayMs: what headless and the inspector show without rendering. */
export function synthDurationMs(patch: SynthFile): number {
  return (patch.attackMs ?? 0) + patch.sustainMs + patch.decayMs;
}

const samplesIn = (ms: number): number => Math.round((ms * SYNTH_SAMPLE_RATE) / 1000);

/**
 * A two-pole state-variable filter (the trapezoidal form, stable at any
 * cutoff below Nyquist). `damping` is 1/Q: √2 is flat, near 0 rings.
 */
function svf(damping: number): (x: number, hz: number) => { low: number; high: number } {
  let ic1 = 0;
  let ic2 = 0;
  const out = { low: 0, high: 0 };
  return (x, hz) => {
    const g = Math.tan((Math.PI * clamp(hz, CUTOFF_MIN_HZ, CUTOFF_MAX_HZ)) / SYNTH_SAMPLE_RATE);
    const a1 = 1 / (1 + g * (g + damping));
    const a2 = g * a1;
    const a3 = g * a2;
    const v3 = x - ic2;
    const v1 = a1 * ic1 + a2 * v3;
    const v2 = ic2 + a2 * ic1 + a3 * v3;
    ic1 = 2 * v1 - ic1;
    ic2 = 2 * v2 - ic2;
    out.low = v2;
    out.high = x - damping * v1 - v2;
    return out;
  };
}

/**
 * A four-pole ladder low-pass in zero-delay-feedback form: four trapezoidal
 * one-poles with the fourth's output fed back, solved for the same sample, so
 * it stays in tune and stable up to self-oscillation at `k` = 4. A tanh on
 * the feedback sum bounds the ring and gives the drive its grit.
 */
function ladder(): (x: number, hz: number, k: number, drive: number) => number {
  let s1 = 0;
  let s2 = 0;
  let s3 = 0;
  let s4 = 0;
  return (x, hz, k, drive) => {
    const g = Math.tan((Math.PI * clamp(hz, CUTOFF_MIN_HZ, CUTOFF_MAX_HZ)) / SYNTH_SAMPLE_RATE);
    const G = g / (1 + g);
    const G2 = G * G;
    const S = (G2 * G * s1 + G2 * s2 + G * s3 + s4) / (1 + g);
    const y4 = (G2 * G2 * x + S) / (1 + k * G2 * G2);
    const u = Math.tanh(drive * (x - k * y4)) / Math.tanh(drive);
    let v = (u - s1) * G;
    let y = v + s1;
    s1 = y + v;
    v = (y - s2) * G;
    y = v + s2;
    s2 = y + v;
    v = (y - s3) * G;
    y = v + s3;
    s3 = y + v;
    v = (y - s4) * G;
    y = v + s4;
    s4 = y + v;
    return y;
  };
}

/** A pitched wave at `phase` (0–1); a square's high part is `duty`. */
function oscSample(wave: SynthOscWave, phase: number, duty = 0.5): number {
  switch (wave) {
    case "square":
      return phase < duty ? 1 : -1;
    case "saw":
      return 2 * phase - 1;
    case "triangle":
      return phase < 0.5 ? 4 * phase - 1 : 3 - 4 * phase;
    case "sine":
      return Math.sin(2 * Math.PI * phase);
  }
}

/**
 * An ADSR's level at sample `i` for a gate of `gate` samples: up to 1, down
 * to the sustain level, held, then released to 0 from wherever it was.
 */
function adsr(env: SynthAdsr): (i: number, gate: number) => number {
  const attack = samplesIn(env.attackMs ?? 0);
  const decay = samplesIn(env.decayMs ?? 0);
  const sustain = env.sustain ?? 0;
  const release = samplesIn(env.releaseMs ?? 0);
  const held = (i: number) => {
    if (i < attack) return i / attack;
    if (i < attack + decay) return 1 - ((1 - sustain) * (i - attack)) / decay;
    return sustain;
  };
  return (i, gate) => {
    if (i < gate) return held(i);
    return release === 0 ? 0 : held(gate) * Math.max(0, 1 - (i - gate) / release);
  };
}

/** The LFO's swing at time `t`, −1 to 1; `random` draws a new seeded value each cycle. */
function lfoAt(wave: SynthLfoWave, hz: number, rng: Rng): (t: number) => number {
  let cycle = -1;
  let held = 0;
  return (t) => {
    const p = hz * t;
    const f = p - Math.floor(p);
    if (wave === "random") {
      if (Math.floor(p) !== cycle) {
        cycle = Math.floor(p);
        held = unitFloat(rng) * 2 - 1;
      }
      return held;
    }
    return wave === "sine" ? Math.sin(2 * Math.PI * f) : oscSample(wave, f);
  };
}

/** Middle C: where key tracking leaves the cutoff where it's set. */
const KEY_TRACK_HZ = 261.63;

type ExtraOsc = { wave: SynthOscWave; ratio: number; level: number; phase: number };

const extraOsc = (osc: SynthOsc): ExtraOsc => ({
  wave: osc.wave,
  ratio: 2 ** ((osc.octave ?? 0) + (osc.detune ?? 0) / 1200),
  level: osc.level ?? SYNTH_DEFAULTS.oscLevel,
  phase: 0,
});

/** One channel, −1 to 1, round(synthDurationMs × 44.1) samples. */
export function renderSynth(patch: SynthFile): Float32Array {
  const rate = SYNTH_SAMPLE_RATE;
  const attack = samplesIn(patch.attackMs ?? 0);
  const sustain = samplesIn(patch.sustainMs);
  const length = samplesIn(synthDurationMs(patch));
  const out = new Float32Array(length);
  if (length === 0) return out;
  const decay = Math.max(1, length - 1 - attack - sustain);

  const slide = patch.slide ?? 0;
  const slideAccel = patch.slideAccel ?? 0;
  const jumpAt = patch.jump ? samplesIn(patch.jump.atMs) : -1;
  const jumpRatio = patch.jump ? 2 ** (patch.jump.semitones / 12) : 1;
  const vibratoDepth = patch.vibrato ? patch.vibrato.semitones / 12 : 0;
  const vibratoHz = patch.vibrato?.hz ?? 0;
  const retrigger = patch.retriggerMs ? Math.max(1, samplesIn(patch.retriggerMs)) : 0;
  const duty = patch.duty ?? SYNTH_DEFAULTS.duty;
  const dutySweep = patch.dutySweep ?? 0;
  const punch = patch.punch ?? 0;
  const volume = patch.volume ?? SYNTH_DEFAULTS.volume;

  const lowpass = patch.lowpass;
  const highpass = patch.highpass;
  const low = lowpass ? svf(Math.SQRT2 * (1 - 0.95 * (lowpass.resonance ?? 0))) : null;
  const high = highpass ? svf(Math.SQRT2) : null;

  const level = patch.level ?? SYNTH_DEFAULTS.level;
  const extras = [patch.osc2, patch.osc3].flatMap((o) => (o ? [extraOsc(o)] : []));
  const noiseLevel = patch.noise ?? 0;
  // Only a patch that mixes more than the one oscillator is mixed down, so a plain one renders as it did.
  const mixed = extras.length > 0 || noiseLevel > 0;
  const mixScale = mixed
    ? 1 / Math.max(1, level + noiseLevel + extras.reduce((sum, o) => sum + o.level, 0))
    : 1;

  const ampSustain = patch.ampSustain ?? SYNTH_DEFAULTS.ampSustain;
  const ampDecay = samplesIn(patch.ampDecayMs ?? 0);
  const held = (k: number) =>
    k < ampDecay ? ampSustain + (1 - ampSustain) * (1 - k / ampDecay) ** 2 : ampSustain;
  const releaseFrom = held(sustain);

  const filter = patch.filter;
  const ladderLow = filter ? ladder() : null;
  const resonanceK = 4 * (filter?.resonance ?? 0);
  const drive = 1 + 4 * (filter?.drive ?? 0);
  // A ladder loses bass as its resonance rises; this gives part of it back.
  const filterGain = 1 + 0.25 * resonanceK;
  const filterEnv = patch.filterEnv ? adsr(patch.filterEnv) : null;
  const envAmount = filter?.envAmount ?? 0;
  const keyTrack = filter?.keyTrack ?? 0;
  const gate = attack + sustain;

  const lfo = patch.lfo;
  const lfoWave = lfo
    ? lfoAt(lfo.wave, lfo.hz, Rng.from(`${patch.seed ?? SYNTH_DEFAULTS.seed}:lfo`))
    : null;
  const lfoPitch = (lfo?.pitch ?? 0) / 12;
  const lfoCutoff = lfo?.cutoff ?? 0;
  const lfoAmp = lfo?.amp ?? 0;

  const whiteRng = Rng.from(`${patch.seed ?? SYNTH_DEFAULTS.seed}:noise`);

  const rng = Rng.from(patch.seed ?? SYNTH_DEFAULTS.seed);
  const noise = new Float32Array(NOISE_STEPS);
  const refillNoise = () => {
    for (let k = 0; k < NOISE_STEPS; k++) noise[k] = unitFloat(rng) * 2 - 1;
  };
  if (patch.wave === "noise") refillNoise();

  let phase = 0;
  for (let i = 0; i < length; i++) {
    const local = retrigger ? i % retrigger : i;
    const t = i / rate;
    const lt = local / rate;

    let hz = patch.freq * 2 ** (slide * lt + 0.5 * slideAccel * lt * lt);
    if (jumpAt >= 0 && local >= jumpAt) hz *= jumpRatio;
    if (vibratoDepth) hz *= 2 ** (vibratoDepth * Math.sin(2 * Math.PI * vibratoHz * t));
    const swing = lfoWave ? lfoWave(t) : 0;
    if (lfoPitch) hz *= 2 ** (lfoPitch * swing);
    hz = clamp(hz, PITCH_MIN_HZ, PITCH_MAX_HZ);

    let s: number;
    switch (patch.wave) {
      case "square":
        s = phase < clamp(duty + dutySweep * lt, DUTY_MIN, DUTY_MAX) ? 1 : -1;
        break;
      case "saw":
        s = 2 * phase - 1;
        break;
      case "triangle":
        s = phase < 0.5 ? 4 * phase - 1 : 3 - 4 * phase;
        break;
      case "sine":
        s = Math.sin(2 * Math.PI * phase);
        break;
      case "noise":
        s = noise[Math.floor(phase * NOISE_STEPS)] ?? 0;
        break;
    }

    phase += hz / rate;
    if (phase >= 1) {
      phase -= Math.floor(phase);
      if (patch.wave === "noise") refillNoise();
    }

    if (mixed) {
      s *= level;
      for (const o of extras) {
        s += o.level * oscSample(o.wave, o.phase);
        o.phase += clamp(hz * o.ratio, PITCH_MIN_HZ, PITCH_MAX_HZ) / rate;
        o.phase -= Math.floor(o.phase);
      }
      if (noiseLevel) s += noiseLevel * (unitFloat(whiteRng) * 2 - 1);
      s *= mixScale;
    } else if (level !== 1) s *= level;

    if (ladderLow && filter) {
      let octaves = 0;
      if (filterEnv) octaves += envAmount * filterEnv(i, gate);
      if (lfoCutoff) octaves += lfoCutoff * swing;
      if (keyTrack) octaves += keyTrack * Math.log2(hz / KEY_TRACK_HZ);
      s = ladderLow(s * filterGain, filter.cutoff * 2 ** octaves, resonanceK, drive);
    }

    if (low && lowpass) s = low(s, lowpass.hz * 2 ** ((lowpass.sweep ?? 0) * t)).low;
    if (high && highpass) s = high(s, highpass.hz * 2 ** ((highpass.sweep ?? 0) * t)).high;

    // Punch lifts the start of the sustain; the whole envelope is scaled so its peak is 1.
    let env: number;
    if (i < attack) env = i / attack;
    else if (i < attack + sustain) env = held(i - attack) + punch * (1 - (i - attack) / sustain);
    else env = releaseFrom * Math.max(0, 1 - (i - attack - sustain) / decay);
    if (i === length - 1) env = 0;
    env /= 1 + punch;
    if (lfoAmp) env *= 1 - (lfoAmp * (1 - swing)) / 2;

    out[i] = clamp(s * env * volume, -1, 1);
  }
  return out;
}

/** 16-bit PCM WAV bytes of a render (the CLI's `synth render`). */
export function synthWav(patch: SynthFile): Uint8Array {
  const samples = Int16Array.from(renderSynth(patch), (s) => Math.round(s * 32_767));
  return pcmWav({ channels: 1, sampleRate: SYNTH_SAMPLE_RATE, bits: 16, samples });
}
