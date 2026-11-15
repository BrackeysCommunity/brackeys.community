/**
 * The synth patch renderer: pure, no Web Audio, noise from the seeded Rng.
 * A patch renders one channel, a point the voice's panner places in the
 * stereo field.
 */
import { clamp } from "../math";
import { SYNTH_DEFAULTS, type SynthFile } from "../project/kinds/synth";
import { Rng, unitFloat } from "../sim-kit/rng";

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

    if (low && lowpass) s = low(s, lowpass.hz * 2 ** ((lowpass.sweep ?? 0) * t)).low;
    if (high && highpass) s = high(s, highpass.hz * 2 ** ((highpass.sweep ?? 0) * t)).high;

    // Punch lifts the start of the sustain; the whole envelope is scaled so its peak is 1.
    let env: number;
    if (i < attack) env = i / attack;
    else if (i < attack + sustain) env = 1 + punch * (1 - (i - attack) / sustain);
    else env = Math.max(0, 1 - (i - attack - sustain) / decay);
    if (i === length - 1) env = 0;
    env /= 1 + punch;

    out[i] = clamp(s * env * volume, -1, 1);
  }
  return out;
}

/** 16-bit PCM WAV bytes of a render (the CLI's `synth render`). */
export function synthWav(patch: SynthFile): Uint8Array {
  const samples = renderSynth(patch);
  const dataBytes = samples.length * 2;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  const ascii = (at: number, text: string) => {
    for (let k = 0; k < text.length; k++) bytes[at + k] = text.charCodeAt(k);
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SYNTH_SAMPLE_RATE, true);
  view.setUint32(28, SYNTH_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i++) {
    view.setInt16(44 + i * 2, Math.round((samples[i] ?? 0) * 32_767), true);
  }
  return bytes;
}
