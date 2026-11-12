/* oxlint-disable unicorn/no-thenable -- `then` is a lifetime block field */
import { describe, expect, it } from "vite-plus/test";

import type { BehaviorBlock } from "../game/behaviors";
import { LIFETIME } from "../game/behaviors/lifetime";
import { defineEntityType, defineGame, ENGINE_BEHAVIORS } from "../game/define";
import { createRegistry } from "../game/define";
import { pointField } from "../game/fields";
import { ticksFor } from "../game/time";
import type { GameDefinition, SceneSystem } from "../game/types";
import { createHeadlessRuntime } from "../headless/headless";
import { ENGINE_BEHAVIOR_SYSTEMS } from "../runtime/behaviors/index";
import { createLifetimeSystem } from "../runtime/behaviors/lifetime";
import { createSceneRuntime } from "../runtime/runtime";
import { worldSaveBlockers } from "../runtime/save-state";
import {
  ENTITY_DESTROYED,
  ENTITY_DISABLED,
  ENTITY_ENABLED,
  type StepEvent,
} from "../runtime/types";
import type { ExpandedScene, RuntimeEntity } from "../scene/types";

const RATES = [30, 60] as const;

function lifetimeGame(rate: number): GameDefinition {
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
  return defineGame({
    id: "lifetime",
    types: [dot],
    actions: [],
    time: { kind: "fixed", rate },
    createRuntime: () => ({ snapshot: () => null, restore: () => {} }),
  });
}

const dot = (id: string, lifetime?: BehaviorBlock): RuntimeEntity => ({
  id,
  type: "dot",
  at: [5, 7],
  ...(lifetime ? { behaviors: { lifetime } } : {}),
});

function scene(entities: RuntimeEntity[]): ExpandedScene {
  return {
    name: "lifetime",
    bounds: [-100, -100, 100, 100],
    settings: { gravity: [0, 0], physics: "none", grid: null, view: { projection: "orthogonal" } },
    entities,
  };
}

const LIFECYCLE = new Set([ENTITY_DESTROYED, ENTITY_DISABLED, ENTITY_ENABLED]);

function setup(entities: RuntimeEntity[], opts: { rate?: number; timeOffsetMs?: number } = {}) {
  const rt = createSceneRuntime({
    rapier: undefined,
    view: null,
    game: lifetimeGame(opts.rate ?? 60),
  });
  const play = opts.timeOffsetMs === undefined ? undefined : { timeOffsetMs: opts.timeOffsetMs };
  expect(rt.load(scene(entities), play)).toMatchObject({ ok: true });
  const events: (readonly [number, string, string | undefined])[] = [];
  const steps = (n: number) => {
    for (let i = 0; i < n; i++) {
      const r = rt.step(rt.ctx.time.tickMs, []);
      for (const e of r.events as StepEvent[]) {
        if (LIFECYCLE.has(e.type)) events.push([r.tick, e.type, e.entityId]);
      }
    }
  };
  return { rt, ctx: rt.ctx, steps, events };
}

describe("the lifetime behavior", () => {
  it("is the engine's third behavior, with its system mapped", () => {
    expect(ENGINE_BEHAVIORS.map((b) => b.name)).toEqual(["sprite", "occupant", "lifetime"]);
    expect(ENGINE_BEHAVIORS[2]).toBe(LIFETIME);
    expect(LIFETIME.visualOnly).toBeUndefined();
    expect(ENGINE_BEHAVIOR_SYSTEMS.lifetime).toBe(createLifetimeSystem);
  });

  it("destroys the entity after its ticks, at the end of that tick", () => {
    const { ctx, steps, events, rt } = setup([dot("a", { ticks: 3 }), dot("b")]);
    expect(rt.stats().behaviors).toEqual({ lifetime: 1 });
    steps(3);
    expect(ctx.exists("a")).toBe(true);
    steps(1);
    expect(ctx.exists("a")).toBe(false);
    expect(ctx.exists("b")).toBe(true);
    expect(events).toEqual([[3, ENTITY_DESTROYED, "a"]]);
    expect(rt.stats().behaviors).toEqual({});
    rt.destroy();
  });

  it("disables the entity after its ticks with then: disable, keeping it", () => {
    const { ctx, steps, events, rt } = setup([dot("a", { ticks: 2, then: "disable" })]);
    steps(5);
    expect(ctx.exists("a")).toBe(true);
    expect(ctx.enabled("a")).toBe(false);
    expect(events).toEqual([[2, ENTITY_DISABLED, "a"]]);
    rt.destroy();
  });

  for (const rate of RATES) {
    it(`counts ms in ticks at ${rate} Hz, for destroy and disable`, () => {
      const ticks = ticksFor(250, { rate });
      expect(ticks).toBe(Math.round(rate / 4));
      const { ctx, steps, events, rt } = setup(
        [dot("gone", { ms: 250 }), dot("off", { ms: 250, then: "disable" })],
        { rate },
      );
      steps(ticks);
      expect([ctx.exists("gone"), ctx.enabled("off")]).toEqual([true, true]);
      steps(1);
      expect(ctx.exists("gone")).toBe(false);
      expect([ctx.exists("off"), ctx.enabled("off")]).toEqual([true, false]);
      expect(events).toEqual([
        [ticks, ENTITY_DISABLED, "off"],
        [ticks, ENTITY_DESTROYED, "gone"],
      ]);
      rt.destroy();
    });

    it(`gives a spawned entity its lifetime from the spawn, at ${rate} Hz`, () => {
      const { ctx, steps, events, rt } = setup([dot("a")], { rate });
      steps(4);
      const id = ctx.spawn({ type: "dot", at: [0, 0], behaviors: { lifetime: { ms: 100 } } }).id;
      const ticks = ticksFor(100, { rate });
      steps(ticks);
      expect(ctx.exists(id)).toBe(true);
      steps(1);
      expect(ctx.exists(id)).toBe(false);
      expect(events).toEqual([[4 + ticks, ENTITY_DESTROYED, id]]);
      rt.destroy();
    });
  }

  it("pauses while disabled and starts afresh on each enable", () => {
    const { ctx, steps, events, rt } = setup([dot("a", { ticks: 4 })]);
    steps(3);
    ctx.setEnabled("a", false);
    steps(20);
    expect([ctx.exists("a"), ctx.enabled("a")]).toEqual([true, false]);
    ctx.setEnabled("a", true);
    // A fresh 4 ticks from tick 23, not the 1 left when it was disabled.
    steps(4);
    expect(ctx.exists("a")).toBe(true);
    steps(1);
    expect(ctx.exists("a")).toBe(false);
    expect(events).toEqual([[27, ENTITY_DESTROYED, "a"]]);
    rt.destroy();
  });

  it("runs again each time a disabled entity is enabled, as a pool reuses it", () => {
    const { ctx, steps, events, rt } = setup([dot("a", { ticks: 2, then: "disable" })]);
    steps(3);
    expect(ctx.enabled("a")).toBe(false);
    ctx.setEnabled("a", true);
    steps(3);
    expect(ctx.enabled("a")).toBe(false);
    expect(events).toEqual([
      [2, ENTITY_DISABLED, "a"],
      [5, ENTITY_DISABLED, "a"],
    ]);
    rt.destroy();
  });

  it("uses no timer, and forgets an entity destroyed first", () => {
    const { ctx, steps, events, rt } = setup([dot("a", { ticks: 10 })]);
    expect(ctx.timers.size).toBe(0);
    steps(2);
    ctx.destroy("a");
    steps(20);
    expect(events).toEqual([]);
    rt.destroy();
  });

  it("goes during a seek that passes its lifetime, before tick 0", () => {
    const { ctx, steps, events, rt } = setup([dot("a", { ms: 100 }), dot("b", { ms: 1000 })], {
      timeOffsetMs: 500,
    });
    expect(ctx.exists("a")).toBe(false);
    expect(ctx.exists("b")).toBe(true);
    // 1000 ms is 60 ticks; the seek ran 30 of them.
    steps(30);
    expect(ctx.exists("b")).toBe(true);
    steps(1);
    expect(ctx.exists("b")).toBe(false);
    expect(events).toEqual([[30, ENTITY_DESTROYED, "b"]]);
    rt.destroy();
  });

  it("schedules afresh at each load", () => {
    const { ctx, steps, rt } = setup([dot("a", { ticks: 3 })]);
    steps(2);
    expect(rt.load(scene([dot("a", { ticks: 3 })]))).toMatchObject({ ok: true });
    steps(3);
    expect(ctx.exists("a")).toBe(true);
    steps(1);
    expect(ctx.exists("a")).toBe(false);
    rt.destroy();
  });
});

describe("a world save of lifetimes", () => {
  type Seen = (readonly [number, string, string | undefined])[];
  const entities = () => [
    dot("long", { ticks: 12 }),
    dot("short", { ticks: 3, then: "disable" }),
    dot("timed", { ms: 150 }),
    dot("still"),
  ];

  function play(rt: ReturnType<typeof createHeadlessRuntime>, until: number, seen: Seen) {
    while (rt.ctx.tick < until) {
      const r = rt.step(rt.ctx.time.tickMs, []);
      for (const e of r.events as StepEvent[]) {
        if (LIFECYCLE.has(e.type)) seen.push([r.tick, e.type, e.entityId]);
      }
    }
  }

  it("holds each lifetime's ticks left, so a restored run expires on the same ticks", () => {
    const game = lifetimeGame(60);
    const registry = createRegistry(game);
    const open = (fromSave?: Parameters<typeof createHeadlessRuntime>[0]["fromSave"]) =>
      createHeadlessRuntime({
        game,
        registry,
        scene: scene(entities()),
        ...(fromSave ? { fromSave } : {}),
      });

    const whole = open();
    const wholeSeen: Seen = [];
    play(whole, 2, wholeSeen);
    const spawned = whole.ctx.spawn({
      type: "dot",
      at: [0, 0],
      behaviors: { lifetime: { ticks: 6 } },
    });
    play(whole, 5, wholeSeen);
    expect(worldSaveBlockers(whole)).toEqual([]);
    const saved = whole.save({ depth: "world", slot: "mid", now: 0 });
    if (!saved.ok) throw new Error(saved.issue.message);
    expect(saved.file.world?.systems).toMatchObject({
      long: { lifetime: { left: 7 } },
      [spawned.id]: { lifetime: { left: 3 } },
      timed: { lifetime: { left: 4 } },
    });
    expect(saved.file.world?.systems.short).toBeUndefined();
    const before = wholeSeen.length;
    play(whole, 20, wholeSeen);
    const after = wholeSeen.slice(before);
    expect(after).toEqual([
      [8, ENTITY_DESTROYED, spawned.id],
      [9, ENTITY_DESTROYED, "timed"],
      [12, ENTITY_DESTROYED, "long"],
    ]);

    const resumed = open(saved.file);
    expect(resumed.ctx.tick).toBe(5);
    expect(resumed.ctx.enabled("short")).toBe(false);
    const resumedSeen: Seen = [];
    play(resumed, 20, resumedSeen);
    expect(resumedSeen).toEqual(after);
    expect(resumed.stats().behaviors).toEqual(whole.stats().behaviors);
    whole.destroy();
    resumed.destroy();
  });

  it("starts a disabled entity's lifetime afresh when a restored run enables it", () => {
    const game = lifetimeGame(60);
    const registry = createRegistry(game);
    const rt = createHeadlessRuntime({ game, registry, scene: scene(entities()) });
    play(rt, 6, []);
    const saved = rt.save({ depth: "world", slot: "off", now: 0 });
    if (!saved.ok) throw new Error(saved.issue.message);
    rt.destroy();
    const resumed = createHeadlessRuntime({
      game,
      registry,
      scene: scene(entities()),
      fromSave: saved.file,
    });
    resumed.ctx.setEnabled("short", true);
    const seen: Seen = [];
    play(resumed, 12, seen);
    expect(seen.filter(([, type, id]) => id === "short" && type === ENTITY_DISABLED)).toEqual([
      [9, ENTITY_DISABLED, "short"],
    ]);
    resumed.destroy();
  });
});
