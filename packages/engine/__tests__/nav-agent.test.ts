import { describe, expect, it } from "vite-plus/test";

import type { BehaviorBlock } from "../game/behaviors";
import type { NavAgentSystem } from "../game/behaviors/nav-agent";
import { createRegistry, defineGame } from "../game/define";
import type { GameDefinition } from "../game/types";
import { createHeadlessRuntime } from "../headless/headless";
import { ENGINE_BEHAVIOR_SYSTEMS } from "../runtime/behaviors/index";
import { createNavAgentSystem } from "../runtime/behaviors/nav-agent";
import { createSceneRuntime } from "../runtime/runtime";
import { worldSaveBlockers } from "../runtime/save-state";
import type { SceneRuntimeHandle, StepEvent } from "../runtime/types";
import { hashText } from "../scene/hash";
import type { ExpandedScene, RuntimeEntity, SceneDefinition } from "../scene/types";
import { validateScene } from "../scene/validate";
import { seedFromString } from "../sim-kit/rng";

const ARRIVED = "nav:arrived";
const BLOCKED = "nav:blocked";

function navGame(): GameDefinition {
  return defineGame({
    id: "navagents",
    types: [],
    actions: [],
    time: { kind: "fixed", rate: 60 },
    createRuntime: () => ({ snapshot: () => null, restore: () => {} }),
  });
}

const box = (x0: number, y0: number, x1: number, y1: number) => ({
  type: "poly" as const,
  pts: [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ] as [number, number][],
});

/** A 12 × 10 m room with a 4 m square hole in its middle. */
const ROOM: RuntimeEntity[] = [
  { id: "floor", type: "nav", shape: box(0, 0, 12, 10) },
  { id: "pillar", type: "nav", mode: "block", shape: box(4, 3, 8, 7) },
];

const agent = (
  id: string,
  at: [number, number],
  block: BehaviorBlock = {},
  extra: BehaviorBlock = {},
): RuntimeEntity => ({ id, type: "marker", at, behaviors: { "nav-agent": block, ...extra } });

function scene(entities: RuntimeEntity[]): ExpandedScene {
  return {
    name: "nav-agents",
    bounds: [-20, -20, 40, 40],
    settings: { gravity: [0, 0], physics: "none", grid: null, view: { projection: "orthogonal" } },
    entities,
  };
}

type Run = {
  rt: SceneRuntimeHandle;
  nav: NavAgentSystem;
  events: StepEvent[];
  steps: (n: number, each?: () => void) => void;
  at: (id: string) => { x: number; y: number };
};

function setup(entities: RuntimeEntity[]): Run {
  const rt = createSceneRuntime({ rapier: undefined, view: null, game: navGame() });
  expect(rt.load(scene(entities))).toMatchObject({ ok: true });
  const events: StepEvent[] = [];
  const steps = (n: number, each?: () => void) => {
    for (let i = 0; i < n; i++) {
      for (const e of rt.step(rt.ctx.time.tickMs, []).events)
        if (e.type.startsWith("nav:")) events.push(e);
      each?.();
    }
  };
  const at = (id: string) => {
    const p = rt.ctx.poses.get(id)!;
    return { x: p.x, y: p.y };
  };
  return { rt, nav: rt.ctx.behavior<NavAgentSystem>("nav-agent")!, events, steps, at };
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);

const insidePillar = (p: { x: number; y: number }) => p.x > 4 && p.x < 8 && p.y > 3 && p.y < 7;

describe("the nav-agent behavior", () => {
  it("maps its system", () => {
    expect(ENGINE_BEHAVIOR_SYSTEMS["nav-agent"]).toBe(createNavAgentSystem);
  });

  it("reaches a point around a hole, by pose, and raises nav:arrived once", () => {
    const { rt, nav, events, steps, at } = setup([...ROOM, agent("a", [1, 5])]);
    nav.setDestination("a", { x: 11, y: 5 });
    const route = nav.path("a")!;
    expect(route.length).toBeGreaterThan(1);
    expect(route.at(-1)).toEqual({ x: 11, y: 5 });
    let entered = false;
    steps(900, () => {
      if (insidePillar(at("a"))) entered = true;
    });
    expect(entered).toBe(false);
    expect(events).toEqual([expect.objectContaining({ type: ARRIVED, entityId: "a" })]);
    expect(dist(at("a"), { x: 11, y: 5 })).toBeLessThanOrEqual(0.12);
    expect(nav.path("a")).toBeNull();
    rt.destroy();
  });

  it("walks through a motion body when the entity has a collider", () => {
    const { rt, nav, events, steps, at } = setup([
      ...ROOM,
      agent("a", [1, 5], {}, { collider: { shape: ["circle", 0, 0, 0.2] } }),
    ]);
    expect(rt.ctx.bodies.kind("a")).toBe("kinematic");
    nav.setDestination("a", { x: 11, y: 5 });
    steps(60);
    expect(rt.ctx.bodies.velocity("a").x).toBeGreaterThan(0);
    steps(840);
    expect(events.map((e) => e.type)).toEqual([ARRIVED]);
    expect(dist(at("a"), { x: 11, y: 5 })).toBeLessThanOrEqual(0.12);
    rt.destroy();
  });

  it("gives an unmoved entity's collider body back to ctx.bodies when the behavior goes", () => {
    const collider = { collider: { shape: ["circle", 0, 0, 0.2] }, body: { kind: "kinematic" } };
    const { rt } = setup([...ROOM, agent("a", [1, 5], {}, collider)]);
    const kept: RuntimeEntity = { id: "a", type: "marker", at: [1, 5], behaviors: collider };
    expect(rt.update([...ROOM, kept])).toEqual({ ok: true });
    expect(rt.ctx.bodies.has("a")).toBe(true);
    expect(rt.ctx.bodies.kind("a")).toBe("kinematic");
    rt.ctx.bodies.setVelocity("a", { x: 1, y: 0 });
    rt.step(rt.ctx.time.tickMs, []);
    expect(rt.ctx.poses.get("a")!.x).toBeCloseTo(1 + 1 / 60, 6);
    rt.destroy();
  });

  it("follows a sibling inside its instance by the name the prefab gave it", () => {
    const { rt, events, steps } = setup([
      ...ROOM,
      agent("i/a", [1, 5], { to: "drop" }),
      { id: "i/drop", type: "marker", at: [11, 5] },
    ]);
    steps(900);
    expect(events).toEqual([expect.objectContaining({ type: ARRIVED, entityId: "i/a" })]);
    rt.destroy();
  });

  it("follows a moving entity, planning again as it moves, and arrives beside it", () => {
    const { rt, nav, events, steps, at } = setup([
      { id: "floor", type: "nav", shape: box(0, 0, 30, 10) },
      agent("lead", [6, 5], { speed: 0.6 }),
      agent("tail", [1, 1], { speed: 1.5, repathTicks: 20 }),
    ]);
    nav.setDestination("lead", { x: 28, y: 5 });
    nav.setDestination("tail", "lead");
    const first = nav.path("tail")!.at(-1)!;
    steps(30);
    expect(nav.path("tail")!.at(-1)!.x).toBeGreaterThan(first.x);
    let gap = Infinity;
    steps(600, () => {
      if (gap === Infinity && events.some((e) => e.entityId === "tail"))
        gap = dist(at("tail"), at("lead"));
    });
    const arrived = events.find((e) => e.entityId === "tail");
    expect(arrived).toMatchObject({ type: ARRIVED, other: "lead" });
    expect(arrived!.at.x).toBeGreaterThan(8);
    expect(events.filter((e) => e.entityId === "tail")).toHaveLength(1);
    expect(gap).toBeLessThan(0.5);
    rt.destroy();
  });

  it("raises nav:blocked for a point it can't reach, and when the entity it follows is gone", () => {
    const { rt, nav, events, steps } = setup([
      ...ROOM,
      agent("a", [1, 5]),
      agent("b", [1, 1]),
      agent("c", [11, 9]),
    ]);
    nav.setDestination("a", { x: 6, y: 5 });
    expect(nav.path("a")).toBeNull();
    nav.setDestination("b", "c");
    steps(2);
    rt.ctx.destroy("c");
    steps(2);
    expect(events).toEqual([
      expect.objectContaining({ type: BLOCKED, entityId: "a", data: { reason: "no-path" } }),
      expect.objectContaining({
        type: BLOCKED,
        entityId: "b",
        other: "c",
        data: { reason: "gone" },
      }),
    ]);
    rt.destroy();
  });

  it("raises nav:blocked when a solid in its way stops its progress for repathTicks", () => {
    const { rt, nav, events, steps } = setup([
      { id: "floor", type: "nav", shape: box(0, 0, 12, 4) },
      {
        id: "wall",
        type: "marker",
        at: [6, 2],
        behaviors: { collider: { shape: ["box", 0, 0, 0.25, 2.5] } },
      },
      agent("a", [1, 2], { repathTicks: 30 }, { collider: { shape: ["circle", 0, 0, 0.2] } }),
    ]);
    nav.setDestination("a", { x: 11, y: 2 });
    steps(600);
    expect(events).toEqual([
      expect.objectContaining({ type: BLOCKED, entityId: "a", data: { reason: "stuck" } }),
    ]);
    expect(rt.ctx.poses.get("a")!.x).toBeLessThan(6);
    rt.destroy();
  });

  it("passes another agent met head-on, kept apart by separation", () => {
    const { rt, nav, events, steps, at } = setup([
      { id: "floor", type: "nav", shape: box(0, 0, 12, 4) },
      agent("a", [1, 2]),
      agent("b", [11, 2]),
    ]);
    nav.setDestination("a", { x: 11, y: 2 });
    nav.setDestination("b", { x: 1, y: 2 });
    let closest = Infinity;
    steps(900, () => {
      closest = Math.min(closest, dist(at("a"), at("b")));
    });
    expect(events.map((e) => `${e.type} ${e.entityId}`).sort((x, y) => x.localeCompare(y))).toEqual(
      [`${ARRIVED} a`, `${ARRIVED} b`],
    );
    expect(closest).toBeGreaterThan(0.15);
    rt.destroy();
  });

  it("stops without an event", () => {
    const { rt, nav, events, steps, at } = setup([...ROOM, agent("a", [1, 5])]);
    nav.setDestination("a", { x: 11, y: 5 });
    steps(30);
    nav.stop("a");
    const there = at("a");
    steps(120);
    expect(at("a")).toEqual(there);
    expect(events).toEqual([]);
    expect(nav.path("a")).toBeNull();
    rt.destroy();
  });

  it("walks to the scene's own `to`, a point or an entity, and raises nav:arrived", () => {
    const { rt, events, steps, at } = setup([
      ...ROOM,
      agent("a", [1, 5], { to: [11, 5] }),
      agent("b", [1, 1], { to: "post" }),
      { id: "post", type: "marker", at: [11, 9] },
    ]);
    steps(900);
    expect(events.map((e) => `${e.type} ${e.entityId}`).sort((x, y) => x.localeCompare(y))).toEqual(
      [`${ARRIVED} a`, `${ARRIVED} b`],
    );
    expect(dist(at("a"), { x: 11, y: 5 })).toBeLessThanOrEqual(0.12);
    rt.destroy();
  });

  it("doesn't walk to its `to` again after a restore taken once it arrived", () => {
    const game = navGame();
    const registry = createRegistry(game);
    const entities = [...ROOM, agent("a", [9, 5], { to: [11, 5] })];
    const open = (fromSave?: Parameters<typeof createHeadlessRuntime>[0]["fromSave"]) =>
      createHeadlessRuntime({
        game,
        registry,
        scene: scene(entities),
        ...(fromSave ? { fromSave } : {}),
      });
    const whole = open();
    for (let i = 0; i < 300; i++) whole.step(whole.ctx.time.tickMs, []);
    const saved = whole.save({ depth: "world", slot: "done", now: 0 });
    if (!saved.ok) throw new Error(saved.issue.message);
    const resumed = open(saved.file);
    const types: string[] = [];
    for (let i = 0; i < 300; i++)
      for (const e of resumed.step(resumed.ctx.time.tickMs, []).events) types.push(e.type);
    expect(types).not.toContain(ARRIVED);
    whole.destroy();
    resumed.destroy();
  });

  it("keeps a game-set target naming its entity across a restore, though a sibling shares the name", () => {
    const game = navGame();
    const registry = createRegistry(game);
    const entities: RuntimeEntity[] = [
      ...ROOM,
      agent("pack/agent", [1, 5], { repathTicks: 20 }),
      { id: "hero", type: "marker", at: [11, 9] },
      { id: "pack/hero", type: "marker", at: [11, 1] },
    ];
    const open = (fromSave?: Parameters<typeof createHeadlessRuntime>[0]["fromSave"]) =>
      createHeadlessRuntime({
        game,
        registry,
        scene: scene(entities),
        ...(fromSave ? { fromSave } : {}),
      });
    const arrivals = (rt: SceneRuntimeHandle) => {
      const out: string[] = [];
      for (let i = 0; i < 900; i++)
        for (const e of rt.step(rt.ctx.time.tickMs, []).events)
          if (e.type === ARRIVED) out.push(`${rt.ctx.tick} ${e.other}`);
      return out;
    };
    const whole = open();
    whole.ctx.behavior<NavAgentSystem>("nav-agent")!.setDestination("pack/agent", "hero");
    for (let i = 0; i < 30; i++) whole.step(whole.ctx.time.tickMs, []);
    const saved = whole.save({ depth: "world", slot: "mid", now: 0 });
    if (!saved.ok) throw new Error(saved.issue.message);
    expect(saved.file.world!.systems["pack/agent"]?.["nav-agent"]).not.toHaveProperty("scope");
    const after = arrivals(whole);
    expect(after).toEqual([expect.stringMatching(/ hero$/)]);
    const resumed = open(saved.file);
    expect(arrivals(resumed)).toEqual(after);
    whole.destroy();
    resumed.destroy();
  });

  it("resolves a block target saved before its first tick against its instance after the restore", () => {
    const game = navGame();
    const registry = createRegistry(game);
    const entities: RuntimeEntity[] = [
      ...ROOM,
      agent("pack/agent", [1, 5], { to: "hero" }),
      { id: "hero", type: "marker", at: [11, 9] },
      { id: "pack/hero", type: "marker", at: [11, 1] },
    ];
    const open = (fromSave?: Parameters<typeof createHeadlessRuntime>[0]["fromSave"]) =>
      createHeadlessRuntime({
        game,
        registry,
        scene: scene(entities),
        ...(fromSave ? { fromSave } : {}),
      });
    const whole = open();
    const saved = whole.save({ depth: "world", slot: "start", now: 0 });
    if (!saved.ok) throw new Error(saved.issue.message);
    expect(saved.file.world!.systems["pack/agent"]?.["nav-agent"]).toMatchObject({
      target: "hero",
      scope: true,
    });
    const resumed = open(saved.file);
    const others: string[] = [];
    for (let i = 0; i < 900; i++)
      for (const e of resumed.step(resumed.ctx.time.tickMs, []).events)
        if (e.type === ARRIVED) others.push(String(e.other));
    expect(others).toEqual(["pack/hero"]);
    whole.destroy();
    resumed.destroy();
  });

  it("staggers the repaths of agents following their block's target by entity id", () => {
    const repathTicks = 30;
    const ids = ["f0", "f1", "f2", "f3", "f4", "f5"];
    const game = navGame();
    const rt = createHeadlessRuntime({
      game,
      registry: createRegistry(game),
      scene: scene([
        { id: "floor", type: "nav", shape: box(0, 0, 40, 10) },
        agent("lead", [30, 5], { speed: 0.5 }),
        ...ids.map((id, i) => agent(id, [1, 1 + i], { to: "lead", repathTicks, speed: 0.5 })),
      ]),
    });
    rt.step(rt.ctx.time.tickMs, []);
    const saved = rt.save({ depth: "world", slot: "one", now: 0 });
    if (!saved.ok) throw new Error(saved.issue.message);
    const due = ids.map((id) => {
      const state = saved.file.world!.systems[id]?.["nav-agent"] as { repathIn?: number };
      expect(state.repathIn).toBe(repathTicks - (seedFromString(id) % repathTicks));
      return state.repathIn;
    });
    expect(new Set(due).size).toBeGreaterThan(1);
    rt.destroy();
  });

  it("refuses a destination for an entity without the behavior", () => {
    const { rt, nav } = setup([...ROOM, agent("a", [1, 5])]);
    expect(() => nav.setDestination("floor", { x: 1, y: 1 })).toThrow(/no nav-agent/);
    rt.destroy();
  });
});

describe("a crowd of nav agents", () => {
  const crowd = (): RuntimeEntity[] => {
    const out: RuntimeEntity[] = [...ROOM];
    for (let i = 0; i < 12; i++) {
      const extra = i % 3 === 0 ? { collider: { shape: ["circle", 0, 0, 0.15] } } : {};
      out.push(agent(`w${i}`, [0.5 + (i % 4) * 0.4, 1 + Math.floor(i / 4) * 0.4], {}, extra));
    }
    out.push(agent("chaser", [11, 9], { speed: 1.4, repathTicks: 25 }));
    return out;
  };

  function aim(rt: SceneRuntimeHandle): void {
    const nav = rt.ctx.behavior<NavAgentSystem>("nav-agent")!;
    for (let i = 0; i < 12; i++) nav.setDestination(`w${i}`, { x: 11 - (i % 4) * 0.4, y: 8.5 });
    nav.setDestination("chaser", "w0");
  }

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

  it("replays to the same digest", () => {
    const digests = [0, 1].map(() => {
      const rt = createSceneRuntime({ rapier: undefined, view: null, game: navGame() });
      expect(rt.load(scene(crowd()))).toMatchObject({ ok: true });
      aim(rt);
      const digest = run(rt, 400);
      rt.destroy();
      return digest;
    });
    expect(digests[1]).toBe(digests[0]);
  });

  it("saves and restores mid-walk on the geometry backend, reaching the same digest", () => {
    const game = navGame();
    const registry = createRegistry(game);
    const open = (fromSave?: Parameters<typeof createHeadlessRuntime>[0]["fromSave"]) =>
      createHeadlessRuntime({
        game,
        registry,
        scene: scene(crowd()),
        ...(fromSave ? { fromSave } : {}),
      });

    const whole = open();
    aim(whole);
    run(whole, 70);
    expect(worldSaveBlockers(whole)).toEqual([]);
    const saved = whole.save({ depth: "world", slot: "mid", now: 0 });
    if (!saved.ok) throw new Error(saved.issue.message);
    const systems = saved.file.world!.systems;
    expect(systems.w1?.["nav-agent"]).toMatchObject({ to: [10.6, 8.5], next: expect.any(Number) });
    expect(systems.chaser?.["nav-agent"]).toMatchObject({
      target: "w0",
      repathIn: expect.any(Number),
    });
    const route = whole.ctx.behavior<NavAgentSystem>("nav-agent")!.path("w1");
    expect(route).not.toBeNull();
    const after = run(whole, 400);

    const resumed = open(saved.file);
    expect(resumed.ctx.tick).toBe(70);
    expect(resumed.ctx.behavior<NavAgentSystem>("nav-agent")!.path("w1")).toEqual(route);
    expect(run(resumed, 400)).toBe(after);
    whole.destroy();
    resumed.destroy();
  });
});

describe("nav-agent validation", () => {
  const def = (entities: SceneDefinition["entities"]): SceneDefinition => ({
    v: 4,
    game: "navagents",
    name: "nav",
    bounds: [0, 0, 20, 20],
    settings: { physics: "none", gravity: [0, 0] },
    entities,
  });
  const registry = createRegistry(navGame());

  it("is nav-missing in a scene with no walk area", () => {
    const issues = validateScene(
      def([{ id: "a", type: "marker", at: [1, 1], behaviors: { "nav-agent": {} } }]),
      registry,
    ).filter((i) => i.code === "nav-missing");
    expect(issues).toEqual([
      expect.objectContaining({ entityIds: ["a"], path: "/entities/0/behaviors/nav-agent" }),
    ]);
  });

  it("is fine with a walk area", () => {
    const issues = validateScene(
      def([
        { id: "floor", type: "nav", shape: ["poly", 0, 0, 10, 0, 10, 10, 0, 10] },
        { id: "a", type: "marker", at: [1, 1], behaviors: { "nav-agent": {} } },
      ]),
      registry,
    );
    expect(issues.filter((i) => i.code === "nav-missing")).toEqual([]);
  });
});
