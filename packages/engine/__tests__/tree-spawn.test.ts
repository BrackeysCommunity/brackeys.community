// @vitest-environment node
import { beforeAll, describe, expect, it } from "vite-plus/test";

import { DEFAULT_ACTIONS } from "../game/defaults";
import { createRegistry, defineGame } from "../game/define";
import { EngineError } from "../game/types";
import { createSceneRuntime, saveHostOf } from "../runtime/runtime";
import { ENTITY_DESTROYED, ENTITY_SPAWNED, type StepEvent } from "../runtime/types";
import { expandScene } from "../scene/expand";
import { prefabLibrary } from "../scene/prefab";
import { SCENE_FORMAT_VERSION, type EntityDef, type Prefab } from "../scene/types";
import type { RapierModule } from "../types";

let rapier: RapierModule;
beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

const game = defineGame({
  id: "spawning-in",
  types: [],
  actions: [...DEFAULT_ACTIONS],
  input: { players: { max: 1, join: "auto" } },
  time: { kind: "fixed", rate: 60 },
  createRuntime: () => ({ snapshot: () => null, restore: () => {} }),
});
const registry = createRegistry(game);

const node = (id: string, at: [number, number], rot?: number) =>
  ({ id, type: "node", at, ...(rot !== undefined ? { rot } : {}) }) as EntityDef;

/** `cart` sits square at (10, 5), `turned` is a quarter turn at the origin, `tilted` 30°. */
const ENTITIES: EntityDef[] = [
  node("cart", [10, 5]),
  node("turned", [0, 0], 90),
  node("tilted", [0, 0], 30),
  { id: "lone", type: "marker", at: [40, 40] } as EntityDef,
];

const LANTERN: Prefab = {
  kind: "prefab",
  v: SCENE_FORMAT_VERSION,
  id: "lantern",
  entities: [
    { id: "glass", type: "marker", at: [0, 0] } as EntityDef,
    { id: "wick", type: "marker", at: [1, 0] } as EntityDef,
  ],
};

type Physics = "none" | "rapier";
const BACKENDS: readonly Physics[] = ["none", "rapier"];

function load(physics: Physics) {
  const expanded = expandScene(
    {
      v: SCENE_FORMAT_VERSION,
      game: "spawning-in",
      name: "spawning-in",
      bounds: [-60, -60, 60, 60],
      settings: { physics, gravity: [0, 0] },
      entities: ENTITIES,
    },
    registry,
  );
  const rt = createSceneRuntime({
    rapier: physics === "rapier" ? rapier : null,
    view: null,
    game,
    prefabs: prefabLibrary([LANTERN]),
  });
  const report = rt.load(expanded);
  if (!report.ok) throw new Error(report.error);
  return { rt, expanded };
}

type Runtime = ReturnType<typeof load>["rt"];

const pose = (rt: Runtime, id: string) => {
  const p = rt.ctx.poses.get(id);
  expect(p, id).toBeDefined();
  return p!;
};

const near = (rt: Runtime, id: string, x: number, y: number, rot?: number) => {
  const p = pose(rt, id);
  expect(p.x, `${id}.x`).toBeCloseTo(x, 9);
  expect(p.y, `${id}.y`).toBeCloseTo(y, 9);
  if (rot !== undefined) expect(p.rot, `${id}.rot`).toBeCloseTo(rot, 9);
};

const code = (f: () => unknown) => {
  try {
    f();
  } catch (err) {
    return err instanceof EngineError ? err.code : String(err);
  }
  return null;
};

const DEG30 = Math.PI / 6;

for (const physics of BACKENDS) {
  describe(`spawning under a parent on physics: ${physics}`, () => {
    it("takes world fields by default and follows the parent from there", () => {
      const { rt } = load(physics);
      const e = rt.ctx.spawn({ type: "marker", at: [12, 5], parent: "cart" });
      expect(rt.ctx.tree.parent(e.id)).toBe("cart");
      expect(rt.ctx.tree.children("cart")).toEqual([e.id]);
      near(rt, e.id, 12, 5);
      expect(rt.ctx.tree.local(e.id)).toMatchObject({ x: 2, y: 0 });
      rt.ctx.setPose("cart", 20, 8);
      near(rt, e.id, 22, 8);
      rt.destroy();
    });

    it("reads local fields in the parent's frame", () => {
      const { rt } = load(physics);
      const square = rt.ctx.spawn({ type: "marker", at: [2, 0], parent: "cart", local: true });
      near(rt, square.id, 12, 5, 0);
      expect(square.at).toEqual([12, 5]);

      const quarter = rt.ctx.spawn({ type: "marker", at: [1, 0], parent: "turned", local: true });
      near(rt, quarter.id, 0, 1, Math.PI / 2);
      expect(quarter.at).toEqual([0, 1]);
      expect(rt.ctx.tree.local(quarter.id)!.x).toBeCloseTo(1, 9);

      const tilted = rt.ctx.spawn({ type: "marker", at: [1, 0], parent: "tilted", local: true });
      near(rt, tilted.id, Math.cos(DEG30), Math.sin(DEG30), DEG30);
      const local = rt.ctx.tree.local(tilted.id)!;
      expect(local.x).toBeCloseTo(1, 9);
      expect(local.y).toBeCloseTo(0, 9);
      expect(local.rot).toBeCloseTo(0, 9);
      rt.destroy();
    });

    it("places a local solid's shape in the parent's frame", () => {
      const { rt } = load(physics);
      const wall = rt.ctx.spawn({
        type: "solid",
        shape: ["box", 0, 2, 0.5, 0.25],
        parent: "turned",
        local: true,
      });
      near(rt, wall.id, -2, 0);
      expect(rt.ctx.query.at({ x: -2, y: 0 }, { type: "solid" })).toEqual([wall.id]);
      rt.ctx.setPose("turned", 5, 0, Math.PI / 2);
      near(rt, wall.id, 3, 0);
      rt.destroy();
    });

    it("instantiates a prefab's node under a parent, in world or local coordinates", () => {
      const { rt } = load(physics);
      const world = rt.ctx.instantiate("lantern", [10, 5], { parent: "cart" });
      expect(rt.ctx.tree.parent(world.id)).toBe("cart");
      expect(rt.ctx.tree.children(world.id)).toEqual(world.entities);
      near(rt, `${world.id}/wick`, 11, 5);

      const local = rt.ctx.instantiate("lantern", [0, 1], { parent: "cart", local: true });
      near(rt, local.id, 10, 6, 0);
      near(rt, `${local.id}/wick`, 11, 6);

      const quarter = rt.ctx.instantiate("lantern", [1, 0], {
        parent: "turned",
        local: true,
        rot: 90,
      });
      near(rt, quarter.id, 0, 1, Math.PI);
      near(rt, `${quarter.id}/wick`, -1, 1);

      const tilted = rt.ctx.instantiate("lantern", [1, 0], { parent: "tilted", local: true });
      const [c, s] = [Math.cos(DEG30), Math.sin(DEG30)];
      near(rt, tilted.id, c, s, DEG30);
      near(rt, `${tilted.id}/wick`, 2 * c, 2 * s, DEG30);

      rt.ctx.setPose("cart", 0, 0);
      near(rt, `${local.id}/wick`, 1, 1);
      rt.destroy();
    });

    it("refuses an unknown parent with parent-scope, giving out no id", () => {
      const { rt } = load(physics);
      expect(code(() => rt.ctx.spawn({ type: "marker", at: [0, 0], parent: "nowhere" }))).toBe(
        "parent-scope",
      );
      expect(code(() => rt.ctx.instantiate("lantern", [0, 0], { parent: "nowhere" }))).toBe(
        "parent-scope",
      );
      expect(rt.ctx.spawn({ type: "marker", at: [0, 0] }).id).toBe("marker#1");
      expect(rt.ctx.instantiate("lantern", [0, 0]).id).toBe("lantern#1");
      rt.destroy();
    });
  });
}

describe("a spawn with no parent", () => {
  it("is a root, its record and entity as before", () => {
    const { rt } = load("none");
    const e = rt.ctx.spawn({ type: "marker", at: [3, 4] });
    expect(e.parent).toBeUndefined();
    expect(rt.ctx.tree.parent(e.id)).toBeNull();
    const host = saveHostOf(rt.ctx)!;
    expect(host.captureWorld().spawned).toEqual([
      { id: e.id, input: { type: "marker", at: [3, 4] } },
    ]);
    rt.destroy();
  });
});

describe("a save's spawn records", () => {
  /** Plays a fresh load up to `world`. */
  function restored(world: ReturnType<NonNullable<ReturnType<typeof saveHostOf>>["captureWorld"]>) {
    const { rt } = load("none");
    const issue = saveHostOf(rt.ctx)!.restoreWorld(world, []);
    expect(issue).toBeNull();
    return rt;
  }

  it("relinks spawns and instances under their parents on restore", () => {
    const { rt } = load("none");
    const crate = rt.ctx.spawn({ type: "node", at: [4, 4] });
    const lid = rt.ctx.spawn({ type: "marker", at: [1, 0], parent: crate.id, local: true });
    const lamp = rt.ctx.instantiate("lantern", [0, 1], { parent: "turned", local: true });
    const world = saveHostOf(rt.ctx)!.captureWorld();
    expect(world.spawned.map((s) => [s.id, s.input.parent ?? s.instance?.parent])).toEqual([
      [crate.id, undefined],
      [lid.id, crate.id],
      [lamp.id, "turned"],
    ]);
    expect(world.spawned[1]!.input).toEqual({ type: "marker", at: [5, 4], parent: crate.id });

    const back = restored(world);
    expect(back.ctx.tree.parent(lid.id)).toBe(crate.id);
    expect(back.ctx.tree.parent(lamp.id)).toBe("turned");
    expect(back.ctx.tree.children(lamp.id)).toEqual(lamp.entities);
    near(back, lid.id, 5, 4);
    near(back, `${lamp.id}/wick`, -1, 1);
    back.ctx.setPose(crate.id, 0, 0);
    near(back, lid.id, 1, 0);
    rt.destroy();
    back.destroy();
  });

  it("records the parent a spawn has now, and restores one whose parent is gone as a root", () => {
    const { rt } = load("none");
    const crate = rt.ctx.spawn({ type: "node", at: [4, 4] });
    const lid = rt.ctx.spawn({ type: "marker", at: [5, 4], parent: crate.id });
    const moved = rt.ctx.spawn({ type: "marker", at: [6, 4], parent: "cart" });
    rt.ctx.tree.setParent(lid.id, null);
    rt.ctx.tree.setParent(moved.id, crate.id);
    rt.ctx.destroy(crate.id);
    expect(rt.ctx.exists(lid.id)).toBe(true);
    expect(rt.ctx.exists(moved.id)).toBe(false);
    const world = saveHostOf(rt.ctx)!.captureWorld();
    expect(world.spawned).toEqual([{ id: lid.id, input: { type: "marker", at: [5, 4] } }]);
    const back = restored(world);
    expect(back.ctx.exists(lid.id)).toBe(true);
    expect(back.ctx.tree.parent(lid.id)).toBeNull();

    const orphan = restored({
      ...world,
      spawned: [{ id: lid.id, input: { type: "marker", at: [5, 4], parent: "crate#9" } }],
    });
    expect(orphan.ctx.tree.parent(lid.id)).toBeNull();
    rt.destroy();
    back.destroy();
    orphan.destroy();
  });
});

describe("a destroy queued mid-tick", () => {
  it("takes the children spawned under the parent later that tick", () => {
    const { rt } = load("none");
    let child = "";
    let lamp = "";
    rt.ctx.timers.after(0, () => {
      rt.ctx.destroy("cart");
      child = rt.ctx.spawn({ type: "marker", at: [11, 5], parent: "cart" }).id;
      lamp = rt.ctx.instantiate("lantern", [10, 5], { parent: "cart" }).id;
    });
    const { events } = rt.step(rt.ctx.time.tickMs, []);
    const seen = (events as StepEvent[])
      .filter((e) => e.type === ENTITY_DESTROYED || e.type === ENTITY_SPAWNED)
      .map((e) => `${e.type} ${e.entityId}`);
    expect(seen).toEqual([
      `${ENTITY_SPAWNED} ${child}`,
      `${ENTITY_SPAWNED} ${lamp}`,
      `${ENTITY_SPAWNED} ${lamp}/glass`,
      `${ENTITY_SPAWNED} ${lamp}/wick`,
      `${ENTITY_DESTROYED} ${lamp}/wick`,
      `${ENTITY_DESTROYED} ${lamp}/glass`,
      `${ENTITY_DESTROYED} ${lamp}`,
      `${ENTITY_DESTROYED} ${child}`,
      `${ENTITY_DESTROYED} cart`,
    ]);
    for (const id of ["cart", child, lamp]) expect(rt.ctx.exists(id), id).toBe(false);
    expect(saveHostOf(rt.ctx)!.captureWorld().spawned).toEqual([]);
    rt.destroy();
  });
});
