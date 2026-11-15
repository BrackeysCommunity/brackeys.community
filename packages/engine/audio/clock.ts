import type { AssetId } from "../project/types";

/** The music's clock against the simulation's: the audio follows the ticks, never the reverse. */
export interface AudioClock {
  /** The context time at which simulation tick `tick` began, for the playing music; null with none. */
  timeOfTick(tick: number): number | null;
  /** The music's position in ms, as the simulation sees it (tick × tickMs since its start tick, plus the start offset). */
  simPositionMs(tick: number): number | null;
  /** The last measured drift, ms (audio minus simulation). */
  readonly driftMs: number;
  /** Calibrated input latency in ms (the last @latency sent). */
  readonly latencyMs: number;
}

/** A clock with no music playing: what a system without a backend answers. */
export const SILENT_CLOCK: AudioClock = Object.freeze({
  timeOfTick: () => null,
  simPositionMs: () => null,
  driftMs: 0,
  latencyMs: 0,
});

/** What `GameInstance.calibrateLatency` resolves with: the median offset and its spread, ms. */
export type LatencyCalibration = { ms: number; spread: number };

/** How `GameInstance.calibrateLatency` runs its click track. */
export type CalibrateLatencyOptions = {
  /** Clicks to tap along to; default 16. */
  beats?: number;
  /** Default 100. */
  bpm?: number;
  /** The click; default the engine's click patch. */
  sound?: AssetId;
};

/** How far the music may drift from the simulation before it is reseeked, ms. */
export const MUSIC_DRIFT_LIMIT_MS = 40;

/**
 * Where tick-aligned music started: its first tick, the context time that
 * tick began at (seconds), the clip offset it began from and its rate.
 */
export type MusicAnchor = {
  startTick: number;
  startTime: number;
  offsetMs: number;
  rate: number;
};

/**
 * A clock over the music an anchor describes. `simPositionMs` is in the
 * clip's own time (a rate above 1 runs it faster), so it compares with the
 * voice's position as is.
 */
export function musicClock(opts: {
  tickMs: number;
  anchor: () => MusicAnchor | null;
  driftMs: () => number;
  latencyMs: () => number;
}): AudioClock {
  const { tickMs } = opts;
  return {
    timeOfTick(tick) {
      const a = opts.anchor();
      return a ? a.startTime + ((tick - a.startTick) * tickMs) / 1000 : null;
    },
    simPositionMs(tick) {
      const a = opts.anchor();
      return a ? (tick - a.startTick) * tickMs * a.rate + a.offsetMs : null;
    },
    get driftMs() {
      return opts.driftMs();
    },
    get latencyMs() {
      return opts.latencyMs();
    },
  };
}

/** A clip's length and loop, ms: what wraps a position past its loop end. */
export type ClipSpan = {
  durationMs: number;
  loop: boolean;
  loopStartMs?: number;
  loopEndMs?: number;
};

/** The loop a position wraps in, ms; null for a clip that doesn't loop or whose length isn't known. */
function loopOf(clip: ClipSpan): { start: number; span: number } | null {
  if (!clip.loop || !Number.isFinite(clip.durationMs)) return null;
  const start = clip.loopStartMs ?? 0;
  const end =
    clip.loopEndMs !== undefined && clip.loopEndMs > start ? clip.loopEndMs : clip.durationMs;
  return end - start > 0 ? { start, span: end - start } : null;
}

/** `ms` into the clip as it plays: wrapped into a looping clip's loop, else as is. */
export function wrapClipMs(ms: number, clip: ClipSpan): number {
  const loop = loopOf(clip);
  if (!loop || ms < loop.start + loop.span) return ms;
  return loop.start + ((ms - loop.start) % loop.span);
}

/** Audio minus simulation, ms; for a looping clip, the shorter way round its loop. */
export function musicDriftMs(audioMs: number, simMs: number, clip: ClipSpan): number {
  const drift = audioMs - wrapClipMs(simMs, clip);
  const loop = loopOf(clip);
  if (!loop) return drift;
  const half = loop.span / 2;
  const wrapped = (((drift + half) % loop.span) + loop.span) % loop.span;
  return wrapped - half;
}

export const CALIBRATION_BEATS_DEFAULT = 16;
export const CALIBRATION_BPM_DEFAULT = 100;
/** Fewer taps than this and a calibration resolves null. */
export const CALIBRATION_MIN_TAPS = 8;

/** The context times a click track's beats play at, seconds: one beat's lead-in, then every beat. */
export function clickTimes(now: number, beats: number, bpm: number): number[] {
  const beat = 60 / bpm;
  return Array.from({ length: beats }, (_, i) => now + beat * (i + 1));
}

/**
 * The median tap offset from its click, ms, and the median absolute
 * deviation around it. Each tap counts against its nearest click, within
 * half a beat; a click tapped twice keeps the nearer tap. Null with fewer
 * than `CALIBRATION_MIN_TAPS` taps that count.
 */
export function latencyFromTaps(
  clicks: readonly number[],
  taps: readonly number[],
  bpm: number,
): LatencyCalibration | null {
  const half = 30 / bpm;
  const best = new Map<number, number>();
  for (const tap of taps) {
    let nearest = -1;
    let off = Infinity;
    clicks.forEach((click, i) => {
      if (Math.abs(tap - click) < Math.abs(off)) {
        nearest = i;
        off = tap - click;
      }
    });
    if (nearest < 0 || Math.abs(off) > half) continue;
    const held = best.get(nearest);
    if (held === undefined || Math.abs(off) < Math.abs(held)) best.set(nearest, off);
  }
  if (best.size < CALIBRATION_MIN_TAPS) return null;
  const offsets = [...best.values()].map((s) => s * 1000);
  const ms = median(offsets);
  return { ms, spread: median(offsets.map((o) => Math.abs(o - ms))) };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
