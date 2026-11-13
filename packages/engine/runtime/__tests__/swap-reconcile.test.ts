// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { engineYard } from "../../__tests__/fixtures/engine-yard.expanded";
import { runDigest, steps, swapped, worldDigest } from "../../__tests__/fixtures/live-version";
import { createRegistry, defineGame } from "../../game/define";
import { pointField } from "../../game/fields";
import type { GameDefinition, GameRuntime, Registry, SceneSystem } from "../../game/types";
import { expandScene } from "../../scene/expand";
import { parseScene } from "../../scene/parse";
import type {
  EntityDef,
  ExpandedScene,
  Prefab,
  PrefabLibrary,
  Pt,
  RuntimeEntity,
  SceneDefinition,
} from "../../scene/types";
import type { RapierModule } from "../../types";
import { readPrefabFiles } from "../../vite/project-files";
import { createSceneRuntime, saveHostOf } from "../runtime";
import type { SceneRuntimeHandle } from "../types";

let rapier: RapierModule;
beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

type Entities = EntityDef[];
type Walker = RuntimeEntity<{ at: Pt; speed: number }>;
type Stride = { x: number; y: number; steps: number; speed: number };

/** Walkers step right at their speed each tick and save where they are and how many steps they took. */
function swapGame(withRestore = true): GameDefinition {
  return defineGame({
    id: "swap-yard",
    world: { physics: "none" },
    actions: [],
    types: [
      {
        type: "walker",
        description: "A point that walks right.",
        fields: {
          at: pointField("Where it starts."),
          speed: z.number().default(1).describe("Metres a second; -1 refuses to spawn."),
        },
        system: (ctx): SceneSystem<Walker> => {
          const strides = new Map<string, Stride>();
          return {
            spawn(e) {
              if (e.speed === -1) throw new Error("this walker refuses to spawn");
              strides.set(e.id, { x: e.at[0], y: e.at[1], steps: 0, speed: e.speed });
              ctx.poses.set(e.id, e.at[0], e.at[1], 0, { snap: true });
            },
            despawn: (id) => void strides.delete(id),
            clear: () => strides.clear(),
            size: () => strides.size,
            beforeStep(dtMs) {
              for (const [id, s] of strides) {
                s.x += (s.speed * dtMs) / 1000;
                s.steps++;
                ctx.poses.set(id, s.x, s.y, 0);
              }
            },
            save(id) {
              const s = strides.get(id);
              return s ? { x: s.x, y: s.y, steps: s.steps } : undefined;
            },
            restore(id, state) {
              const s = strides.get(id);
              const saved = state as { x: number; y: number; steps: number };
              if (!s) return;
              s.x = saved.x;
              s.y = saved.y;
              s.steps = saved.steps;
            },
          };
        },
      },
    ],
    createRuntime(ctx) {
      let score = 0;
      const runtime: GameRuntime<{ score: number }> = {
        beforeStep() {
          if (ctx.tick === 5) ctx.spawn({ type: "walker", at: [0, 3], speed: 2 });
          if (ctx.tick === 10) ctx.destroy("coin");
          if (ctx.tick === 12) ctx.setEnabled("lamp", false);
        },
        afterStep() {
          score += ctx.random.below(10);
        },
        snapshot: () => ({ score }),
      };
      if (withRestore) runtime.restore = (s) => void (score = s.score);
      return runtime;
    },
  });
}

const beacon = (children: number): Prefab => ({
  kind: "prefab",
  v: 4,
  id: "beacon",
  entities: Array.from({ length: children }, (_, i) => ({
    id: `light-${i}`,
    type: "marker",
    at: [i, 0] as Pt,
  })),
});

const OLD_PREFABS: PrefabLibrary = new Map([["beacon", beacon(1)]]);
const NEW_PREFABS: PrefabLibrary = new Map([["beacon", beacon(2)]]);

function yard(edit: (entities: Entities) => void = () => {}): SceneDefinition {
  const entities: Entities = [
    { id: "w1", type: "walker", at: [1, 1], speed: 1 },
    { id: "w2", type: "walker", at: [2, 2], speed: 1 },
    { id: "coin", type: "marker", at: [3, 3] },
    { id: "lamp", type: "walker", at: [4, 4], speed: 1 },
    { id: "post", type: "marker", at: [5, 5] },
  ];
  edit(entities);
  return {
    v: 4,
    name: "yard",
    game: "swap-yard",
    bounds: [0, 0, 40, 10],
    settings: { physics: "none", gravity: [0, 0] },
    entities,
  };
}

const expand = (def: SceneDefinition, registry: Registry, prefabs = OLD_PREFABS) =>
  expandScene(def, registry, { prefabs });

function patch(id: string, fields: Record<string, unknown>) {
  return (entities: Entities) => {
    const i = entities.findIndex((e) => e.id === id);
    entities[i] = { ...entities[i]!, ...fields } as EntityDef;
  };
}

const drop = (id: string) => (entities: Entities) => {
  entities.splice(
    entities.findIndex((e) => e.id === id),
    1,
  );
};

const both =
  (...edits: ((entities: Entities) => void)[]) =>
  (entities: Entities) => {
    for (const edit of edits) edit(entities);
  };

function physicsFree(withRestore = true) {
  const game = swapGame(withRestore);
  const registry = createRegistry(game);
  const rt = createSceneRuntime({ rapier: null, view: null, game, registry, prefabs: OLD_PREFABS });
  const loaded = rt.load(expand(yard(), registry));
  expect(loaded.ok).toBe(true);
  return { rt, registry };
}

describe("SceneRuntime.swap reconciles a physics-free scene", () => {
  const edits = both(patch("w2", { speed: 3 }), drop("post"), (es) =>
    es.push({ id: "flag", type: "marker", at: [6, 6] }),
  );

  it("leaves every untouched entity as a run without the swap has it, runtime spawn included", () => {
    const a = physicsFree();
    const b = physicsFree();
    steps(a.rt, 30);
    steps(b.rt, 30);
    const report = swapped(a.rt.swap(expand(yard(edits), a.registry), { prefabs: OLD_PREFABS }));
    expect(report.strategy).toBe("reconcile");
    expect(report.carried).toBe("all");
    expect(report.diff).toEqual({
      added: ["flag"],
      removed: ["post"],
      changed: ["w2"],
      header: false,
    });
    expect(a.rt.ctx.exists("walker#1")).toBe(true);
    const skip = ["w2", "post", "flag"];
    expect(runDigest(a.rt, 60, skip)).toBe(runDigest(b.rt, 60, skip));
    expect(a.rt.ctx.exists("post")).toBe(false);
    expect(a.rt.ctx.exists("flag")).toBe(true);
  });

  it("keeps an entity destroyed at runtime destroyed though its definition changed", () => {
    const { rt, registry } = physicsFree();
    steps(rt, 20);
    expect(rt.ctx.exists("coin")).toBe(false);
    const report = swapped(
      rt.swap(expand(yard(patch("coin", { at: [9, 9] })), registry), { prefabs: OLD_PREFABS }),
    );
    expect(report.diff.changed).toEqual(["coin"]);
    expect(rt.ctx.exists("coin")).toBe(false);
    expect(saveHostOf(rt.ctx)!.captureWorld().destroyed).toEqual(["coin"]);
    steps(rt, 5);
    expect(rt.ctx.exists("coin")).toBe(false);

    swapped(rt.swap(expand(yard(drop("coin")), registry), { prefabs: OLD_PREFABS }));
    expect(saveHostOf(rt.ctx)!.captureWorld().destroyed).toEqual([]);
  });

  it("keeps a disabled entity disabled after its definition changed", () => {
    const { rt, registry } = physicsFree();
    steps(rt, 20);
    expect(rt.ctx.enabled("lamp")).toBe(false);
    const report = swapped(
      rt.swap(expand(yard(patch("lamp", { speed: 4 })), registry), { prefabs: OLD_PREFABS }),
    );
    expect(report.diff.changed).toEqual(["lamp"]);
    expect(rt.ctx.exists("lamp")).toBe(true);
    expect(rt.ctx.enabled("lamp")).toBe(false);
    steps(rt, 5);
    expect(rt.ctx.enabled("lamp")).toBe(false);
  });

  it("keeps a changed entity's runtime pose and state when its authored pose didn't change", () => {
    const { rt, registry } = physicsFree();
    steps(rt, 30);
    const before = { ...rt.ctx.poses.get("w2")! };
    const saved = saveHostOf(rt.ctx)!.captureWorld().systems.w2;
    expect(saved).toEqual({ walker: { x: before.x, y: 2, steps: 30 } });
    swapped(rt.swap(expand(yard(patch("w2", { speed: 3 })), registry), { prefabs: OLD_PREFABS }));
    expect(rt.ctx.poses.get("w2")).toMatchObject({ x: before.x, y: before.y, rot: 0 });
    expect(saveHostOf(rt.ctx)!.captureWorld().systems.w2).toEqual(saved);
    steps(rt, 1);
    expect(rt.ctx.poses.get("w2")!.x).toBeCloseTo(before.x + (3 * rt.ctx.time.tickMs) / 1000, 12);
  });

  it("takes the new pose and a fresh state when the designer moved the entity", () => {
    const { rt, registry } = physicsFree();
    steps(rt, 30);
    swapped(rt.swap(expand(yard(patch("w2", { at: [7, 2] })), registry), { prefabs: OLD_PREFABS }));
    expect(rt.ctx.poses.get("w2")).toMatchObject({ x: 7, y: 2 });
    expect(saveHostOf(rt.ctx)!.captureWorld().systems.w2).toEqual({
      walker: { x: 7, y: 2, steps: 0 },
    });
  });

  it("freezes the version's prefab library, so ctx.instantiate places the new prefab", () => {
    const { rt, registry } = physicsFree();
    steps(rt, 3);
    expect(rt.ctx.instantiate("beacon", [1, 1]).entities).toEqual(["beacon#1/light-0"]);
    const report = swapped(rt.swap(expand(yard(), registry), { prefabs: NEW_PREFABS }));
    expect(report.diff).toEqual({ added: [], removed: [], changed: [], header: false });
    expect(rt.ctx.instantiate("beacon", [2, 1]).entities).toEqual([
      "beacon#2/light-0",
      "beacon#2/light-1",
    ]);
    expect(rt.ctx.exists("beacon#1/light-0")).toBe(true);
    report.undo();
    expect(rt.ctx.instantiate("beacon", [3, 1]).entities).toEqual(["beacon#3/light-0"]);
  });

  it("undo puts the old version back bit-exact over 120 further ticks", () => {
    const a = physicsFree();
    const b = physicsFree();
    steps(a.rt, 30);
    steps(b.rt, 30);
    const before = a.rt.scene();
    const report = swapped(
      a.rt.swap(expand(yard(edits), a.registry, NEW_PREFABS), { prefabs: NEW_PREFABS }),
    );
    report.undo();
    expect(a.rt.scene()).toEqual(before);
    expect(worldDigest(a.rt)).toBe(worldDigest(b.rt));
    expect(runDigest(a.rt, 120)).toBe(runDigest(b.rt, 120));
    expect(a.rt.ctx.instantiate("beacon", [1, 1]).entities).toHaveLength(1);
  });

  it("undo without a world save puts the digest back by the inverse reconcile", () => {
    const { rt, registry } = physicsFree(false);
    steps(rt, 30);
    const before = worldDigest(rt);
    const scene = rt.scene();
    const report = swapped(rt.swap(expand(yard(edits), registry), { prefabs: NEW_PREFABS }));
    expect(worldDigest(rt)).not.toBe(before);
    report.undo();
    expect(worldDigest(rt)).toBe(before);
    expect(rt.scene()).toEqual(scene);
    expect(rt.ctx.instantiate("beacon", [1, 1]).entities).toHaveLength(1);
  });

  it("refuses an add that can't spawn and leaves the old world, exactly when it can be saved", () => {
    const a = physicsFree();
    const b = physicsFree();
    steps(a.rt, 30);
    steps(b.rt, 30);
    const scene = a.rt.scene();
    const refused = both(edits, (es) =>
      es.push({ id: "bad", type: "walker", at: [1, 8], speed: -1 }),
    );
    const report = a.rt.swap(expand(yard(refused), a.registry), { prefabs: NEW_PREFABS });
    expect(report.ok).toBe(false);
    if (report.ok) return;
    expect(report.issue.code).toBe("live-swap-failed");
    expect(report.issue.detail).toMatchObject({
      phase: "swap",
      reason: "refused",
      entityId: "bad",
    });
    expect(report.issue.hint).toContain("this walker refuses to spawn");
    expect(a.rt.scene()).toEqual(scene);
    expect(worldDigest(a.rt)).toBe(worldDigest(b.rt));
    expect(runDigest(a.rt, 120)).toBe(runDigest(b.rt, 120));
    expect(a.rt.ctx.instantiate("beacon", [1, 1]).entities).toHaveLength(1);
  });

  it("refuses an add by the inverse reconcile when the world can't be saved", () => {
    const { rt, registry } = physicsFree(false);
    steps(rt, 30);
    const before = worldDigest(rt);
    const scene = rt.scene();
    const refused = both(edits, (es) =>
      es.push({ id: "bad", type: "walker", at: [1, 8], speed: -1 }),
    );
    const report = rt.swap(expand(yard(refused), registry), { prefabs: NEW_PREFABS });
    expect(report.ok).toBe(false);
    expect(worldDigest(rt)).toBe(before);
    expect(rt.scene()).toEqual(scene);
  });

  it("leaves a header change and an asked-for reload to the reload strategy", () => {
    const { rt, registry } = physicsFree();
    steps(rt, 10);
    const before = worldDigest(rt);
    const wider = { ...yard(), bounds: [0, 0, 50, 10] as [number, number, number, number] };
    for (const report of [
      rt.swap(expand(wider, registry), { prefabs: OLD_PREFABS }),
      rt.swap(expand(yard(), registry), { prefabs: OLD_PREFABS, strategy: "reload" }),
    ]) {
      expect(swapped(report)).toMatchObject({ strategy: "reload", carried: "world" });
    }
    expect(worldDigest(rt)).toBe(before);
  });
});

describe("SceneRuntime.swap reconciles a Rapier scene", () => {
  const scenesDir = new URL("../../scenes/", import.meta.url);
  let registry: Registry;
  let def: SceneDefinition;
  let prefabs: PrefabLibrary;

  beforeAll(async () => {
    registry = createRegistry(null);
    const parsed = parseScene(
      readFileSync(new URL("behavior-yard.json", scenesDir), "utf8"),
      registry,
    );
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    def = parsed.def;
    prefabs = (await readPrefabFiles(fileURLToPath(scenesDir), registry)).prefabs;
  });

  function yardRuntime() {
    const rt = createSceneRuntime({ rapier, view: null, registry, prefabs });
    expect(rt.load(expandScene(def, registry, { prefabs })).ok).toBe(true);
    return rt;
  }

  const edited = (edit: (entities: Entities) => void): ExpandedScene => {
    const next = structuredClone(def);
    edit((next.entities ??= []));
    return expandScene(next, registry, { prefabs });
  };

  const colliderAt = (rt: SceneRuntimeHandle, id: string) =>
    rt.ctx.tags.handlesOf(id).map((h) => {
      const t = rt.ctx.physics!.world.getCollider(h)!.translation();
      return [t.x, t.y];
    });

  it("keeps the behavior-driven world bit-exact when only a marker's tags changed, spawner crates included", () => {
    const a = yardRuntime();
    const b = yardRuntime();
    steps(a, 90);
    steps(b, 90);
    const crates = [...a.ctx.poses.ids()].filter((id) => id.startsWith("crate#"));
    expect(crates.length).toBeGreaterThan(0);
    const report = swapped(
      a.swap(edited(patch("drop-point", { tags: ["destination", "spare"] })), { prefabs }),
    );
    expect(report.diff.changed).toEqual(["drop-point"]);
    for (const id of crates) expect(a.ctx.exists(id)).toBe(true);
    expect(runDigest(a, 60, ["drop-point"])).toBe(runDigest(b, 60, ["drop-point"]));
  });

  it("moves a platform and adds a solid in the Rapier world, and undo puts the digest back", () => {
    const rt = yardRuntime();
    steps(rt, 30);
    const before = worldDigest(rt);
    expect(colliderAt(rt, "ledge")).toEqual([[8, 10.5]]);
    const report = swapped(
      rt.swap(
        edited((es) => {
          patch("ledge", { shape: ["box", 9, 9.5, 1, 0.1] })(es);
          es.push({ id: "step", type: "solid", shape: ["box", 12, 10, 0.5, 0.5] });
        }),
        { prefabs },
      ),
    );
    expect(report.diff).toEqual({
      added: ["step"],
      removed: [],
      changed: ["ledge"],
      header: false,
    });
    expect(colliderAt(rt, "ledge")).toEqual([[9, 9.5]]);
    expect(colliderAt(rt, "step")).toEqual([[12, 10]]);
    expect(rt.ctx.query.at({ x: 12, y: 10 })).toContain("step");
    steps(rt, 10);
    const later = worldDigest(rt);
    expect(later).not.toBe(before);

    const fresh = yardRuntime();
    steps(fresh, 30);
    const report2 = swapped(
      fresh.swap(edited(patch("ledge", { shape: ["box", 9, 9.5, 1, 0.1] })), { prefabs }),
    );
    report2.undo();
    expect(worldDigest(fresh)).toBe(before);
    expect(colliderAt(fresh, "ledge")).toEqual([[8, 10.5]]);
  });

  it("keeps a pushed body where it is when only its material changed", () => {
    const reg = createRegistry(null);
    const rt = createSceneRuntime({ rapier, view: null, registry: reg });
    const scene = engineYard();
    expect(rt.load(scene).ok).toBe(true);
    steps(rt, 5);
    rt.ctx.bodies.applyImpulse("crate", { x: 0.6, y: 0 });
    steps(rt, 20);
    const pushed = { ...rt.ctx.poses.get("crate")! };
    const v = rt.ctx.bodies.velocity("crate");
    expect(pushed.x).toBeGreaterThan(12.05);
    const next = engineYard();
    const crate = next.entities.find((e) => e.id === "crate")!;
    crate.restitution = 0.1;
    swapped(rt.swap(next, { prefabs: new Map() }));
    expect(rt.ctx.poses.get("crate")).toMatchObject({ x: pushed.x, y: pushed.y });
    expect(rt.ctx.bodies.velocity("crate")).toEqual(v);
    steps(rt, 1);
    expect(rt.ctx.poses.get("crate")!.x).toBeGreaterThan(12.05);
  });
});
