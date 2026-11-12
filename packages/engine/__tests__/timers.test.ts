import { describe, expect, it } from "vite-plus/test";

import { defineEntityType, defineGame } from "../game/define";
import { pointField } from "../game/fields";
import type { EngineContext, GameDefinition, SceneSystem } from "../game/types";
import { createSceneRuntime } from "../runtime/runtime";
import type { ExpandedScene, RuntimeEntity } from "../scene/types";

type Hook = ((ctx: EngineContext) => void) | null;

/** A game whose `dot` system runs a test's hooks in `ready` and after physics, and whose runtime runs one after the timers. */
function timerGame(rate = 60) {
  const hooks: { ready: Hook; systemAfter: Hook; gameAfter: Hook } = {
    ready: null,
    systemAfter: null,
    gameAfter: null,
  };
  const dot = defineEntityType({
    type: "dot",
    description: "A point whose system runs a test's hooks.",
    fields: { at: pointField("Where it stands.") },
    system: (ctx): SceneSystem => {
      const live = new Set<string>();
      return {
        spawn: (e) => void live.add(e.id),
        despawn: (id) => void live.delete(id),
        clear: () => live.clear(),
        size: () => live.size,
        ready: () => hooks.ready?.(ctx),
        afterStep: () => hooks.systemAfter?.(ctx),
      };
    },
  });
  const game: GameDefinition = defineGame({
    id: "timers",
    types: [dot],
    actions: [],
    time: { kind: "fixed", rate },
    createRuntime: (ctx) => ({
      afterStep: () => hooks.gameAfter?.(ctx),
      snapshot: () => null,
    }),
  });
  return { game, hooks };
}

function scene(entities: RuntimeEntity[]): ExpandedScene {
  return {
    name: "timers",
    bounds: [-100, -100, 100, 100],
    settings: { gravity: [0, 0], physics: "none", grid: null, view: { projection: "orthogonal" } },
    entities,
  };
}

const dots: RuntimeEntity[] = [{ id: "a", type: "dot", at: [3, 4] }];

function setup(opts: { rate?: number; timeOffsetMs?: number; ready?: Hook } = {}) {
  const parts = timerGame(opts.rate);
  parts.hooks.ready = opts.ready ?? null;
  const rt = createSceneRuntime({ rapier: undefined, view: null, game: parts.game });
  const play = opts.timeOffsetMs === undefined ? undefined : { timeOffsetMs: opts.timeOffsetMs };
  expect(rt.load(scene(dots), play)).toMatchObject({ ok: true });
  const dt = rt.ctx.time.tickMs;
  const steps = (n: number) => {
    for (let i = 0; i < n; i++) rt.step(dt, []);
  };
  return { rt, ctx: rt.ctx, steps, dt, ...parts };
}

describe("due order", () => {
  it("runs by due tick, then creation", () => {
    const { ctx, steps, rt } = setup();
    const log: string[] = [];
    const mark = (name: string) => () => void log.push(`${name}@${ctx.tick}`);
    ctx.timers.after(3, mark("a"));
    ctx.timers.after(1, mark("b"));
    ctx.timers.after(3, mark("c"));
    ctx.timers.after(0, mark("d"));
    expect(ctx.timers.size).toBe(4);
    steps(4);
    expect(log).toEqual(["d@0", "b@1", "a@3", "c@3"]);
    expect(ctx.timers.size).toBe(0);
    rt.destroy();
  });

  it("runs after(0) this tick when made before the timer phase, else next tick", () => {
    const { steps, hooks, rt } = setup();
    const log: string[] = [];
    hooks.systemAfter = (c) => {
      hooks.systemAfter = null;
      c.timers.after(0, () => {
        log.push(`before@${c.tick}`);
        c.timers.after(0, () => void log.push(`inside@${c.tick}`));
      });
    };
    hooks.gameAfter = (c) => {
      hooks.gameAfter = null;
      c.timers.after(0, () => void log.push(`after@${c.tick}`));
    };
    steps(3);
    expect(log).toEqual(["before@0", "inside@1", "after@1"]);
    rt.destroy();
  });

  it("advance only on simulated ticks", () => {
    const { ctx, steps, rt } = setup();
    let fired = 0;
    ctx.timers.after(2, () => fired++);
    expect(fired).toBe(0);
    steps(2);
    expect(fired).toBe(0);
    steps(1);
    expect(fired).toBe(1);
    rt.destroy();
  });

  it("cancel drops a timer, also from inside its own action", () => {
    const { ctx, steps, rt } = setup();
    const ticks: number[] = [];
    const late = ctx.timers.after(1, () => void ticks.push(-1));
    const id = ctx.timers.every(1, () => {
      ticks.push(ctx.tick);
      if (ticks.length === 2) ctx.timers.cancel(id);
    });
    ctx.timers.cancel(late);
    steps(6);
    expect(ticks).toEqual([1, 2]);
    expect(ctx.timers.size).toBe(0);
    rt.destroy();
  });

  it("rejects delays that aren't whole ticks", () => {
    const { ctx, rt } = setup();
    expect(() => ctx.timers.after(-1, () => {})).toThrow(RangeError);
    expect(() => ctx.timers.after(1.5, () => {})).toThrow(RangeError);
    expect(() => ctx.timers.every(2, () => {}, { times: 0 })).toThrow(RangeError);
    expect(() => ctx.timers.after({ ms: Number.NaN }, () => {})).toThrow(RangeError);
    rt.destroy();
  });
});

describe("{ ms } delays", () => {
  it.each([
    [60, 6, 3],
    [30, 3, 2],
  ])("round once at creation at %i Hz", (rate, hundredMsTick, fiftyMsTick) => {
    const { ctx, steps, rt } = setup({ rate });
    const log: string[] = [];
    ctx.timers.after({ ms: 100 }, () => void log.push(`100@${ctx.tick}`));
    ctx.timers.after({ ms: 50 }, () => void log.push(`50@${ctx.tick}`));
    steps(10);
    expect(log).toEqual([`50@${fiftyMsTick}`, `100@${hundredMsTick}`]);
    rt.destroy();
  });
});

describe("owners", () => {
  it("cancels what an entity owns when it is destroyed", () => {
    const { ctx, steps, rt } = setup();
    let fired = 0;
    ctx.timers.after(3, () => fired++, { owner: "a" });
    ctx.timers.every(1, () => fired++, { owner: "a" });
    ctx.timers.start(
      function* () {
        yield 2;
        fired++;
      },
      { owner: "a" },
    );
    ctx.timers.after(5, () => {}, { owner: "someone-else" });
    ctx.destroy("a");
    expect(ctx.timers.size).toBe(1);
    steps(6);
    expect(fired).toBe(0);
    rt.destroy();
  });

  it("pauses what a disabled entity owns, keeping the ticks left", () => {
    const { ctx, steps, rt } = setup();
    const fired: number[] = [];
    ctx.timers.after(4, () => void fired.push(ctx.tick), { owner: "a" });
    steps(2);
    ctx.setEnabled("a", false);
    steps(5);
    expect(fired).toEqual([]);
    ctx.setEnabled("a", true);
    steps(5);
    // Two ticks were left at the pause: ticks 2 and 3 became 7 and 8.
    expect(fired).toEqual([9]);
    rt.destroy();
  });

  it("starts a timer paused when its owner is already disabled", () => {
    const { ctx, steps, rt } = setup();
    const fired: number[] = [];
    ctx.setEnabled("a", false);
    ctx.timers.after(1, () => void fired.push(ctx.tick), { owner: "a" });
    steps(3);
    ctx.setEnabled("a", true);
    steps(3);
    expect(fired).toEqual([4]);
    rt.destroy();
  });
});

describe("every", () => {
  it("repeats by its period, `times` times", () => {
    const { ctx, steps, rt } = setup();
    const fired: number[] = [];
    ctx.timers.every(2, () => void fired.push(ctx.tick), { times: 3 });
    steps(10);
    expect(fired).toEqual([2, 4, 6]);
    expect(ctx.timers.size).toBe(0);
    rt.destroy();
  });

  it("repeats until cancelled without `times`", () => {
    const { ctx, steps, rt } = setup();
    const fired: number[] = [];
    ctx.timers.every({ ms: 50 }, () => void fired.push(ctx.tick));
    steps(10);
    expect(fired).toEqual([3, 6, 9]);
    expect(ctx.timers.size).toBe(1);
    rt.destroy();
  });
});

describe("coroutines", () => {
  it("start at the next timer phase and wait on a delay, then a predicate", () => {
    const { ctx, steps, rt } = setup();
    const log: string[] = [];
    let open = false;
    ctx.timers.start(function* () {
      log.push(`start@${ctx.tick}`);
      yield 2;
      log.push(`delay@${ctx.tick}`);
      yield { ms: 50 };
      log.push(`ms@${ctx.tick}`);
      yield () => open;
      log.push(`open@${ctx.tick}`);
    });
    steps(9);
    expect(log).toEqual(["start@0", "delay@2", "ms@5"]);
    expect(ctx.timers.size).toBe(1);
    open = true;
    steps(1);
    expect(log).toEqual(["start@0", "delay@2", "ms@5", "open@9"]);
    expect(ctx.timers.size).toBe(0);
    rt.destroy();
  });

  it("drop a coroutine that throws", () => {
    const { ctx, steps, rt } = setup();
    ctx.timers.start(function* () {
      yield 1;
      throw new Error("boom");
    });
    steps(1);
    expect(() => steps(1)).toThrow("boom");
    expect(ctx.timers.size).toBe(0);
    rt.destroy();
  });
});

describe("emit-form timers", () => {
  it("raise their event with data at the entity's pose", () => {
    const { ctx, rt, dt } = setup();
    const heard: unknown[] = [];
    ctx.events.on("boom", (e) => void heard.push(e.data));
    ctx.timers.after(1, { emit: "boom", entityId: "a", data: { n: 1 } });
    ctx.timers.after(1, { emit: "bare" });
    expect(rt.step(dt, []).events).toEqual([]);
    expect(rt.step(dt, []).events).toEqual([
      { tick: 1, type: "boom", entityId: "a", at: { x: 3, y: 4 }, data: { n: 1 } },
      { tick: 1, type: "bare", at: { x: 0, y: 0 } },
    ]);
    expect(heard).toEqual([{ n: 1 }]);
    rt.destroy();
  });
});

describe("seek", () => {
  /** Timers made in `ready`, logging each run with the phase it ran in. */
  function readyTimers(log: string[]): Hook {
    return (ctx) => {
      const mark = (name: string) => () =>
        void log.push(`${name}${ctx.seeking ? " (seeking)" : ` @${ctx.tick}`}`);
      ctx.timers.every(10, mark("every"));
      ctx.timers.after(59, mark("last-sought"));
      ctx.timers.after(60, mark("first-stepped"));
      ctx.timers.after(65, mark("later"));
    };
  }

  it("fires what a 1,000 ms run would, in order, then starts at tick 0", () => {
    const ran: string[] = [];
    const run = setup({ ready: readyTimers(ran) });
    run.steps(Math.round(1000 / run.dt));
    const runLog = ran.map((line) => line.replace(/ @\d+$/, ""));
    run.rt.destroy();

    const sought: string[] = [];
    const seek = setup({ timeOffsetMs: 1000, ready: readyTimers(sought) });
    expect(sought.map((line) => line.replace(" (seeking)", ""))).toEqual(runLog);
    expect(sought.every((line) => line.endsWith("(seeking)"))).toBe(true);
    expect(seek.ctx.seeking).toBe(false);

    const first = seek.rt.step(seek.dt, []);
    expect(first.tick).toBe(0);
    expect(sought.slice(runLog.length)).toEqual(["every @0", "first-stepped @0"]);
    seek.steps(5);
    expect(sought.slice(runLog.length + 2)).toEqual(["later @5"]);
    seek.rt.destroy();
  });

  it("keep timers made in ready across the seek, and a reload resets them", () => {
    const { ctx, rt, steps, hooks } = setup({
      timeOffsetMs: 500,
      ready: (c) => void c.timers.after(40, () => {}),
    });
    expect(ctx.timers.size).toBe(1);
    steps(15);
    expect(ctx.timers.size).toBe(0);
    ctx.timers.after(5, () => {});
    hooks.ready = null;
    expect(rt.load(scene(dots))).toMatchObject({ ok: true });
    expect(ctx.timers.size).toBe(0);
    rt.destroy();
  });
});
