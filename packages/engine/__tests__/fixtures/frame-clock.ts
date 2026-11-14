/**
 * Driving a browser game's loop by hand in jsdom: the animation frames, the
 * clock they read, a renderer with no GPU, and a scene view that records the
 * camera each frame hands it.
 */
import { vi } from "vite-plus/test";

import type { PixiView } from "../../render/pixi-view";

/** One fixed tick at 60 Hz, ms. */
export const TICK_MS = 1000 / 60;

export type FrameClock = {
  /** Moves the clock on by `ms` and runs the frames the loop asked for. */
  advance(ms: number): void;
  /** Runs `n` frames a tick apart: each steps one tick, then renders. */
  ticks(n: number): void;
};

/**
 * Stubs `requestAnimationFrame` so frames run only when the test says.
 * `performance` makes `performance.now()` read the same clock; `timers`
 * moves vitest's fake timers on with it; `date` sets the faked `Date` to it.
 */
export function manualFrames(
  opts: { performance?: boolean; timers?: boolean; date?: boolean } = {},
): FrameClock {
  let pending: FrameRequestCallback[] = [];
  let now = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => pending.push(cb));
  vi.stubGlobal("cancelAnimationFrame", () => {});
  if (opts.performance) vi.spyOn(performance, "now").mockImplementation(() => now);
  const advance = (ms: number) => {
    now += ms;
    if (opts.timers) vi.advanceTimersByTime(ms);
    if (opts.date) vi.setSystemTime(now);
    const due = pending;
    pending = [];
    for (const cb of due) cb(now);
  };
  return {
    advance,
    ticks(n) {
      for (let i = 0; i < n; i++) advance(TICK_MS);
    },
  };
}

/** A `../renderer` module for `vi.mock`: plain containers and no GPU. */
export async function stubRenderer() {
  const { Container } = await import("pixi.js");
  return {
    createRenderer: async () => ({
      app: {},
      worldContainer: new Container(),
      uiContainer: new Container(),
      resize: () => {},
      destroy: () => {},
    }),
  };
}

/** What a recording scene view saw: the camera of each frame and the views made, in order. */
export type FrameRecord = {
  frames: { x: number; y: number; zoom: number }[];
  views: PixiView[];
};

/**
 * A `../render/pixi-view` module for `vi.mock` whose views push each frame's
 * camera, and themselves, to `record`.
 */
export async function recordingPixiView(
  importOriginal: <T>() => Promise<T>,
  record: FrameRecord,
): Promise<typeof import("../../render/pixi-view")> {
  const real = await importOriginal<typeof import("../../render/pixi-view")>();
  return {
    ...real,
    createPixiView: (...args: Parameters<typeof real.createPixiView>) => {
      const view = real.createPixiView(...args);
      record.views.push(view);
      return {
        ...view,
        frame(f) {
          record.frames.push({ ...f.camera });
          view.frame!(f);
        },
      } satisfies PixiView;
    },
  };
}
