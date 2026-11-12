import { describe, expect, it } from "vite-plus/test";

import { defineEntityType, defineGame } from "../game/define";
import { pointField } from "../game/fields";
import {
  EngineError,
  type EngineContext,
  type GameDefinition,
  type Pool,
  type SceneSystem,
} from "../game/types";
import { createPool } from "../runtime/pool";
import { createSceneRuntime } from "../runtime/runtime";
import { ENTITY_DISABLED } from "../runtime/types";
import type { ExpandedScene } from "../scene/types";

const DT = 1000 / 60;

type Spawned = Record<string, unknown>;

/**
 * A game with one `bullet` type whose runtime makes a fresh pool at each
 * load; `during.run` runs inside the next step's `beforeStep`.
 */
function poolGame(opts: { max?: number; bullet?: Spawned } = {}) {
  const during: { run: ((ctx: EngineContext, pool: Pool) => void) | null } = { run: null };
  const state: { pool: Pool | null; loads: number } = { pool: null, loads: 0 };

  const bullet = defineEntityType({
    type: "bullet",
    description: "A point that stands where it was spawned.",
    fields: { at: pointField("Where it stands.") },
    system: (): SceneSystem => {
      const live = new Set<string>();
      return {
        spawn: (e) => void live.add(e.id),
        despawn: (id) => void live.delete(id),
        clear: () => live.clear(),
        size: () => live.size,
      };
    },
  });

  const game: GameDefinition = defineGame({
    id: "pooling",
    types: [bullet],
    behaviors: [],
    actions: [],
    createRuntime: (ctx) => ({
      onLoad() {
        state.loads++;
        state.pool = createPool(ctx, {
          spawn: () => ctx.spawn({ type: "bullet", at: [0, 0], ...opts.bullet }).id,
          ...(opts.max === undefined ? {} : { max: opts.max }),
        });
      },
      onUnload() {
        state.pool = null;
      },
      beforeStep() {
        const run = during.run;
        during.run = null;
        run?.(ctx, state.pool!);
      },
      snapshot: () => null,
    }),
  });
  return { game, during, state };
}

const scene: ExpandedScene = {
  name: "pooling",
  bounds: [-100, -100, 100, 100],
  settings: {
    gravity: [0, 0],
    physics: "none",
    grid: null,
    view: { projection: "orthogonal" },
  },
  entities: [],
};

function setup(opts: { max?: number; bullet?: Spawned } = {}) {
  const parts = poolGame(opts);
  const rt = createSceneRuntime({ rapier: undefined, view: null, game: parts.game });
  expect(rt.load(scene)).toMatchObject({ ok: true });
  const pool = () => parts.state.pool!;
  return { ...parts, rt, pool };
}

describe("createPool", () => {
  it("spawns while nothing is free, then reuses the most recently released entity first", () => {
    const { rt, pool } = setup();
    const p = pool();
    expect([p.free, p.live]).toEqual([0, 0]);
    expect([p.acquire(), p.acquire(), p.acquire()]).toEqual(["bullet#1", "bullet#2", "bullet#3"]);
    expect([p.free, p.live]).toEqual([0, 3]);

    p.release("bullet#1");
    p.release("bullet#3");
    expect(rt.ctx.enabled("bullet#1")).toBe(false);
    expect(rt.ctx.exists("bullet#1")).toBe(true);
    expect([p.free, p.live]).toEqual([2, 1]);

    expect(p.acquire()).toBe("bullet#3");
    expect(rt.ctx.enabled("bullet#3")).toBe(true);
    expect(p.acquire()).toBe("bullet#1");
    expect(p.acquire()).toBe("bullet#4");
    expect([p.free, p.live]).toEqual([0, 4]);
    rt.destroy();
  });

  it("ignores a release of an id it doesn't hold, and a second release of a free one", () => {
    const { rt, pool } = setup();
    const p = pool();
    const outsider = rt.ctx.spawn({ type: "bullet", at: [5, 5] }).id;
    p.release(outsider);
    expect(rt.ctx.enabled(outsider)).toBe(true);

    const id = p.acquire()!;
    p.release(id);
    p.release(id);
    expect([p.free, p.live]).toEqual([1, 0]);
    expect(p.acquire()).toBe(id);
    expect(p.free).toBe(0);
    rt.destroy();
  });

  it("stops spawning at max and hands out nothing until an entity is released", () => {
    const { rt, pool } = setup({ max: 2 });
    const p = pool();
    expect([p.acquire(), p.acquire(), p.acquire()]).toEqual(["bullet#1", "bullet#2", null]);
    p.release("bullet#2");
    expect(p.acquire()).toBe("bullet#2");
    expect(p.acquire()).toBeNull();
    expect(rt.ctx.exists("bullet#3")).toBe(false);
    rt.destroy();
  });

  it("refuses a max that isn't a whole number of entities", () => {
    const { rt } = setup();
    for (const max of [-1, 1.5, Number.NaN]) {
      expect(() => createPool(rt.ctx, { spawn: () => "x", max })).toThrow(RangeError);
    }
    expect(createPool(rt.ctx, { spawn: () => "x", max: 0 }).acquire()).toBeNull();
    rt.destroy();
  });

  it("takes back an entity disabled by anything, inside a step or out", () => {
    const { rt, pool, during } = setup();
    const p = pool();
    const [a, b] = [p.acquire()!, p.acquire()!];

    during.run = (ctx) => ctx.setEnabled(a, false);
    const step = rt.step(DT, []);
    expect(step.events.map((e) => [e.type, e.entityId])).toEqual([[ENTITY_DISABLED, a]]);
    expect([p.free, p.live]).toEqual([1, 1]);

    rt.ctx.setEnabled(b, false);
    expect([p.free, p.live]).toEqual([2, 0]);
    expect(p.acquire()).toBe(b);

    rt.ctx.setEnabled(a, true);
    expect([p.free, p.live]).toEqual([0, 2]);
    expect(p.acquire()).toBe("bullet#3");
    rt.destroy();
  });

  it("returns an entity whose lifetime disables it, and its lifetime restarts on reuse", () => {
    const { rt, pool, during } = setup({
      bullet: { behaviors: { lifetime: { ticks: 2, then: "disable" } } },
    });
    let id: string | null = null;
    during.run = (_ctx, p) => void (id = p.acquire());
    rt.step(DT, []);
    expect(id).toBe("bullet#1");
    const p = pool();
    expect([p.free, p.live]).toEqual([0, 1]);

    let ticks = 1;
    while (rt.ctx.enabled("bullet#1") && ticks < 10) {
      rt.step(DT, []);
      ticks++;
    }
    expect(rt.ctx.enabled("bullet#1")).toBe(false);
    expect(rt.ctx.exists("bullet#1")).toBe(true);
    expect([p.free, p.live]).toEqual([1, 0]);

    during.run = (_ctx, pool) => void (id = pool.acquire());
    rt.step(DT, []);
    expect(id).toBe("bullet#1");
    expect([p.free, p.live]).toEqual([0, 1]);
    for (let i = 1; i < ticks; i++) rt.step(DT, []);
    expect(rt.ctx.enabled("bullet#1")).toBe(false);
    expect(p.free).toBe(1);
    rt.destroy();
  });

  it("stays consistent when pooled entities are destroyed, free or live", () => {
    const { rt, pool, during } = setup({ max: 3 });
    const p = pool();
    const [a, b, c] = [p.acquire()!, p.acquire()!, p.acquire()!];
    p.release(a);
    p.release(b);

    rt.ctx.destroy(b);
    expect([p.free, p.live]).toEqual([1, 1]);

    during.run = (ctx) => ctx.destroy(c);
    rt.step(DT, []);
    expect(rt.ctx.exists(c)).toBe(false);
    expect([p.free, p.live]).toEqual([1, 0]);

    p.release(c);
    expect(p.acquire()).toBe(a);
    expect([p.acquire(), p.acquire(), p.acquire()]).toEqual(["bullet#4", "bullet#5", null]);
    expect([p.free, p.live]).toEqual([0, 3]);
    rt.destroy();
  });

  it("dies with the load: the next load's pool starts empty", () => {
    const { rt, pool, state } = setup();
    const first = pool();
    first.acquire();
    first.release("bullet#1");
    expect(first.free).toBe(1);

    expect(rt.load(scene)).toMatchObject({ ok: true });
    expect(state.loads).toBe(2);
    const second = pool();
    expect(second).not.toBe(first);
    expect([second.free, second.live]).toEqual([0, 0]);
    expect([first.free, first.live]).toEqual([0, 0]);
    expect(second.acquire()).toBe("bullet#1");
    expect(rt.ctx.enabled("bullet#1")).toBe(true);
    rt.destroy();
  });

  it("refuses to work after its load, so it can't take the next load's bullet#1", () => {
    const { rt, pool } = setup();
    const kept = pool();
    expect(kept.acquire()).toBe("bullet#1");
    kept.release("bullet#1");

    expect(rt.load(scene)).toMatchObject({ ok: true });
    const fresh = pool();
    expect(fresh.acquire()).toBe("bullet#1");
    fresh.release("bullet#1");

    for (const use of [() => kept.acquire(), () => kept.release("bullet#1")]) {
      let caught: unknown;
      try {
        use();
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(EngineError);
      expect((caught as EngineError).code).toBe("pool-stale");
      expect((caught as EngineError).message).toContain("earlier load");
    }
    expect([kept.free, kept.live]).toEqual([0, 0]);
    expect(rt.ctx.enabled("bullet#1")).toBe(false);
    expect([fresh.free, fresh.live]).toEqual([1, 0]);

    rt.unload();
    expect(() => fresh.acquire()).toThrow(expect.objectContaining({ code: "pool-stale" }));
    rt.destroy();
  });

  it("never goes stale on a context without a load generation", () => {
    const { rt } = setup();
    const ctx = { ...rt.ctx } as EngineContext;
    const p = createPool(ctx, { spawn: () => rt.ctx.spawn({ type: "bullet", at: [0, 0] }).id });
    expect(p.acquire()).toBe("bullet#1");
    rt.destroy();
  });
});
