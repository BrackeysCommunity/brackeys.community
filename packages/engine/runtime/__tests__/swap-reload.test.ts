// @vitest-environment node
import { beforeAll, describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { createRegistry, defineGame } from "../../game/define";
import { pointField } from "../../game/fields";
import type { LibraryScene, SceneLibrary } from "../../game/flow";
import type { GameDefinition, GameRuntime, Registry, SceneSystem } from "../../game/types";
import { stableJson } from "../../project/canonical";
import { expandScene } from "../../scene/expand";
import { hashText } from "../../scene/hash";
import type {
  Bounds,
  EntityDef,
  ExpandedScene,
  Prefab,
  PrefabLibrary,
  Pt,
  RuntimeEntity,
  SceneDefinition,
} from "../../scene/types";
import type { RapierModule } from "../../types";
import { loadListed } from "../flow";
import { createSceneRuntime, saveHostOf } from "../runtime";
import { captureSave, restoreSave } from "../save-state";
import type { SceneRuntimeHandle, StepResult, SwapReport } from "../types";

let rapier: RapierModule;
beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

type Entities = EntityDef[];
type Walker = RuntimeEntity<{ at: Pt; speed: number }>;
type Latch = RuntimeEntity<{ at: Pt; label: string }>;
type Snap = { score: number; pulses: number };

/** What the game's hooks saw, in order. */
type Calls = { loads: number; restored: Snap[]; swaps: number };

/**
 * Walkers step right and save where they are; latches spawn but refuse
 * to change in place. The game spawns, destroys and switches off
 * entities, sets an emit timer, and scores from `ctx.random`.
 */
function reloadGame(
  physics: "none" | "rapier",
  calls: Calls = { loads: 0, restored: [], swaps: 0 },
): GameDefinition<Snap> {
  return defineGame<Snap>({
    id: "reload-yard",
    world: { physics },
    actions: [],
    persist: { initial: () => ({ runs: 0 }) },
    types: [
      {
        type: "walker",
        description: "A point that walks right.",
        fields: {
          at: pointField("Where it starts."),
          speed: z.number().default(1).describe("Metres a second."),
        },
        system: (ctx): SceneSystem<Walker> => {
          const strides = new Map<string, { x: number; y: number; steps: number }>();
          return {
            spawn(e) {
              strides.set(e.id, { x: e.at[0], y: e.at[1], steps: 0 });
              ctx.poses.set(e.id, e.at[0], e.at[1], 0, { snap: true });
            },
            despawn: (id) => void strides.delete(id),
            clear: () => strides.clear(),
            size: () => strides.size,
            beforeStep(dtMs) {
              for (const [id, s] of strides) {
                s.x += dtMs / 1000;
                s.steps++;
                ctx.poses.set(id, s.x, s.y, 0);
              }
            },
            save(id) {
              const s = strides.get(id);
              return s ? { ...s } : undefined;
            },
            restore(id, state) {
              const s = strides.get(id);
              if (s) Object.assign(s, state as typeof s);
            },
          };
        },
      },
      {
        type: "latch",
        description: "A marker that can't be changed in place; one labelled jam can't spawn.",
        fields: {
          at: pointField("Where it sits."),
          label: z.string().default("").describe("What it says."),
        },
        system: (ctx): SceneSystem<Latch> => {
          const ids = new Set<string>();
          return {
            spawn(e) {
              if (e.label === "jam") throw new Error("this latch is jammed");
              ids.add(e.id);
              ctx.poses.set(e.id, e.at[0], e.at[1], 0, { snap: true });
            },
            update() {
              throw new Error("a latch can't change in place");
            },
            despawn: (id) => void ids.delete(id),
            clear: () => ids.clear(),
            size: () => ids.size,
          };
        },
      },
    ],
    createRuntime(ctx): GameRuntime<Snap> {
      let score = 0;
      let pulses = 0;
      return {
        onLoad() {
          calls.loads++;
          score = 0;
          pulses = 0;
          ctx.timers.every(7, { emit: "pulse" });
        },
        beforeStep() {
          if (ctx.tick === 5) ctx.spawn({ type: "walker", at: [0, 3], speed: 2 });
          if (ctx.tick === 10) ctx.destroy("coin");
          if (ctx.tick === 12) ctx.setEnabled("lamp", false);
        },
        afterStep(_dt, events) {
          for (const e of events) if (e.type === "pulse") pulses++;
          score += ctx.random.below(10);
        },
        snapshot: () => ({ score, pulses }),
        restore(s) {
          calls.restored.push(structuredClone(s));
          score = s.score;
          pulses = s.pulses;
        },
        onSwap() {
          calls.swaps++;
        },
      };
    },
  });
}

const PREFABS: PrefabLibrary = new Map<string, Prefab>();

function yard(
  physics: "none" | "rapier" = "none",
  over: { bounds?: Bounds; gravity?: Pt; edit?: (entities: Entities) => void } = {},
): SceneDefinition {
  const entities: Entities = [
    { id: "w1", type: "walker", at: [1, 1] },
    { id: "w2", type: "walker", at: [2, 2] },
    { id: "coin", type: "marker", at: [3, 3] },
    { id: "lamp", type: "walker", at: [4, 4] },
    { id: "gate", type: "latch", at: [5, 5], label: "shut" },
  ];
  if (physics === "rapier")
    entities.push({ id: "floor", type: "solid", shape: ["box", 20, 9, 20, 1] });
  over.edit?.(entities);
  return {
    v: 4,
    name: "yard",
    game: "reload-yard",
    bounds: over.bounds ?? [0, 0, 40, 10],
    settings: { physics, gravity: over.gravity ?? [0, physics === "rapier" ? 9.8 : 0] },
    entities,
  };
}

const expand = (def: SceneDefinition, registry: Registry): ExpandedScene =>
  expandScene(def, registry, { prefabs: PREFABS });

function runtimeOf(game: GameDefinition<Snap>, scenes?: SceneLibrary) {
  const registry = createRegistry(game);
  const rt = createSceneRuntime({
    rapier,
    view: null,
    game,
    registry,
    prefabs: PREFABS,
    ...(scenes ? { scenes } : {}),
  });
  return { rt, registry };
}

function loaded(game: GameDefinition<Snap>, def: SceneDefinition) {
  const made = runtimeOf(game);
  expect(made.rt.load(expand(def, made.registry)).ok).toBe(true);
  return made;
}

const steps = (rt: SceneRuntimeHandle, n: number): StepResult[] =>
  Array.from({ length: n }, () => rt.step(rt.ctx.time.tickMs, []));

/** Every live entity's pose, flag and saved state, the game's state, the counters, timers and the random stream. */
function digest(rt: SceneRuntimeHandle): string {
  const world = saveHostOf(rt.ctx)!.captureWorld();
  const ids = [...rt.ctx.poses.ids()].sort();
  return stableJson({
    entities: ids.map((id) => {
      const p = rt.ctx.poses.get(id)!;
      return [id, rt.ctx.enabled(id), p.x, p.y, p.rot, world.systems[id] ?? null];
    }),
    game: rt.snapshot(),
    persist: rt.ctx.persist.value,
    counters: world.counters,
    random: world.random,
    tick: world.tick,
    timers: world.timers,
    destroyed: [...world.destroyed].sort(),
    spawned: world.spawned,
  });
}

/** Each tick's events, the game's snapshot and the digest, hashed. */
function run(rt: SceneRuntimeHandle, n: number): string {
  const frames = steps(rt, n).map((r) => [r.tick, r.events, r.game, digest(rt)]);
  return hashText(JSON.stringify(frames));
}

function swapped(report: SwapReport): Extract<SwapReport, { ok: true }> {
  if (!report.ok) throw new Error(report.issue.hint ?? report.issue.message);
  return report;
}

/** M18's guarantee on `next`: `old` run `ticks`, saved at world depth, restored onto a fresh runtime of `next`. */
function restoredOnto(
  game: GameDefinition<Snap>,
  old: SceneDefinition,
  next: SceneDefinition,
  ticks: number,
) {
  const a = loaded(game, old);
  a.rt.ctx.persist.set({ runs: 3 });
  steps(a.rt, ticks);
  const file = captureSave(a.rt, { depth: "world", slot: "guarantee", now: 0 });
  if (!file.ok) throw new Error(file.issue.message);
  a.rt.destroy();
  const b = loaded(game, next);
  const restored = restoreSave(b.rt, file.file);
  if (!restored.ok) throw new Error(restored.issue.message);
  return b.rt;
}

describe("SceneRuntime.swap reloads", () => {
  const wider = yard("none", { bounds: [0, 0, 60, 10] });

  it("a physics-free scene with changed bounds at world depth, equal to a save restored onto the new version", () => {
    const calls: Calls = { loads: 0, restored: [], swaps: 0 };
    const game = reloadGame("none", calls);
    const a = loaded(game, yard());
    a.rt.ctx.persist.set({ runs: 3 });
    steps(a.rt, 30);
    const tick = a.rt.ctx.tick;
    const saved = a.rt.snapshot();
    const report = swapped(a.rt.swap(expand(wider, a.registry), { prefabs: PREFABS }));
    expect(report).toMatchObject({ strategy: "reload", carried: "world" });
    expect(report.diff.header).toBe(true);
    expect(a.rt.ctx.bounds).toEqual([0, 0, 60, 10]);
    expect(a.rt.ctx.tick).toBe(tick);
    expect(a.rt.ctx.exists("coin")).toBe(false);
    expect(a.rt.ctx.enabled("lamp")).toBe(false);
    expect(a.rt.ctx.exists("walker#1")).toBe(true);
    expect(calls).toEqual({ loads: 2, restored: [saved], swaps: 0 });

    const b = restoredOnto(reloadGame("none"), yard(), wider, 30);
    expect(digest(a.rt)).toBe(digest(b));
    expect(run(a.rt, 300)).toBe(run(b, 300));
  });

  it("an asked-for reload with the header unchanged carries the world too", () => {
    const a = loaded(reloadGame("none"), yard());
    const b = loaded(reloadGame("none"), yard());
    steps(a.rt, 20);
    steps(b.rt, 20);
    const report = swapped(
      a.rt.swap(expand(yard(), a.registry), { prefabs: PREFABS, strategy: "reload" }),
    );
    expect(report).toMatchObject({ strategy: "reload", carried: "world" });
    expect(report.diff.header).toBe(false);
    expect(run(a.rt, 120)).toBe(run(b.rt, 120));
  });

  it("falls through to a reload when a reconcile step refuses", () => {
    const relabelled = yard("none", {
      edit: (es) => {
        const gate = es.find((e) => e.id === "gate")!;
        Object.assign(gate, { label: "open" });
      },
    });
    const game = reloadGame("none");
    const a = loaded(game, yard());
    a.rt.ctx.persist.set({ runs: 3 });
    steps(a.rt, 30);
    const report = swapped(a.rt.swap(expand(relabelled, a.registry), { prefabs: PREFABS }));
    expect(report).toMatchObject({ strategy: "reload", carried: "world" });
    expect(report.diff).toEqual({ added: [], removed: [], changed: ["gate"], header: false });
    expect((a.rt.ctx.get("gate") as Latch).label).toBe("open");

    const b = restoredOnto(reloadGame("none"), yard(), relabelled, 30);
    expect(digest(a.rt)).toBe(digest(b));
    expect(run(a.rt, 300)).toBe(run(b, 300));
  });

  it("undo after a world-depth reload brings back the captured world", () => {
    const a = loaded(reloadGame("none"), yard());
    const b = loaded(reloadGame("none"), yard());
    steps(a.rt, 30);
    steps(b.rt, 30);
    const scene = a.rt.scene();
    const report = swapped(a.rt.swap(expand(wider, a.registry), { prefabs: PREFABS }));
    steps(a.rt, 15);
    report.undo();
    expect(a.rt.ctx.bounds).toEqual([0, 0, 40, 10]);
    expect(a.rt.scene()).toEqual(scene);
    expect(digest(a.rt)).toBe(digest(b.rt));
    expect(run(a.rt, 120)).toBe(run(b.rt, 120));
    report.undo();
    expect(a.rt.ctx.tick).toBe(b.rt.ctx.tick);
  });

  it("a Rapier scene with changed gravity carries progress, and the game's restore gets its state", () => {
    const calls: Calls = { loads: 0, restored: [], swaps: 0 };
    const game = reloadGame("rapier", calls);
    const a = loaded(game, yard("rapier"));
    a.rt.ctx.persist.set({ runs: 3 });
    steps(a.rt, 30);
    const saved = a.rt.snapshot();
    const heavier = yard("rapier", { gravity: [0, 20] });
    const report = swapped(a.rt.swap(expand(heavier, a.registry), { prefabs: PREFABS }));
    expect(report).toMatchObject({ strategy: "reload", carried: "progress" });
    expect(report.diff.header).toBe(true);
    expect(calls).toEqual({ loads: 2, restored: [saved], swaps: 0 });
    expect(a.rt.snapshot()).toEqual(saved);
    expect(a.rt.ctx.persist.value).toEqual({ runs: 3 });
    expect(a.rt.ctx.gravity).toEqual({ x: 0, y: 20 });
    expect(a.rt.ctx.exists("coin")).toBe(true);
    expect(a.rt.ctx.exists("walker#1")).toBe(false);
    expect(a.rt.ctx.poses.get("w1")).toMatchObject({ x: 1, y: 1 });

    steps(a.rt, 10);
    report.undo();
    expect(a.rt.ctx.gravity).toEqual({ x: 0, y: 9.8 });
    expect(a.rt.snapshot()).toEqual(saved);
    expect(calls.restored).toEqual([saved, saved]);
  });

  it("a world capture goes back as progress onto a version that now runs on Rapier", () => {
    const game = reloadGame("none");
    const a = loaded(game, yard());
    steps(a.rt, 30);
    const saved = a.rt.snapshot();
    const report = swapped(a.rt.swap(expand(yard("rapier"), a.registry), { prefabs: PREFABS }));
    expect(report).toMatchObject({ strategy: "reload", carried: "progress" });
    expect(a.rt.ctx.settings.physics).toBe("rapier");
    expect(a.rt.snapshot()).toEqual(saved);
    report.undo();
    expect(a.rt.ctx.settings.physics).toBe("none");
    expect(a.rt.ctx.tick).toBe(30);
  });

  it("loads the new version under the main scene's flow identity", () => {
    const game = reloadGame("none");
    const listed = (def: SceneDefinition): LibraryScene => ({ def, prefabs: PREFABS });
    const scenes: SceneLibrary = {
      list: [{ scene: "hall" }],
      scenes: new Map([["hall", listed(yard())]]),
    };
    const { rt, registry } = runtimeOf(game, scenes);
    expect(loadListed(rt, "hall").ok).toBe(true);
    steps(rt, 12);
    swapped(rt.swap(expand(wider, registry), { prefabs: PREFABS }));
    expect(rt.ctx.flow.scene).toBe("hall");
    expect(rt.ctx.bounds).toEqual([0, 0, 60, 10]);
    const file = captureSave(rt, { depth: "progress", slot: "after", now: 0 });
    expect(file.ok && file.file.scene.id).toBe("hall");
  });

  it("refuses a reload whose fresh load fails and puts the old world back", () => {
    const a = loaded(reloadGame("none"), yard());
    const b = loaded(reloadGame("none"), yard());
    steps(a.rt, 30);
    steps(b.rt, 30);
    const jammed = yard("none", {
      bounds: [0, 0, 60, 10],
      edit: (es) => Object.assign(es.find((e) => e.id === "gate")!, { label: "jam" }),
    });
    const report = a.rt.swap(expand(jammed, a.registry), { prefabs: PREFABS });
    expect(report.ok).toBe(false);
    if (report.ok) return;
    expect(report.issue.code).toBe("live-swap-failed");
    expect(report.issue.detail).toMatchObject({
      phase: "swap",
      reason: "refused",
      entityId: "gate",
    });
    expect(report.issue.hint).toContain("this latch is jammed");
    expect(a.rt.ctx.bounds).toEqual([0, 0, 40, 10]);
    expect(digest(a.rt)).toBe(digest(b.rt));
    expect(run(a.rt, 60)).toBe(run(b.rt, 60));
  });
});
