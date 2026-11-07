import { describe, expect, it, vi, beforeEach, afterEach } from "vite-plus/test";

import { createGameLoop } from "../loop";

// Mock rAF/cAF — we drive the loop manually via the captured callback
let rafCallback: ((time: number) => void) | null = null;
let rafId = 1;

beforeEach(() => {
  rafCallback = null;
  rafId = 1;

  vi.stubGlobal("requestAnimationFrame", (cb: (time: number) => void) => {
    rafCallback = cb;
    return rafId++;
  });

  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Helper: advance the loop by calling the rAF callback at the given timestamp */
function tick(time: number): void {
  const cb = rafCallback;
  if (cb) {
    rafCallback = null;
    cb(time);
  }
}

describe("createGameLoop", () => {
  it("calls onTick with the correct fixed timestep", () => {
    const onTick = vi.fn();
    const onRender = vi.fn();
    const loop = createGameLoop({ tickRate: 60, onTick, onRender });

    loop.start();

    // Frame 1: initializes lastTime, no ticks yet
    tick(0);
    expect(onTick).not.toHaveBeenCalled();

    // Frame 2: 16.67ms later — exactly 1 tick at 60Hz
    tick(16.667);
    expect(onTick).toHaveBeenCalledTimes(1);
    expect(onTick).toHaveBeenCalledWith(1000 / 60);

    loop.stop();
  });

  it("accumulates multiple ticks for large deltas", () => {
    const onTick = vi.fn();
    const onRender = vi.fn();
    const loop = createGameLoop({ tickRate: 60, onTick, onRender });

    loop.start();
    tick(0); // init

    // 51ms delta → 3 ticks at ~16.67ms each (3 × 16.67 = 50.01 < 51)
    tick(51);
    expect(onTick).toHaveBeenCalledTimes(3);

    loop.stop();
  });

  it("calls onRender with alpha in [0, 1) range", () => {
    const onTick = vi.fn();
    const onRender = vi.fn();
    const loop = createGameLoop({ tickRate: 60, onTick, onRender });

    loop.start();
    tick(0);

    // 20ms delta: 1 tick (16.67ms), remainder ~3.33ms → alpha ≈ 0.2
    tick(20);
    expect(onRender).toHaveBeenCalled();
    const alpha = onRender.mock.calls[0]?.[0];
    expect(alpha).toBeGreaterThanOrEqual(0);
    expect(alpha).toBeLessThan(1);

    loop.stop();
  });

  it("clamps large deltas to prevent spiral of death", () => {
    const onTick = vi.fn();
    const onRender = vi.fn();
    const loop = createGameLoop({ tickRate: 60, onTick, onRender });

    loop.start();
    tick(0);

    // 5 second gap (e.g., tab was hidden) — should be clamped to 250ms
    // 250ms / 16.67ms ≈ 15 ticks max
    tick(5000);
    expect(onTick.mock.calls.length).toBeLessThanOrEqual(15);

    loop.stop();
  });

  it("clamps to the configured maxDeltaMs", () => {
    const onTick = vi.fn();
    const loop = createGameLoop({ tickRate: 100, maxDeltaMs: 50, onTick, onRender: vi.fn() });

    loop.start();
    tick(0);
    tick(5000);
    expect(onTick).toHaveBeenCalledTimes(5);

    loop.stop();
  });

  it("stop() prevents further ticks", () => {
    const onTick = vi.fn();
    const onRender = vi.fn();
    const loop = createGameLoop({ tickRate: 60, onTick, onRender });

    loop.start();
    tick(0);
    tick(16.667);
    expect(onTick).toHaveBeenCalledTimes(1);

    loop.stop();
    expect(loop.isRunning()).toBe(false);

    // Even if we somehow get another frame callback, it should bail
    tick(33.334);
    expect(onTick).toHaveBeenCalledTimes(1); // no more ticks
  });

  it("isRunning() reflects state correctly", () => {
    const loop = createGameLoop({
      tickRate: 60,
      onTick: vi.fn(),
      onRender: vi.fn(),
    });

    expect(loop.isRunning()).toBe(false);
    loop.start();
    expect(loop.isRunning()).toBe(true);
    loop.stop();
    expect(loop.isRunning()).toBe(false);
  });

  it("start() is idempotent", () => {
    const loop = createGameLoop({
      tickRate: 60,
      onTick: vi.fn(),
      onRender: vi.fn(),
    });

    loop.start();
    loop.start(); // should not start a second loop
    expect(loop.isRunning()).toBe(true);

    loop.stop();
  });

  it("getFPS returns 0 before enough frames have elapsed", () => {
    const loop = createGameLoop({
      tickRate: 60,
      onTick: vi.fn(),
      onRender: vi.fn(),
    });

    loop.start();
    tick(0);
    tick(16.667);

    // FPS counter hasn't hit 1 second window yet
    expect(loop.getFPS()).toBe(0);

    loop.stop();
  });
});

describe("pause, resume, step and time scale", () => {
  it("runs no ticks while paused but keeps rendering", () => {
    const onTick = vi.fn();
    const onRender = vi.fn();
    const loop = createGameLoop({ tickRate: 100, onTick, onRender });

    loop.start();
    tick(0);
    tick(10);
    expect(onTick).toHaveBeenCalledTimes(1);

    loop.pause();
    expect(loop.isPaused()).toBe(true);
    const renders = onRender.mock.calls.length;
    tick(20);
    tick(30);
    expect(onTick).toHaveBeenCalledTimes(1);
    expect(onRender.mock.calls.length).toBe(renders + 2);

    loop.stop();
  });

  it("has no catch-up burst after resume", () => {
    const onTick = vi.fn();
    const loop = createGameLoop({ tickRate: 100, onTick, onRender: vi.fn() });

    loop.start();
    tick(0);
    tick(5);
    loop.pause();
    tick(1000);
    tick(5000);
    loop.resume();
    expect(loop.isPaused()).toBe(false);

    tick(5005);
    expect(onTick).not.toHaveBeenCalled();
    tick(5010);
    expect(onTick).not.toHaveBeenCalled();
    tick(5015);
    expect(onTick).toHaveBeenCalledTimes(1);

    loop.stop();
  });

  it("step(3) runs exactly three ticks, paused or not", () => {
    const onTick = vi.fn();
    const loop = createGameLoop({ tickRate: 60, onTick, onRender: vi.fn() });

    loop.step(3);
    expect(onTick).toHaveBeenCalledTimes(3);
    for (const [dt] of onTick.mock.calls) expect(dt).toBe(1000 / 60);

    loop.start();
    loop.pause();
    tick(0);
    loop.step(3);
    tick(100);
    expect(onTick).toHaveBeenCalledTimes(6);

    loop.stop();
  });

  it("at 0.5x runs half the ticks over the same wall time, each with the fixed dt", () => {
    function ticksOver(scale: number): number[] {
      const dts: number[] = [];
      const loop = createGameLoop({
        tickRate: 100,
        onTick: (dt) => dts.push(dt),
        onRender: vi.fn(),
      });
      loop.setTimeScale(scale);
      loop.start();
      for (let t = 0; t <= 1000; t += 10) tick(t);
      loop.stop();
      return dts;
    }

    const full = ticksOver(1);
    const half = ticksOver(0.5);
    expect(full).toHaveLength(100);
    expect(half).toHaveLength(50);
    expect(new Set(half)).toEqual(new Set([10]));
  });

  it("rejects a negative or non-finite time scale", () => {
    const loop = createGameLoop({ tickRate: 60, onTick: vi.fn(), onRender: vi.fn() });
    expect(() => loop.setTimeScale(-1)).toThrow(RangeError);
    expect(() => loop.setTimeScale(Number.NaN)).toThrow(RangeError);
    loop.setTimeScale(0);
    expect(loop.getTimeScale()).toBe(0);
  });
});
