/**
 * The audio run: a button the runner clicks, whose handler builds a context
 * and unlocks `webAudioBackend` on it inside the gesture; then a synth patch
 * played through the backend until its voice ends, and the same patch
 * rendered through a backend on an offline stereo context at `pan: -1`.
 */
import {
  CLICK_PATCH,
  renderSynth,
  SYNTH_SAMPLE_RATE,
  synthDurationMs,
  webAudioBackend,
  type AudioBackend,
  type Voice,
  type VoiceOptions,
} from "@jams/engine";
import type { SynthFile } from "@jams/engine/project";

import { AUDIO_BUTTON_ID, AUDIO_ENDED_SLACK_MS, type AudioProbe } from "./media-compare";

/** A 200 ms square tone. */
export const SMOKE_PATCH: SynthFile = { ...CLICK_PATCH, freq: 440, sustainMs: 120, decayMs: 80 };

const VOICE: VoiceOptions = { bus: "sfx", volume: 1, rate: 1, pan: 0, loop: false };

/** How long past the patch the page keeps watching for `ended`, so a late one is measured rather than missed. */
const ENDED_CAP_MS = 2_000;
const POLL_MS = 5;

/** Silence rendered after the patch, so a voice that starts late still fits the offline render. */
const OFFLINE_TAIL_S = 0.05;

/**
 * How long the click's unlock may take. A context with no output device to
 * run on (Firefox's, without one) never settles `resume()`, so past this the
 * context is read as it stands and the voice is checked for waiting on it.
 */
export const UNLOCK_CAP_MS = 10_000;

/** Resolves when `work` does or `ms` passes, whichever is first; rejects when `work` does first. */
export function settledWithin(work: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    work.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** Whether `voice` is still unplayed after `ms`: scheduled on a context clock that isn't moving. */
function heldFor(voice: Voice, ms: number): Promise<boolean> {
  return new Promise((resolve) =>
    setTimeout(() => resolve(!voice.ended && voice.position() === 0), ms),
  );
}

function endedAfter(voice: Voice, started: number, capMs: number): Promise<number | null> {
  return new Promise((resolve) => {
    const poll = () => {
      const ms = performance.now() - started;
      if (voice.ended) resolve(Math.round(ms));
      else if (ms > capMs) resolve(null);
      else setTimeout(poll, POLL_MS);
    };
    poll();
  });
}

async function playLive(
  context: AudioContext,
  backend: AudioBackend,
  unlocking: Promise<void>,
  samples: Float32Array,
): Promise<Omit<AudioProbe, "leftShare" | "offlineChannels">> {
  try {
    await settledWithin(unlocking, UNLOCK_CAP_MS);
    const read = {
      context: context.state,
      backend: backend.state,
      channels: context.destination.channelCount,
      maxChannels: context.destination.maxChannelCount,
    };
    const patchMs = synthDurationMs(SMOKE_PATCH);
    const clip = backend.buffer([samples], SYNTH_SAMPLE_RATE);
    const started = performance.now();
    const voice = backend.play(clip, VOICE);
    if (context.state !== "running") {
      const held = await heldFor(voice, patchMs + AUDIO_ENDED_SLACK_MS);
      return { ...read, patchMs, endedMs: null, held };
    }
    const endedMs = await endedAfter(voice, started, patchMs + ENDED_CAP_MS);
    return { ...read, patchMs, endedMs, held: null };
  } finally {
    backend.close();
    if (context.state !== "closed") void context.close().catch(() => {});
  }
}

async function renderOffline(
  samples: Float32Array,
): Promise<Pick<AudioProbe, "leftShare" | "offlineChannels">> {
  const frames = samples.length + Math.round(SYNTH_SAMPLE_RATE * OFFLINE_TAIL_S);
  const context = new OfflineAudioContext(2, frames, SYNTH_SAMPLE_RATE);
  const backend = webAudioBackend({ context });
  try {
    backend.play(backend.buffer([samples], SYNTH_SAMPLE_RATE), { ...VOICE, pan: -1 });
    const rendered = await context.startRendering();
    const energy = (channel: number) => {
      if (channel >= rendered.numberOfChannels) return 0;
      let sum = 0;
      for (const s of rendered.getChannelData(channel)) sum += s * s;
      return sum;
    };
    const left = energy(0);
    const total = left + energy(1);
    return {
      leftShare: total > 0 ? left / total : 0,
      offlineChannels: rendered.numberOfChannels,
    };
  } finally {
    backend.close();
  }
}

/** Shows the button and resolves once its click has played the patch both ways. */
export function runAudioSmoke(): Promise<AudioProbe> {
  const button = document.createElement("button");
  button.id = AUDIO_BUTTON_ID;
  button.type = "button";
  button.textContent = "Play the patch";
  button.style.cssText = "position: fixed; left: 8px; top: 8px; z-index: 1";
  document.body.append(button);
  return new Promise((resolve, reject) => {
    button.addEventListener(
      "click",
      () => {
        button.remove();
        try {
          // WebKit unlocks a context only from the gesture handler's own stack.
          const context = new AudioContext();
          const backend = webAudioBackend({ context });
          const unlocking = backend.unlock();
          const samples = renderSynth(SMOKE_PATCH);
          playLive(context, backend, unlocking, samples)
            .then(async (live) => ({ ...live, ...(await renderOffline(samples)) }))
            .then(resolve, reject);
        } catch (err) {
          reject(err);
        }
      },
      { once: true },
    );
  });
}
