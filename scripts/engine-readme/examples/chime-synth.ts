import {
  fakeAudioBackend,
  mutateSynth,
  randomSynth,
  renderSynth,
  SYNTH_PRESETS,
  SYNTH_SAMPLE_RATE,
  synthDurationMs,
  synthWav,
} from "@jams/engine/headless";
import { Rng } from "@jams/engine/sim-kit";

/**
 * Draws a pickup from its preset, renders it, and plays the render through
 * the fake backend panned right: the log a test reads instead of hearing it.
 */
export function chime() {
  const patch = randomSynth("pickup", Rng.from(7));
  const again = randomSynth("pickup", Rng.from(7));
  const samples = renderSynth(patch);
  const backend = fakeAudioBackend({ state: "running" });
  const clip = backend.buffer([samples], SYNTH_SAMPLE_RATE);
  backend.play(clip, { bus: "sfx", volume: 0.8, rate: 1, pan: 0.5, loop: false });
  return {
    presets: [...SYNTH_PRESETS],
    sameSeedSamePatch: JSON.stringify(patch) === JSON.stringify(again),
    ms: synthDurationMs(patch),
    samples: samples.length,
    wavBytes: synthWav(patch).length,
    sameWave: mutateSynth(patch, Rng.from(1)).wave === patch.wave,
    log: backend.log.map((c) =>
      c.op === "buffer"
        ? `buffer ${c.channels}ch ${c.length}`
        : c.op === "play"
          ? `play pan ${c.opts.pan}`
          : c.op,
    ),
  };
}
