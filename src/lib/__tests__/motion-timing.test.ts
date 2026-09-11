import { frameData, MotionGlobalConfig } from "framer-motion";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { installMotionTiming } from "@/lib/motion-timing";

/**
 * `resolution: 0` is a per-frame clock; `100` is Firefox's
 * resistFingerprinting clamp, which holds one reading for ~6 frames.
 */
function harness(resolution: number) {
  const queue: FrameRequestCallback[] = [];
  let real = 0;

  vi.stubGlobal("performance", {
    now: () => (resolution === 0 ? real : Math.floor(real / resolution) * resolution),
  });
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => queue.push(cb));
  vi.stubGlobal("cancelAnimationFrame", () => {});

  return {
    /** Runs `count` frames of 16ms each, passing the rAF timestamp through. */
    pump: (count: number) => {
      for (let i = 0; i < count; i++) {
        real += 16;
        for (const cb of queue.splice(0, queue.length)) cb(real);
      }
      return real;
    },
  };
}

afterEach(() => {
  MotionGlobalConfig.useManualTiming = false;
  frameData.timestamp = 0;
  frameData.delta = 0;
  vi.unstubAllGlobals();
});

test("a clock that advances per frame is left alone", () => {
  const { pump } = harness(0);
  const stop = installMotionTiming();
  pump(40);
  // Left unset, not set to false: the frame loop keeps timing itself.
  expect(MotionGlobalConfig.useManualTiming).toBeFalsy();
  expect(frameData.timestamp).toBe(0);
  stop();
});

test("an RFP-clamped clock hands the frame loop the rAF timestamp", () => {
  const { pump } = harness(100);
  const stop = installMotionTiming();

  // Detection needs its sample window before it commits.
  pump(12);
  expect(MotionGlobalConfig.useManualTiming).toBe(true);

  const last = pump(5);
  expect(frameData.timestamp).toBe(last);
  // Per-frame delta, not the 100ms lurch `performance.now()` would have given.
  expect(frameData.delta).toBe(16);

  stop();
  expect(MotionGlobalConfig.useManualTiming).toBe(false);
});

test("a long frame is clamped the way the frame loop clamps its own", () => {
  const { pump } = harness(100);
  const stop = installMotionTiming();
  pump(12);

  frameData.timestamp = 0;
  pump(1);
  expect(frameData.delta).toBe(40);

  stop();
});
