import { frameData, MotionGlobalConfig } from "framer-motion";

/**
 * Keeps framer-motion on the clock the browser actually keeps smooth.
 *
 * Firefox's `privacy.resistFingerprinting` clamps `performance.now()` to 100ms
 * buckets. Bug 1692609 exempted rAF timestamps and animation timelines from
 * that clamp in Firefox 102 so animations would stay smooth under RFP — but
 * Motion's frame loop discards the timestamp rAF hands its callback and calls
 * `performance.now()` itself, opting straight back out of the exemption. Every
 * JS-driven animation then advances in ~100ms steps: a 160ms transition gets
 * two or three frames total. LibreWolf ships RFP on by default, so that is its
 * out-of-the-box state, not a setting anyone went looking for.
 *
 * `MotionGlobalConfig.useManualTiming` makes the loop read `frameData` instead
 * of timing itself, which lets a ticker feed it the rAF timestamp.
 *
 * Installed only when the clock is measurably coarse. It costs a permanent rAF
 * loop, and where `performance.now()` already advances per frame there is
 * nothing to fix.
 */

/** Frames to watch before deciding. RFP yields ~1 distinct reading per 6. */
const SAMPLE_FRAMES = 12;
/** Below this share of distinct readings the clock is not per-frame. */
const DISTINCT_RATIO = 0.5;

/** The clamp the frame loop applies when it times itself — mirrored here so
 *  switching clocks doesn't also change how a long frame is absorbed. */
const MAX_DELTA_MS = 40;
const MIN_DELTA_MS = 1;

/**
 * Measures the clock and, if it is too coarse to drive animation, points
 * Motion at the rAF timestamp instead. Returns a disposer; call once per
 * document, from the client entry.
 */
export function installMotionTiming(): () => void {
  if (typeof requestAnimationFrame !== "function") return () => {};

  let raf = 0;
  let stopped = false;
  let frames = 0;
  let distinct = 0;
  let previous = Number.NaN;

  const drive = (timestamp: number) => {
    // Re-queued first so this stays ahead of the frame loop's own callback,
    // which re-queues itself only at the end of its batch.
    raf = requestAnimationFrame(drive);
    const elapsed = timestamp - frameData.timestamp;
    frameData.delta = Math.max(Math.min(elapsed, MAX_DELTA_MS), MIN_DELTA_MS);
    frameData.timestamp = timestamp;
  };

  const sample = () => {
    const reading = performance.now();
    if (reading !== previous) {
      distinct++;
      previous = reading;
    }
    if (++frames < SAMPLE_FRAMES) {
      raf = requestAnimationFrame(sample);
      return;
    }
    if (stopped || distinct / frames >= DISTINCT_RATIO) return;
    MotionGlobalConfig.useManualTiming = true;
    raf = requestAnimationFrame(drive);
  };

  raf = requestAnimationFrame(sample);

  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
    MotionGlobalConfig.useManualTiming = false;
  };
}
