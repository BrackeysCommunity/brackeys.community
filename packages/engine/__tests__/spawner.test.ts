import { describe, expect, it, vi } from "vite-plus/test";

import type { BehaviorBlock } from "../game/behaviors";
import { SPAWNER } from "../game/behaviors/spawner";
import type { SpawnerSystem } from "../game/behaviors/spawner";
import { createRegistry, defineEntityType, defineGame } from "../game/define";
import { pointField } from "../game/fields";
import {
  EngineError,
  type EngineContext,
  type GameDefinition,
  type SceneSystem,
} from "../game/types";
import { createHeadlessRuntime } from "../headless/headless";
import { ENGINE_BEHAVIOR_SYSTEMS } from "../runtime/behaviors/index";
import { createSpawnerSystem } from "../runtime/behaviors/spawner";
import { registerBody, type BodyEntry } from "../runtime/bodies-control";
import { createSceneRuntime } from "../runtime/runtime";
import { worldSaveBlockers } from "../runtime/save-state";
import { SPAWNER_SPAWNED, type SceneRuntimeHandle, type StepEvent } from "../runtime/types";
import { hashText } from "../scene/hash";
import {
  SCENE_FORMAT_VERSION,
  type ExpandedScene,
  type Prefab,
  type RuntimeEntity,
} from "../scene/types";

/** A point type, and one whose system registers a dynamic body that only stores its velocity. */
function spawnGame(): GameDefinition {
  const dot = defineEntityType({
    type: "dot",
    description: "A point with no state of its own.",
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
  const ball = defineEntityType({
    type: "ball",
    description: "A point with a dynamic body.",
    fields: { at: pointField("Where it starts.") },
    system: (ctx: EngineContext): SceneSystem => {
      const off = new Map<string, () => void>();
      const entry = (): BodyEntry => {
        let v = { x: 0, y: 0 };
        return {
          kind: "dynamic",
          velocity: () => v,
          setVelocity: (next) => void (v = { x: next.x, y: next.y }),
          angularVelocity: () => 0,
          setAngularVelocity: () => {},
          applyImpulse: () => {},
          addForce: () => {},
          addTorque: () => {},
          resetForces: () => {},
          mass: () => 1,
          wake: () => {},
        };
      };
      return {
        spawn: (e) => void off.set(e.id, registerBody(ctx, e.id, entry())),
        despawn(id) {
          off.get(id)?.();
          off.delete(id);
        },
        clear() {
          for (const done of off.values()) done();
          off.clear();
        },
        size: () => off.size,
      };
    },
  });
  return defineGame({
    id: "spawning",
    types: [dot, ball],
    actions: [],
    time: { kind: "fixed", rate: 60 },
    createRuntime: () => ({ snapshot: () => null, restore: () => {} }),
  });
}

const pair: Prefab = {
  kind: "prefab",
  v: SCENE_FORMAT_VERSION,
  id: "pair",
  entities: [
    { id: "left", type: "dot", at: [0, 0] },
    { id: "right", type: "dot", at: [1, 0] },
  ],
};
const PREFABS = new Map([["pair", pair]]);

const spawner = (
  id: string,
  block: BehaviorBlock,
  at: [number, number] = [5, 5],
): RuntimeEntity => ({
  id,
  type: "dot",
  at,
  behaviors: { spawner: block },
});

function scene(entities: RuntimeEntity[]): ExpandedScene {
  return {
    name: "spawning",
    bounds: [-100, -100, 100, 100],
    settings: { gravity: [0, 0], physics: "none", grid: null, view: { projection: "orthogonal" } },
    entities,
  };
}

function setup(
  entities: RuntimeEntity[],
  play?: { seed?: string; timeOffsetMs?: number },
): {
  rt: SceneRuntimeHandle;
  ctx: EngineContext;
  steps: (n: number) => void;
  spawned: StepEvent[];
  system: SpawnerSystem;
} {
  const rt = createSceneRuntime({
    rapier: undefined,
    view: null,
    game: spawnGame(),
    prefabs: PREFABS,
  });
  expect(rt.load(scene(entities), play)).toMatchObject({ ok: true });
  const spawned: StepEvent[] = [];
  const steps = (n: number) => {
    for (let i = 0; i < n; i++) {
      const r = rt.step(rt.ctx.time.tickMs, []);
      for (const e of r.events) if (e.type === SPAWNER_SPAWNED) spawned.push(e);
    }
  };
  const system = rt.ctx.behavior<SpawnerSystem>("spawner")!;
  return { rt, ctx: rt.ctx, steps, spawned, system };
}

describe("the spawner behavior", () => {
  it("maps its system", () => {
    expect(ENGINE_BEHAVIOR_SYSTEMS.spawner).toBe(createSpawnerSystem);
  });

  it("takes exactly one of type or prefab", () => {
    expect(SPAWNER.refine!({ type: "dot" })).toBeUndefined();
    expect(SPAWNER.refine!({ prefab: "pair" })).toBeUndefined();
    expect(SPAWNER.refine!({})).toMatch(/exactly one of `type` or `prefab`/);
    expect(SPAWNER.refine!({ type: "dot", prefab: "pair" })).toMatch(/exactly one/);
    expect(SPAWNER.template).toEqual({ type: "marker" });
  });

  it("spawns 60 in 2 s at 30 a second, at its pose, raising spawner:spawned for each", () => {
    const { ctx, steps, spawned, system, rt } = setup([
      spawner("s", { type: "dot", rate: 30, cap: 1000 }),
    ]);
    steps(120);
    expect(spawned).toHaveLength(60);
    expect(system.live("s")).toHaveLength(60);
    expect(spawned[0]).toMatchObject({ entityId: "s", at: { x: 5, y: 5 } });
    const first = spawned[0]!;
    expect(first.other).toBe((first.data as { id: string }).id);
    expect(ctx.get(first.other!)).toMatchObject({ type: "dot", at: [5, 5] });
    expect(system.live("s")).toEqual(spawned.map((e) => e.other));
    rt.destroy();
  });

  it("holds the cap, owing no more than one spawn while there", () => {
    const { steps, spawned, system, rt } = setup([spawner("s", { type: "dot", rate: 60, cap: 5 })]);
    steps(300);
    expect(spawned).toHaveLength(5);
    expect(system.live("s")).toHaveLength(5);
    const saved = system.save!("s") as { owed: number };
    expect(saved.owed).toBeLessThanOrEqual(1);
    rt.destroy();
  });

  it("frees a slot when a spawn is destroyed, in a step or outside one", () => {
    const { ctx, steps, spawned, system, rt } = setup([
      spawner("s", { type: "dot", rate: 60, cap: 2 }),
    ]);
    steps(10);
    expect(system.live("s")).toHaveLength(2);
    const [a, b] = system.live("s");
    ctx.destroy(a!);
    steps(1);
    expect(system.live("s")).toEqual([b, spawned[2]!.other]);
    expect(spawned).toHaveLength(3);
    steps(5);
    expect(spawned).toHaveLength(3);
    rt.destroy();
  });

  it("frees slots as lifeMs spawns go, counting them from entity:destroyed", () => {
    // 100 ms is 6 ticks: each spawn goes at the end of the sixth tick after its own.
    const { ctx, steps, spawned, system, rt } = setup([
      spawner("s", { type: "dot", rate: 60, cap: 3, lifeMs: 100 }),
    ]);
    steps(3);
    const first = system.live("s")[0]!;
    expect(ctx.get(first)?.behaviors).toEqual({ lifetime: { ms: 100 } });
    steps(60);
    expect(system.live("s").length).toBeLessThanOrEqual(3);
    expect(spawned.length).toBeGreaterThan(20);
    expect(ctx.exists(first)).toBe(false);
    rt.destroy();
  });

  it("places spawns within spread from its own fork, the same for the same seed", () => {
    const offsets = (seed: string) => {
      const { steps, spawned, rt } = setup(
        [spawner("s", { type: "dot", rate: 30, cap: 100, spread: 3 })],
        {
          seed,
        },
      );
      steps(60);
      rt.destroy();
      return spawned.map((e) => [e.at.x - 5, e.at.y - 5] as const);
    };
    const a = offsets("one");
    expect(a).toHaveLength(30);
    for (const [x, y] of a) expect(x * x + y * y).toBeLessThanOrEqual(9 + 1e-9);
    expect(new Set(a.map(([x, y]) => `${x},${y}`)).size).toBe(30);
    expect(offsets("one")).toEqual(a);
    expect(offsets("two")).not.toEqual(a);
  });

  it("draws from ctx.random.fork('spawner:<id>') and nothing else", () => {
    const { ctx, steps, rt } = setup([spawner("s", { type: "dot", rate: 30, spread: 1 })]);
    const root = ctx.random.snapshot();
    const fork = vi.spyOn(ctx.random, "fork");
    steps(30);
    expect(fork.mock.calls).toEqual([["spawner:s"]]);
    expect(ctx.random.snapshot()).toEqual(root);
    rt.destroy();
  });

  it("spawns nothing and draws no random number while active is false, until a block update starts it", () => {
    const block = { type: "dot", rate: 30, spread: 2, burst: 2, active: false };
    const { ctx, steps, spawned, system, rt } = setup([spawner("s", block)]);
    const root = ctx.random.snapshot();
    const fork = vi.spyOn(ctx.random, "fork");
    steps(120);
    expect(spawned).toEqual([]);
    expect(system.live("s")).toEqual([]);
    expect(fork).not.toHaveBeenCalled();
    expect(ctx.random.snapshot()).toEqual(root);
    expect(rt.update([spawner("s", { ...block, active: true })])).toEqual({ ok: true });
    steps(1);
    // The held burst, then accrual from the update on.
    expect(spawned).toHaveLength(2);
    expect(fork).toHaveBeenCalledTimes(1);
    rt.destroy();
  });

  it("spawns its burst on attach, within the cap", () => {
    const { steps, spawned, system, rt, ctx } = setup([
      spawner("a", { type: "dot", rate: 0, burst: 4 }),
      spawner("b", { type: "dot", rate: 0, burst: 9, cap: 3 }),
    ]);
    steps(1);
    expect(system.live("a")).toHaveLength(4);
    expect(system.live("b")).toHaveLength(3);
    steps(30);
    expect(spawned).toHaveLength(7);
    const late = ctx.spawn({
      type: "dot",
      at: [0, 0],
      behaviors: { spawner: { type: "dot", rate: 0, burst: 2 } },
    });
    steps(1);
    expect(system.live(late.id)).toHaveLength(2);
    rt.destroy();
  });

  it("counts a prefab instance as one spawn, by its id, until its last child goes", () => {
    const { ctx, steps, spawned, system, rt } = setup([
      spawner("s", { prefab: "pair", rate: 60, cap: 1 }),
    ]);
    steps(2);
    expect(spawned).toHaveLength(1);
    const id = spawned[0]!.other!;
    expect(system.live("s")).toEqual([id]);
    expect(ctx.get(`${id}/left`)).toMatchObject({ at: [5, 5] });
    expect(ctx.get(`${id}/right`)).toMatchObject({ at: [6, 5] });
    ctx.destroy(`${id}/left`);
    steps(3);
    expect(system.live("s")).toEqual([id]);
    ctx.destroy(`${id}/right`);
    steps(1);
    expect(spawned).toHaveLength(2);
    expect(system.live("s")).toEqual([spawned[1]!.other]);
    rt.destroy();
  });

  it("gives a prefab instance its lifeMs as a whole, ending on the tick a type's lifetime does", () => {
    const { ctx, steps, system, rt } = setup([
      spawner("s", { prefab: "pair", rate: 60, cap: 1, lifeMs: 100 }),
      spawner("t", { type: "dot", rate: 60, cap: 1, lifeMs: 100 }),
    ]);
    steps(1);
    const [id] = system.live("s");
    const [dot] = system.live("t");
    // Spawned in tick 0; 100 ms is 6 ticks, so both go at the end of tick 6.
    steps(5);
    expect([ctx.exists(id!), ctx.exists(dot!)]).toEqual([true, true]);
    steps(1);
    expect([ctx.exists(id!), ctx.exists(dot!)]).toEqual([false, false]);
    expect(ctx.exists(`${id}/left`)).toBe(false);
    rt.destroy();
  });

  it("surfaces prefab-not-spawnable for a prefab the run can't place", () => {
    const { rt } = setup([spawner("s", { prefab: "missing", rate: 60 })]);
    let caught: unknown;
    try {
      for (let i = 0; i < 3; i++) rt.step(rt.ctx.time.tickMs, []);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(EngineError);
    expect((caught as EngineError).code).toBe("prefab-not-spawnable");
    rt.destroy();
  });

  it("sets a dynamic spawn's velocity through ctx.bodies, turned with the spawner", () => {
    const { ctx, steps, spawned, rt } = setup([
      spawner("s", { type: "ball", rate: 60, cap: 10, velocity: [2, 0] }),
      spawner("t", { type: "dot", rate: 60, cap: 10, velocity: [2, 0] }),
    ]);
    steps(2);
    const ball = spawned.find((e) => e.entityId === "s")!.other!;
    expect(ctx.bodies.velocity(ball)).toEqual({ x: 2, y: 0 });
    const dot = spawned.find((e) => e.entityId === "t")!.other!;
    expect(ctx.bodies.has(dot)).toBe(false);
    ctx.poses.set("s", 5, 5, Math.PI / 2);
    steps(1);
    const turned = ctx.bodies.velocity(spawned.filter((e) => e.entityId === "s").at(-1)!.other!);
    expect(turned.x).toBeCloseTo(0, 12);
    expect(turned.y).toBeCloseTo(2, 12);
    rt.destroy();
  });

  it("resets to t = 0: what it owes is dropped and the burst comes again, within the cap", () => {
    // 24 a second is 0.4 a tick at 60 Hz: the burst on tick 0, one more on ticks 2 and 4, then the cap.
    const block = { type: "dot", rate: 24, cap: 4, burst: 2 };
    const perTick = (s: ReturnType<typeof setup>, ticks: number) => {
      const counts: number[] = [];
      for (let i = 0; i < ticks; i++) {
        const before = s.spawned.length;
        s.steps(1);
        counts.push(s.spawned.length - before);
      }
      return counts;
    };
    const fresh = setup([spawner("s", block)]);
    const expected = perTick(fresh, 20);
    expect(expected.slice(0, 5)).toEqual([2, 0, 1, 0, 1]);
    fresh.rt.destroy();

    const run = setup([spawner("s", block)]);
    run.steps(4);
    expect(run.system.save!("s")).toMatchObject({ owed: expect.closeTo(0.6, 9) });
    for (const id of run.system.live("s")) run.ctx.destroy(id);
    run.system.reset!();
    expect(run.system.save!("s")).toMatchObject({ owed: 0, burst: true });
    expect(perTick(run, 20)).toEqual(expected);
    expect(run.system.live("s")).toHaveLength(4);
    run.rt.destroy();

    // Three live when it resets: the burst is cut to the one free slot, then the cap holds.
    const held = setup([spawner("s", block)]);
    held.steps(4);
    expect(held.system.live("s")).toHaveLength(3);
    held.system.reset!();
    expect(perTick(held, 30)).toEqual([1, ...Array<number>(29).fill(0)]);
    expect(held.system.live("s")).toHaveLength(4);
    held.rt.destroy();
  });

  it("runs a seek before tick 0 as stepping would, keeping only what is still alive", () => {
    const plain = setup([spawner("s", { type: "dot", rate: 30, cap: 1000, burst: 2 })], {
      timeOffsetMs: 1000,
    });
    expect(plain.system.live("s")).toHaveLength(32);
    plain.steps(2);
    expect(plain.spawned).toHaveLength(1);
    plain.rt.destroy();

    // 500 ms is 30 ticks: of the 30 spawned over the 60 ticks sought, those of the last 30 remain.
    const timed = setup([spawner("s", { type: "dot", rate: 30, cap: 1000, lifeMs: 500 })], {
      timeOffsetMs: 1000,
    });
    const live = timed.system.live("s");
    expect(live.length).toBeGreaterThanOrEqual(14);
    expect(live.length).toBeLessThanOrEqual(16);
    expect(timed.spawned).toEqual([]);
    timed.rt.destroy();
  });
});

describe("a world save of spawners", () => {
  const entities = () => [
    spawner("types", { type: "dot", rate: 20, cap: 6, burst: 2, spread: 2, lifeMs: 400 }),
    spawner("prefabs", { prefab: "pair", rate: 7, cap: 3, spread: 1.5, lifeMs: 700 }, [-5, 2]),
    spawner("held", { type: "dot", rate: 10, burst: 3, active: false }, [0, -4]),
  ];

  function frame(rt: SceneRuntimeHandle, events: readonly StepEvent[]): unknown {
    const poses = [...rt.ctx.poses.ids()].sort().map((id) => {
      const p = rt.ctx.poses.get(id)!;
      return [id, p.x, p.y];
    });
    return [rt.ctx.tick, events, poses];
  }

  function run(rt: SceneRuntimeHandle, ticks: number): string {
    const frames: unknown[] = [];
    for (let i = 0; i < ticks; i++) frames.push(frame(rt, rt.step(rt.ctx.time.tickMs, []).events));
    return hashText(JSON.stringify(frames));
  }

  it("reaches the same digest from a mid-run save on the geometry backend", () => {
    const game = spawnGame();
    const registry = createRegistry(game);
    const open = (fromSave?: Parameters<typeof createHeadlessRuntime>[0]["fromSave"]) =>
      createHeadlessRuntime({
        game,
        registry,
        prefabs: PREFABS,
        scene: scene(entities()),
        ...(fromSave ? { fromSave } : {}),
      });

    const whole = open();
    run(whole, 45);
    expect(worldSaveBlockers(whole)).toEqual([]);
    const saved = whole.save({ depth: "world", slot: "mid", now: 0 });
    if (!saved.ok) throw new Error(saved.issue.message);
    const systems = saved.file.world!.systems;
    expect(systems.types?.spawner).toMatchObject({
      live: whole.ctx.behavior<SpawnerSystem>("spawner")!.live("types"),
    });
    expect(systems.held?.spawner).toEqual({ owed: 0, live: [], burst: true });
    expect(systems.prefabs?.spawner).toHaveProperty("left");
    expect(systems["@random"]).toHaveProperty("spawner:types");
    const after = run(whole, 200);

    const resumed = open(saved.file);
    expect(resumed.ctx.tick).toBe(45);
    expect(run(resumed, 200)).toBe(after);
    expect(resumed.stats().behaviors).toEqual(whole.stats().behaviors);
    whole.destroy();
    resumed.destroy();
  });
});
