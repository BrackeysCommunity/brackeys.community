import { describe, expect, it } from "vite-plus/test";

import { DEFAULT_TICK_RATE } from "../game/defaults";
import {
  MAX_TICK_RATE,
  MIN_TICK_RATE,
  resolveTime,
  tickRateProblem,
  ticksFor,
  ticksIn,
  wholeTicksIn,
} from "../game/time";

describe("resolveTime", () => {
  it("is fixed at the engine's rate with nothing given", () => {
    expect(resolveTime({})).toEqual({
      kind: "fixed",
      rate: DEFAULT_TICK_RATE,
      tickMs: 1000 / DEFAULT_TICK_RATE,
      catchUp: null,
      wakeOnPointerMove: false,
    });
  });

  it("takes the game's model whole", () => {
    const time = resolveTime({
      game: { kind: "event", rate: 30, catchUp: { maxMs: 5000 }, wakeOnPointerMove: true },
    });
    expect(time).toEqual({
      kind: "event",
      rate: 30,
      tickMs: 1000 / 30,
      catchUp: { maxMs: 5000 },
      wakeOnPointerMove: true,
    });
    expect(time.tickMs).toBeCloseTo(33.333, 3);
    expect(Object.isFrozen(time)).toBe(true);
  });

  it("lets the project's tickRate beat the game's rate, and only the rate", () => {
    const time = resolveTime({ project: { tickRate: 120 }, game: { kind: "turns", rate: 30 } });
    expect(time).toMatchObject({ kind: "turns", rate: 120, tickMs: 1000 / 120 });
    expect(resolveTime({ project: { tickRate: 24 } })).toMatchObject({ kind: "fixed", rate: 24 });
  });

  it("passes over a project rate that isn't valid", () => {
    for (const tickRate of [0, 241, 1.5, "60", null]) {
      expect(resolveTime({ project: { tickRate }, game: { kind: "fixed", rate: 30 } }).rate).toBe(
        30,
      );
    }
  });

  it("copies catchUp rather than sharing the game's object", () => {
    const catchUp = { maxMs: 1000 };
    const time = resolveTime({ game: { kind: "fixed", catchUp } });
    expect(time.catchUp).toEqual(catchUp);
    expect(time.catchUp).not.toBe(catchUp);
  });
});

describe("tickRateProblem", () => {
  it("accepts every integer from the minimum to the maximum", () => {
    expect(MIN_TICK_RATE).toBe(1);
    expect(MAX_TICK_RATE).toBe(240);
    for (const rate of [MIN_TICK_RATE, 30, 60, MAX_TICK_RATE])
      expect(tickRateProblem(rate)).toBe(null);
  });

  it("names the bounds and the value for anything else", () => {
    for (const rate of [0, 241, 1.5, -60, Number.NaN, Infinity, "60", undefined]) {
      expect(tickRateProblem(rate)).toMatch(/integer from 1 to 240, got /);
    }
    expect(tickRateProblem(241)).toMatch(/got 241$/);
    expect(tickRateProblem("60")).toMatch(/got "60"$/);
  });
});

describe("ticksFor", () => {
  it("rounds to whole ticks at the rate", () => {
    expect(ticksFor(1000, { rate: 30 })).toBe(30);
    expect(ticksFor(1000, { rate: 60 })).toBe(60);
    expect(ticksFor(500, { rate: 30 })).toBe(15);
    expect(ticksFor(50, { rate: 30 })).toBe(2);
  });

  it("is at least one tick", () => {
    expect(ticksFor(0, { rate: 60 })).toBe(1);
    expect(ticksFor(1, { rate: 1 })).toBe(1);
  });
});

describe("ticksIn and wholeTicksIn", () => {
  it("counts whole-number ms exactly at 60 and 30 Hz, where ms / tickMs undercounts", () => {
    for (const [rate, ms, ticks] of [
      [60, 1000, 60],
      [60, 500, 30],
      [60, 250, 15],
      [30, 1000, 30],
      [30, 500, 15],
      [120, 1000, 120],
    ] as const) {
      const time = resolveTime({ game: { kind: "fixed", rate } });
      expect(Math.floor(ms / time.tickMs)).toBe(ticks - 1);
      expect(ticksIn(ms, time)).toBe(ticks);
      expect(wholeTicksIn(ms, time)).toEqual({ ticks, restMs: 0 });
      expect(ticksFor(ms, time)).toBe(ticks);
    }
  });

  it("keeps the part of a tick left over", () => {
    const at60 = { rate: 60 };
    expect(wholeTicksIn(10, at60)).toEqual({ ticks: 0, restMs: 10 });
    expect(wholeTicksIn(1010, at60)).toEqual({ ticks: 60, restMs: 10 });
    expect(wholeTicksIn(0, at60)).toEqual({ ticks: 0, restMs: 0 });
    expect(ticksIn(25, at60)).toBe(1.5);
  });
});
