// @vitest-environment node
import { beforeAll, describe, expect, it } from "vite-plus/test";

import { engineYard } from "../../__tests__/fixtures/engine-yard.expanded";
import { testGame } from "../../__tests__/fixtures/test-game";
import { createRunTiming, type TimingSpan } from "../../runtime/timing";
import type { RapierModule } from "../../types";
import { createHeadlessRuntime, runProbe } from "../headless";

let rapier: RapierModule;

beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

/** A clock a test moves by hand, counting its reads. */
function fakeClock() {
  const clock = { at: 0, reads: 0, now: () => (clock.reads++, clock.at) };
  return clock;
}

const partsTotal = (span: TimingSpan) =>
  Object.values(span.parts).reduce((sum, part) => sum + part.totalMs, 0);

describe("createRunTiming", () => {
  it("splits each span at its laps and keeps the worst span per part", () => {
    const clock = fakeClock();
    const timing = createRunTiming(clock.now);
    const tick = timing.scope("tick");

    for (const [a, b, glue] of [
      [2, 1, 0.5],
      [5, 3, 0],
    ] as const) {
      expect(tick.begin()).toBe(true);
      clock.at += a;
      tick.lap("a");
      clock.at += b;
      tick.lap("b");
      clock.at += b;
      tick.lap("b");
      clock.at += glue;
      tick.end();
    }

    expect(timing.report()).toEqual({
      tick: {
        calls: 2,
        totalMs: 15.5,
        maxMs: 11,
        unattributedMs: 0.5,
        parts: {
          a: { calls: 2, totalMs: 7, maxMs: 5 },
          b: { calls: 4, totalMs: 8, maxMs: 6 },
        },
      },
    });
  });

  it("reads no clock and reports nothing while disabled", () => {
    const clock = fakeClock();
    const timing = createRunTiming(clock.now);
    timing.enabled = false;
    const tick = timing.scope("tick");

    expect(tick.begin()).toBe(false);
    tick.lap("a");
    tick.end();

    expect(clock.reads).toBe(0);
    expect(timing.report().tick).toEqual({
      calls: 0,
      totalMs: 0,
      maxMs: 0,
      unattributedMs: 0,
      parts: {},
    });
  });

  it("drops a span that never ended, and forgets everything on reset", () => {
    const clock = fakeClock();
    const timing = createRunTiming(clock.now);
    const tick = timing.scope("tick");

    tick.begin();
    clock.at += 4;
    tick.lap("a");
    tick.begin();
    clock.at += 1;
    tick.lap("a");
    tick.end();
    expect(timing.report().tick).toMatchObject({
      calls: 1,
      totalMs: 1,
      parts: { a: { calls: 2, totalMs: 1, maxMs: 1 } },
    });

    timing.reset();
    expect(timing.report().tick).toMatchObject({ calls: 0, totalMs: 0, parts: {} });
  });

  it("reports the shell's scopes only once they ran", () => {
    const timing = createRunTiming(fakeClock().now);
    expect(Object.keys(timing.report())).toEqual(["tick"]);
    const draw = timing.scope("draw");
    draw.begin();
    draw.end();
    expect(Object.keys(timing.report())).toEqual(["tick", "draw"]);
  });
});

describe("a timed runtime", () => {
  it("times each step's parts, which add up to no more than the ticks' total", () => {
    const timing = createRunTiming(() => performance.now());
    const runtime = createHeadlessRuntime({ rapier, game: testGame, scene: engineYard(), timing });
    for (let i = 0; i < 30; i++) runtime.step(runtime.ctx.time.tickMs, []);
    const { tick } = runtime.stats().timing!;
    runtime.destroy();

    expect(tick.calls).toBe(30);
    expect(Object.keys(tick.parts)).toEqual(
      expect.arrayContaining([
        "input",
        "game.beforeStep",
        "physics.step",
        "system.prop.afterStep",
        "system.sensor.afterStep",
        "contacts",
        "timers",
        "events",
        "lifecycle",
        "game.snapshot",
      ]),
    );
    expect(tick.parts["physics.step"]).toMatchObject({ calls: 30 });
    expect(tick.totalMs).toBeGreaterThan(0);
    expect(partsTotal(tick)).toBeLessThanOrEqual(tick.totalMs + 0.01);
    expect(tick.unattributedMs).toBeCloseTo(tick.totalMs - partsTotal(tick), 1);
    expect(tick.maxMs).toBeLessThanOrEqual(tick.totalMs);
  });

  it("has no timing in its stats without a collector, or with one switched off", () => {
    const plain = createHeadlessRuntime({ rapier, game: testGame, scene: engineYard() });
    plain.step(plain.ctx.time.tickMs, []);
    expect("timing" in plain.stats()).toBe(false);
    plain.destroy();

    const clock = fakeClock();
    const timing = createRunTiming(clock.now);
    timing.enabled = false;
    const off = createHeadlessRuntime({ rapier, game: testGame, scene: engineYard(), timing });
    off.step(off.ctx.time.tickMs, []);
    expect("timing" in off.stats()).toBe(false);
    expect(clock.reads).toBe(0);
    off.destroy();
  });

  it("adds up across the runtimes sharing a collector", () => {
    const timing = createRunTiming(() => performance.now());
    for (let n = 0; n < 2; n++) {
      const runtime = createHeadlessRuntime({ rapier, scene: engineYard(), timing });
      for (let i = 0; i < 5; i++) runtime.step(runtime.ctx.time.tickMs, []);
      runtime.destroy();
    }
    expect(timing.report().tick.calls).toBe(10);
  });
});

describe("a timed probe", () => {
  const opts = () => ({
    rapier,
    game: testGame,
    scene: engineYard(),
    ticks: 90,
    hold: ["right"],
  });

  it("reports the same run as an untimed one, apart from stats.timing", () => {
    const plain = runProbe(opts());
    const timed = runProbe({ ...opts(), timing: createRunTiming(() => performance.now()) });

    expect("timing" in plain.stats).toBe(false);
    expect(timed.stats.timing!.tick.calls).toBe(90);
    const { timing: _, ...stats } = timed.stats;
    expect({ ...timed, stats }).toEqual(plain);
  });
});
