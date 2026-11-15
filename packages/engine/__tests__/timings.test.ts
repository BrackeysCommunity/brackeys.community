// @vitest-environment node
import { beforeAll, describe, expect, it } from "vite-plus/test";

import { createHeadlessRuntime } from "../headless/headless";
import { createRunTiming } from "../runtime/timing";
import { createTimings, phaseOf, TICK_PHASES, type TimingsOptions } from "../runtime/timings";
import type { RapierModule } from "../types";
import { engineYard } from "./fixtures/engine-yard.expanded";
import { runDigest } from "./fixtures/live-version";
import { testGame } from "./fixtures/test-game";

let rapier: RapierModule;

beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

/** A clock that moves 1 ms on every read. */
function steppingClock() {
  const clock = { reads: 0, now: () => ++clock.reads };
  return clock;
}

function runtimeWith(extra: {
  timings?: TimingsOptions;
  timing?: ReturnType<typeof createRunTiming>;
}) {
  return createHeadlessRuntime({ rapier, game: testGame, scene: engineYard(), ...extra });
}

describe("createTimings", () => {
  it("gives each phase's mean and worst per tick from a 1 ms clock", () => {
    const clock = steppingClock();
    const timings = createTimings({ clock: clock.now, window: 2 });
    const tick = (extraBehaviorLaps: number) => {
      const span = timings.begin()!;
      span.lap("input");
      span.lap("system.prop.afterStep");
      span.lap("behavior.anim.beforeStep");
      for (let i = 0; i < 1 + extraBehaviorLaps; i++) span.lap("behavior.anim");
      span.lap("events");
      span.lap("events.again");
      span.end();
    };

    tick(0);
    expect(timings.view()).toBeNull();
    tick(2);
    const view = timings.view()!;

    expect(view.ticks).toBe(2);
    expect(view.phases["systems-before"]).toEqual({ mean: 1, max: 1 });
    expect(view.phases["systems-after"]).toEqual({ mean: 1, max: 1 });
    expect(view.phases.behaviors).toEqual({ mean: 3, max: 4 });
    expect(view.phases["dispatch-1"]).toEqual({ mean: 1, max: 1 });
    expect(view.phases["dispatch-2"]).toEqual({ mean: 1, max: 1 });
    expect(view.phases.physics).toEqual({ mean: 0, max: 0 });
    expect(Object.keys(view.phases)).toEqual([...TICK_PHASES]);
    expect(view.systems).toEqual({ prop: { mean: 1, max: 1 } });
    expect(view.behaviors).toEqual({ anim: { mean: 3, max: 4 } });
  });

  it("keeps the last full window while the next fills", () => {
    const timings = createTimings({ clock: steppingClock().now, window: 1 });
    timings.begin()!.end();
    const first = timings.view();
    expect(first?.ticks).toBe(1);
    timings.begin()!.lap("timers");
    expect(timings.view()).toBe(first);
  });

  it("puts every part the runtime laps in one phase, scripts under their behavior name", () => {
    expect(phaseOf("behavior.script.beforePhysics")).toEqual({
      phase: "behaviors",
      behavior: "script",
    });
    expect(phaseOf("behavior.my.script")).toEqual({ phase: "behaviors", behavior: "my.script" });
    expect(phaseOf("system.sensor.beforePhysics")).toEqual({ phase: "physics", system: "sensor" });
    expect(phaseOf("game.snapshot")).toEqual({ phase: "commit" });
    expect(phaseOf("nope")).toBeNull();
  });
});

describe("a runtime with timings", () => {
  it("attributes every lap of a step to a phase", () => {
    const clock = steppingClock();
    const runtime = runtimeWith({ timings: { clock: clock.now, window: 10 } });
    clock.reads = 0;
    for (let i = 0; i < 10; i++) runtime.step(runtime.ctx.time.tickMs, []);
    const view = runtime.timings()!;
    runtime.destroy();

    expect(view.ticks).toBe(10);
    const phaseMs = TICK_PHASES.reduce((sum, p) => sum + view.phases[p].mean, 0);
    // A span reads the clock at `begin`, once per lap and at `end`; each lap's 1 ms lands in a phase.
    expect(phaseMs).toBeCloseTo(clock.reads / 10 - 2, 6);
    expect(view.phases.physics.mean).toBeGreaterThanOrEqual(1);
    expect(view.phases["game-before"]).toEqual({ mean: 1, max: 1 });
    expect(view.phases.commit.mean).toBeGreaterThanOrEqual(1);
    expect(Object.keys(view.systems)).toEqual(expect.arrayContaining(["sensor"]));
  });

  it("never reads the clock while off, and has no timings", () => {
    const clock = steppingClock();
    const runtime = runtimeWith({ timings: { clock: clock.now, window: 1, enabled: () => false } });
    for (let i = 0; i < 5; i++) runtime.step(runtime.ctx.time.tickMs, []);
    expect(clock.reads).toBe(0);
    expect(runtime.timings()).toBeNull();
    runtime.destroy();

    const plain = runtimeWith({});
    plain.step(plain.ctx.time.tickMs, []);
    expect(plain.timings()).toBeNull();
    plain.destroy();
  });

  it("times one step into both a collector and the window", () => {
    const timing = createRunTiming(() => performance.now());
    const runtime = runtimeWith({ timing, timings: { clock: steppingClock().now, window: 3 } });
    for (let i = 0; i < 3; i++) runtime.step(runtime.ctx.time.tickMs, []);
    expect(runtime.stats().timing!.tick.calls).toBe(3);
    expect(runtime.timings()!.ticks).toBe(3);
    runtime.destroy();
  });

  it("ends on the same digest with timings on and off", () => {
    const off = runtimeWith({});
    const on = runtimeWith({ timings: { clock: steppingClock().now, window: 7 } });
    expect(runDigest(on, 120)).toBe(runDigest(off, 120));
    on.destroy();
    off.destroy();
  });
});
