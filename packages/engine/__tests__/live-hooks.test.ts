// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { createRegistry, defineGame } from "../game/define";
import { pointField } from "../game/fields";
import type { SceneSwap } from "../game/live";
import type { GameDefinition, GameRuntime, SceneSystem } from "../game/types";
import type { SceneVersion } from "../project/scene-version";
import { createLiveLayer, type LiveLayer } from "../runtime/live";
import { createSceneRuntime } from "../runtime/runtime";
import type { SceneRuntimeHandle } from "../runtime/types";
import { expandScene } from "../scene/expand";
import type { EntityDef, Pt, RuntimeEntity, SceneDefinition } from "../scene/types";
import type { GameEventMap, RapierModule } from "../types";
import { preparedOf, worldDigest } from "./fixtures/live-version";

type Walker = RuntimeEntity<{ at: Pt; speed: number }>;
type Stride = { x: number; steps: number; speed: number };

const V1 = "1".repeat(64);
const V2 = "2".repeat(64);

/** What the game's `onSwap` does in a test; reset by each `world()`. */
type Hook = (swap: SceneSwap, ctx: SceneRuntimeHandle["ctx"]) => void;

/** The game's hooks in a test: what `onSwap` and `onLoad` do, and `ctx.live.version` as each `onLoad` read it. */
type Hooks = {
  current: Hook | null;
  load?: (ctx: SceneRuntimeHandle["ctx"]) => void;
  loads: (string | null)[];
};

function liveGame(hook: Hooks, physics: "none" | "rapier" = "none"): GameDefinition {
  return defineGame({
    id: "live-yard",
    world: { physics },
    actions: [],
    live: { timings: ["next-load", "boundary", "now"] },
    types: [
      {
        type: "walker",
        description: "A point that walks right.",
        fields: {
          at: pointField("Where it starts."),
          speed: z.number().default(1).describe("Metres a second."),
        },
        system: (ctx): SceneSystem<Walker> => {
          const strides = new Map<string, Stride>();
          return {
            spawn(e) {
              strides.set(e.id, { x: e.at[0], steps: 0, speed: e.speed });
              ctx.poses.set(e.id, e.at[0], e.at[1], 0, { snap: true });
            },
            despawn: (id) => void strides.delete(id),
            clear: () => strides.clear(),
            size: () => strides.size,
            beforeStep(dtMs) {
              for (const [id, s] of strides) {
                s.x += (s.speed * dtMs) / 1000;
                s.steps++;
                const pose = ctx.poses.get(id)!;
                ctx.poses.set(id, s.x, pose.y, 0);
              }
            },
            save: (id) => {
              const s = strides.get(id);
              return s ? { x: s.x, steps: s.steps } : undefined;
            },
            restore(id, state) {
              const s = strides.get(id);
              const saved = state as { x: number; steps: number };
              if (!s) return;
              s.x = saved.x;
              s.steps = saved.steps;
            },
          };
        },
      },
    ],
    createRuntime(ctx) {
      let score = 0;
      const runtime: GameRuntime<{ score: number }> = {
        afterStep() {
          score += ctx.random.below(10);
          if (ctx.tick === 20) ctx.live.boundary("checkpoint");
        },
        snapshot: () => ({ score }),
        restore: (s) => void (score = s.score),
        onLoad() {
          hook.loads.push(ctx.live.version);
          hook.load?.(ctx);
        },
        onSwap: (swap) => hook.current?.(swap, ctx),
      };
      return runtime;
    },
  });
}

function yard(
  edit: (entities: EntityDef[]) => void = () => {},
  physics: "none" | "rapier" = "none",
): SceneDefinition {
  const entities: EntityDef[] = [
    { id: "w1", type: "walker", at: [1, 1], speed: 1 },
    { id: "w2", type: "walker", at: [2, 2], speed: 1 },
    { id: "post", type: "marker", at: [5, 5] },
  ];
  edit(entities);
  return {
    v: 4,
    name: "yard",
    game: "live-yard",
    bounds: [0, 0, 40, 10],
    settings: { physics, gravity: [0, 0] },
    entities,
  };
}

const withW3 = (es: EntityDef[]) => void es.push({ id: "w3", type: "walker", at: [3, 3] });
const fasterW1 = (es: EntityDef[]) => void (es[0] = { ...es[0]!, speed: 2 } as EntityDef);
const noPost = (es: EntityDef[]) => void es.splice(2, 1);

type Emitted = { [K in "live:swapped" | "live:failed"]: { event: K; payload: GameEventMap[K] } };

/** The yard running under a live layer; on Rapier, `rapier` is the module. */
function world(rapier: RapierModule | null = null) {
  const physics = rapier ? "rapier" : "none";
  const hook: Hooks = { current: null, loads: [] };
  const game = liveGame(hook, physics);
  const registry = createRegistry(game);
  const emitted: Emitted[keyof Emitted][] = [];
  let rt: SceneRuntimeHandle | null = null;
  const layer: LiveLayer = createLiveLayer({
    game,
    runtime: () => rt,
    release: (id) => (id === "yard" ? { def: yard(undefined, physics), prefabs: new Map() } : null),
    emit: (event, payload) => void emitted.push({ event, payload } as Emitted[typeof event]),
  });
  rt = createSceneRuntime({ rapier, view: null, game, registry, live: layer.hooks });
  expect(rt.load(expandScene(yard(undefined, physics), registry)).ok).toBe(true);
  const handle = rt;
  const tick = (n = 1, state = { paused: false, changing: false }) => {
    for (let i = 0; i < n; i++) {
      handle.step(handle.ctx.time.tickMs, []);
      layer.afterTick(state);
    }
  };
  return { rt: handle, registry, layer, hook, emitted, tick };
}

describe("the live layer's onSwap", () => {
  it("gets the diff, the strategy and both sides once, after the tick, then live:swapped", () => {
    const { rt, registry, layer, hook, emitted, tick } = world();
    const seen: SceneSwap[] = [];
    hook.current = (swap) => void seen.push(swap);
    const applied: SceneSwap[] = [];
    layer.onApplied((swap) => void applied.push(swap));
    tick(10);

    const next = preparedOf(
      V1,
      yard((es) => (withW3(es), fasterW1(es), noPost(es))),
      registry,
    );
    expect(layer.stage(next)).toEqual({ ok: true });
    expect(layer.activate("yard", V1, "now")).toEqual({ timing: "now", clamped: false });
    expect(layer.pending()).toEqual([{ scene: "yard", version: V1, timing: "now" }]);
    expect(seen).toHaveLength(0);
    tick();

    expect(seen).toHaveLength(1);
    const [swap] = seen;
    expect(swap).toMatchObject({
      scene: "yard",
      strategy: "reconcile",
      carried: "all",
      timing: "now",
      tick: 11,
      diff: { added: ["w3"], removed: ["post"], changed: ["w1"], header: false },
      from: { version: null },
      to: { version: V1, sceneHash: "hash-1111" },
    });
    expect(swap!.from.runHash).not.toBe(swap!.to.runHash);
    expect(swap!.from.sceneHash).not.toBe(swap!.to.sceneHash);
    expect(emitted).toEqual([{ event: "live:swapped", payload: swap }]);
    expect(applied).toEqual([swap]);
    expect(rt.ctx.live.version).toBe(V1);
    expect(layer.current("yard")).toBe(V1);
    expect(layer.pending()).toEqual([]);
    expect(rt.ctx.exists("w3")).toBe(true);
    expect(rt.ctx.exists("post")).toBe(false);
    tick(5);
    expect(seen).toHaveLength(1);
  });

  it("gets reload and what was carried when the header changed", () => {
    const { rt, registry, layer, hook, tick } = world();
    const seen: SceneSwap[] = [];
    hook.current = (swap) => void seen.push(swap);
    tick(10);
    const wider = { ...yard(), bounds: [0, 0, 50, 10] as SceneDefinition["bounds"] };
    layer.stage(preparedOf(V1, wider, registry));
    layer.activate("yard", V1, "now");
    tick();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ strategy: "reload", carried: "world", diff: { header: true } });
    expect(rt.ctx.bounds).toEqual([0, 0, 50, 10]);
    expect(rt.ctx.live.version).toBe(V1);
  });

  it("keeps what onSwap spawned", () => {
    const { rt, registry, layer, hook, tick } = world();
    hook.current = (_swap, ctx) =>
      void ctx.spawn({ id: "walker#runner", type: "walker", at: [0, 4], speed: 1 });
    tick(10);
    layer.stage(preparedOf(V1, yard(withW3), registry));
    layer.activate("yard", V1, "now");
    tick();
    expect(rt.ctx.exists("walker#runner")).toBe(true);
    const before = rt.ctx.poses.get("walker#runner")!.x;
    tick(30);
    expect(rt.ctx.poses.get("walker#runner")!.x).toBeGreaterThan(before);
    expect(worldDigest(rt)).toContain("walker#runner");
  });

  it("swaps back to the release's own scene with version null", () => {
    const { rt, registry, layer, tick } = world();
    tick(5);
    layer.stage(preparedOf(V1, yard(withW3), registry));
    layer.activate("yard", V1, "now");
    tick();
    expect(rt.ctx.exists("w3")).toBe(true);
    layer.activate("yard", null, "now");
    expect(layer.current("yard")).toBeNull();
    tick();
    expect(rt.ctx.exists("w3")).toBe(false);
    expect(rt.ctx.live.version).toBeNull();
    expect(layer.sceneFor("yard")).toBeNull();
  });
});

describe("a throwing onSwap", () => {
  for (const [name, edit] of [
    ["a reconcile", (es: EntityDef[]) => (withW3(es), fasterW1(es))],
    ["a reload", null],
  ] as const) {
    it(`after ${name}: restores the old digest, destroys its spawns, reports live:failed, and the next load uses the version`, () => {
      const a = world();
      const b = world();
      a.tick(30);
      b.tick(30);
      const def = edit ? yard(edit) : { ...yard(withW3), bounds: [0, 0, 60, 10] as const };
      a.hook.current = (_swap, ctx) => {
        ctx.spawn({ id: "walker#ghost", type: "walker", at: [0, 6], speed: 1 });
        ctx.random.below(100);
        throw new Error("the door moved");
      };
      a.layer.stage(preparedOf(V1, def as SceneDefinition, a.registry));
      a.layer.activate("yard", V1, "now");
      a.rt.step(a.rt.ctx.time.tickMs, []);
      b.rt.step(b.rt.ctx.time.tickMs, []);
      a.layer.afterTick({ paused: false, changing: false });

      expect(a.rt.ctx.exists("walker#ghost")).toBe(false);
      expect(a.rt.ctx.exists("w3")).toBe(false);
      expect(worldDigest(a.rt)).toBe(worldDigest(b.rt));
      expect(a.rt.ctx.bounds).toEqual([0, 0, 40, 10]);
      a.tick(60);
      b.tick(60);
      expect(worldDigest(a.rt)).toBe(worldDigest(b.rt));

      expect(a.emitted).toHaveLength(1);
      const [failed] = a.emitted;
      expect(failed!.event).toBe("live:failed");
      const payload = failed!.payload as GameEventMap["live:failed"];
      expect(payload).toMatchObject({ scene: "yard", version: V1 });
      expect(payload.issue).toMatchObject({
        code: "live-swap-failed",
        severity: "error",
        hint: "the door moved",
        detail: { phase: "onSwap" },
      });
      expect(a.rt.ctx.live.version).toBeNull();
      expect(a.layer.pending()).toEqual([]);

      expect(a.layer.current("yard")).toBe(V1);
      const next = a.layer.sceneFor("yard");
      expect(next?.def).toBe(def);
      expect(a.rt.load(expandScene(next!.def, a.registry, { prefabs: next!.prefabs })).ok).toBe(
        true,
      );
      expect(a.rt.ctx.live.version).toBe(V1);
      expect(a.rt.ctx.exists("w3")).toBe(true);
    });
  }

  it("after a reload from a version, onLoad of the version put back reads that version", () => {
    const { rt, registry, layer, hook, tick } = world();
    const wide = (w: number): SceneDefinition => ({ ...yard(), bounds: [0, 0, w, 10] });
    tick(5);
    layer.stage(preparedOf(V1, wide(50), registry));
    layer.activate("yard", V1, "now");
    tick();
    expect(rt.ctx.live.version).toBe(V1);

    hook.loads.length = 0;
    hook.current = () => {
      throw new Error("the door moved");
    };
    layer.stage(preparedOf(V2, wide(60), registry));
    layer.activate("yard", V2, "now");
    tick();
    expect(hook.loads).toEqual([V2, V1]);
    expect(rt.ctx.live.version).toBe(V1);
    expect(rt.ctx.bounds).toEqual([0, 0, 50, 10]);
    expect(layer.current("yard")).toBe(V2);
  });

  it("when the new version's load fails, onLoad of the version put back reads that version", () => {
    const { rt, registry, layer, hook, tick, emitted } = world();
    tick(5);
    layer.stage(preparedOf(V1, yard(withW3), registry));
    layer.activate("yard", V1, "now");
    tick();
    expect(rt.ctx.live.version).toBe(V1);

    hook.loads.length = 0;
    hook.load = (ctx) => {
      if (ctx.bounds[2] === 60) throw new Error("the cave collapsed");
    };
    layer.stage(preparedOf(V2, { ...yard(withW3), bounds: [0, 0, 60, 10] }, registry));
    layer.activate("yard", V2, "now");
    tick();
    expect(emitted.at(-1)).toMatchObject({ event: "live:failed", payload: { version: V2 } });
    expect(hook.loads).toEqual([V2, V1]);
    expect(rt.ctx.live.version).toBe(V1);
    expect(rt.ctx.bounds).toEqual([0, 0, 40, 10]);
    expect(rt.ctx.exists("w3")).toBe(true);
  });

  it("on Rapier, undoes a throwing onSwap by the inverse reconcile, which keeps what onSwap changed outside the diff", async () => {
    const rapier = (await import("@dimforge/rapier2d")) as RapierModule;
    const a = world(rapier);
    a.tick(30);
    a.hook.current = (_swap, ctx) => {
      ctx.spawn({ id: "walker#ghost", type: "walker", at: [0, 6], speed: 1 });
      ctx.poses.set("w2", 9, 9, 0, { snap: true });
      throw new Error("the door moved");
    };
    a.layer.stage(preparedOf(V1, yard(withW3, "rapier"), a.registry));
    a.layer.activate("yard", V1, "now");
    a.rt.step(a.rt.ctx.time.tickMs, []);
    a.layer.afterTick({ paused: false, changing: false });

    expect(a.emitted.map((e) => e.event)).toEqual(["live:failed"]);
    expect(a.rt.ctx.exists("walker#ghost")).toBe(false);
    expect(a.rt.ctx.exists("w3")).toBe(false);
    expect(a.rt.ctx.live.version).toBeNull();
    // Without a world capture nothing puts back a pose onSwap moved.
    expect(a.rt.ctx.poses.get("w2")).toMatchObject({ x: 9, y: 9 });
  });

  it("reports a swap the runtime refused without running onSwap", () => {
    const { rt, registry, layer, hook, emitted, tick } = world();
    let ran = false;
    hook.current = () => void (ran = true);
    tick(5);
    const prepared = preparedOf(V1, yard(), registry);
    const unknown = { id: "w9", type: "nope", at: [1, 1] } as RuntimeEntity;
    prepared.scene = { ...prepared.scene, entities: [...prepared.scene.entities, unknown] };
    layer.stage(prepared);
    layer.activate("yard", V1, "now");
    tick();
    expect(ran).toBe(false);
    expect(emitted.map((e) => e.event)).toEqual(["live:failed"]);
    expect(emitted[0]!.payload).toMatchObject({ issue: { code: "live-swap-failed" } });
    expect(rt.ctx.live.version).toBeNull();
    expect(layer.current("yard")).toBe(V1);
  });
});

describe("the live layer's timings and pin", () => {
  it("swaps a boundary after the tick that called ctx.live.boundary(), not before", () => {
    const { rt, registry, layer, tick } = world();
    tick(5);
    layer.stage(preparedOf(V1, yard(withW3), registry));
    expect(layer.activate("yard", V1, "boundary")).toEqual({ timing: "boundary", clamped: false });
    tick(15);
    expect(rt.ctx.tick).toBe(20);
    expect(rt.ctx.exists("w3")).toBe(false);
    tick();
    expect(rt.ctx.tick).toBe(21);
    expect(rt.ctx.exists("w3")).toBe(true);
  });

  it("leaves the running world alone for next-load and for a scene that isn't running", () => {
    const { rt, registry, layer, tick } = world();
    tick(5);
    const before = worldDigest(rt);
    layer.stage(preparedOf(V1, yard(withW3), registry));
    layer.stage({
      ...preparedOf(V2, yard(), registry),
      version: { scene: "cave" } as SceneVersion,
    });
    expect(layer.activate("yard", V1, "next-load")).toEqual({
      timing: "next-load",
      clamped: false,
    });
    expect(layer.activate("cave", V2, "now")).toEqual({ timing: "now", clamped: false });
    expect(layer.pending()).toEqual([]);
    expect(worldDigest(rt)).toBe(before);
    expect(layer.current("yard")).toBe(V1);
    expect(layer.current("cave")).toBe(V2);
    expect(rt.ctx.live.version).toBeNull();
  });

  it("waits while paused or while a scene change runs", () => {
    const { rt, registry, layer, tick } = world();
    tick(2);
    layer.stage(preparedOf(V1, yard(withW3), registry));
    layer.activate("yard", V1, "now");
    tick(3, { paused: true, changing: false });
    tick(3, { paused: false, changing: true });
    expect(rt.ctx.exists("w3")).toBe(false);
    expect(layer.pending()).toHaveLength(1);
    tick();
    expect(rt.ctx.exists("w3")).toBe(true);
  });

  it("drops a pending swap when the scene loads again, which uses the version", () => {
    const { rt, registry, layer, hook, tick } = world();
    let swaps = 0;
    hook.current = () => void swaps++;
    tick(2);
    layer.stage(preparedOf(V1, yard(withW3), registry));
    layer.activate("yard", V1, "boundary");
    expect(layer.pending()).toHaveLength(1);
    const next = layer.sceneFor("yard")!;
    rt.load(expandScene(next.def, registry));
    tick(30);
    expect(layer.pending()).toEqual([]);
    expect(swaps).toBe(0);
    expect(rt.ctx.live.version).toBe(V1);
  });

  it("refuses a version that isn't staged, and keeps only the newest staged one", () => {
    const { registry, layer } = world();
    expect(layer.activate("yard", V1, "now").issue).toMatchObject({
      code: "live-swap-failed",
      detail: { phase: "stage" },
    });
    layer.stage(preparedOf(V1, yard(withW3), registry));
    layer.stage(preparedOf(V2, yard(fasterW1), registry));
    expect(layer.activate("yard", V1, "now").issue?.code).toBe("live-swap-failed");
    expect(layer.activate("yard", V2, "next-load").issue).toBeUndefined();
    expect(layer.current("yard")).toBe(V2);
  });

  it("ignores activations while pinned and queues nothing, and uses the pinned versions", () => {
    const { rt, registry, layer, tick } = world();
    tick(2);
    layer.stage(preparedOf(V1, yard(withW3), registry));
    layer.pin({ yard: V1 });
    expect(layer.current("yard")).toBe(V1);
    layer.stage(preparedOf(V2, yard(fasterW1), registry));
    expect(layer.activate("yard", V2, "now")).toEqual({ timing: "now", clamped: false });
    expect(layer.pending()).toEqual([]);
    expect(layer.current("yard")).toBe(V1);
    tick(3);
    expect(rt.ctx.exists("w3")).toBe(false);
    layer.unpin();
    expect(layer.pending()).toEqual([]);
    layer.activate("yard", V2, "now");
    tick();
    expect(rt.ctx.live.version).toBe(V2);
  });

  it("applies pending swaps in scene-id order, one per scene", () => {
    const { registry, layer, tick } = world();
    const order: string[] = [];
    layer.onApplied((swap) => void order.push(swap.scene));
    tick();
    layer.stage(preparedOf(V1, yard(withW3), registry));
    layer.activate("yard", V1, "now");
    layer.stage(preparedOf(V2, yard(fasterW1), registry));
    layer.activate("yard", V2, "now");
    expect(layer.pending()).toEqual([{ scene: "yard", version: V2, timing: "now" }]);
    tick();
    expect(order).toEqual(["yard"]);
  });
});
