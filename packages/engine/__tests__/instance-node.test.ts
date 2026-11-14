// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import type { SpawnerSystem } from "../game/behaviors/spawner";
import { defineGame } from "../game/define";
import { createSceneRuntime } from "../runtime/runtime";
import { ENTITY_DESTROYED, ENTITY_SPAWNED, type StepEvent } from "../runtime/types";
import { expandScene } from "../scene/expand";
import { prefabLibrary } from "../scene/prefab";
import type { InstanceDef, Prefab, RuntimeEntity, SceneDefinition } from "../scene/types";
import { stepEvents } from "./fixtures/tree-rig";

const prefab = (id: string, body: Partial<Prefab> = {}): Prefab => ({
  kind: "prefab",
  v: 4,
  id,
  entities: [],
  ...body,
});

/** A lamp of two markers, and a post that holds a lamp turned once. */
const PREFABS = prefabLibrary([
  prefab("lamp", {
    entities: [
      { id: "bulb", type: "marker", at: [0, -10] },
      { id: "base", type: "marker", at: [0, 10] },
    ],
  }),
  prefab("post", {
    entities: [{ id: "foot", type: "marker", at: [0, 0] }],
    instances: [{ id: "top", prefab: "lamp", at: [0, -50], rot: 90 }],
  }),
]);

const game = defineGame({
  id: "nodes",
  types: [],
  actions: [],
  createRuntime: () => ({ snapshot: () => null }),
});

function load(instances: InstanceDef[], entities: SceneDefinition["entities"] = []) {
  const rt = createSceneRuntime({ rapier: undefined, view: null, game, prefabs: PREFABS });
  const def: SceneDefinition = {
    v: 4,
    name: "nodes",
    bounds: [-500, -500, 500, 500],
    settings: { gravity: [0, 0], physics: "none" },
    entities,
    instances,
  };
  const report = rt.load(expandScene(def, rt.ctx.registry, { prefabs: PREFABS }));
  if (!report.ok) throw new Error(report.error);
  const events: StepEvent[] = [];
  const step = (n = 1) => {
    events.push(...stepEvents(rt, n));
  };
  const at = (id: string) => {
    const p = rt.ctx.poses.get(id);
    return p ? [Math.round(p.x * 1e6) / 1e6, Math.round(p.y * 1e6) / 1e6] : undefined;
  };
  return { rt, ctx: rt.ctx, step, events, at };
}

describe("an instance's node at runtime", () => {
  it("is live after a load, posed at the instance's origin and angle, over its children", () => {
    const { rt, ctx } = load([{ id: "p", prefab: "post", at: [100, 100] }]);
    expect(ctx.get("p")).toMatchObject({ type: "node", at: [100, 100] });
    expect(ctx.get("p/top")).toMatchObject({ type: "node", at: [100, 50], parent: "p" });
    expect(ctx.poses.get("p/top")?.rot).toBeCloseTo(Math.PI / 2);
    // entities before instances
    expect(ctx.tree.children("p")).toEqual(["p/foot", "p/top"]);
    expect(ctx.tree.children("p/top")).toEqual(["p/top/bulb", "p/top/base"]);
    expect(ctx.tree.parent("p/top/bulb")).toBe("p/top");
    expect(ctx.tree.root("p/top/bulb")).toBe("p");
    rt.destroy();
  });

  it("moves its children when it moves, nested instances included", () => {
    const { rt, ctx, step, at } = load([{ id: "p", prefab: "post", at: [100, 100] }]);
    const before = { foot: at("p/foot")!, bulb: at("p/top/bulb")! };
    ctx.setPose("p", 130, 80);
    step();
    expect(at("p/foot")).toEqual([before.foot[0]! + 30, before.foot[1]! - 20]);
    expect(at("p/top/bulb")).toEqual([before.bulb[0]! + 30, before.bulb[1]! - 20]);
    rt.destroy();
  });

  it("switches the instance off and on by its id", () => {
    const { rt, ctx, step } = load([{ id: "p", prefab: "post", at: [0, 0] }]);
    step();
    ctx.setEnabled("p", false);
    expect(["p", "p/top", "p/foot", "p/top/bulb"].map((id) => ctx.enabled(id))).toEqual([
      false,
      false,
      false,
      false,
    ]);
    ctx.setEnabled("p", true);
    expect(["p", "p/top", "p/foot", "p/top/bulb"].map((id) => ctx.enabled(id))).toEqual([
      true,
      true,
      true,
      true,
    ]);
    rt.destroy();
  });

  it("destroys the instance, its node last, by its id", () => {
    const { rt, ctx, step, events } = load([{ id: "p", prefab: "post", at: [0, 0] }]);
    ctx.timers.after(0, () => {
      ctx.destroy("p");
      // inside a step, the destroy waits for the tick's end
      expect(ctx.exists("p")).toBe(true);
    });
    step(2);
    for (const id of ["p", "p/top", "p/foot", "p/top/bulb", "p/top/base"])
      expect(ctx.exists(id)).toBe(false);
    const gone = events.filter((e) => e.type === ENTITY_DESTROYED).map((e) => e.entityId);
    expect([...gone].sort((a, b) => a!.localeCompare(b!))).toEqual([
      "p",
      "p/foot",
      "p/top",
      "p/top/base",
      "p/top/bulb",
    ]);
    expect(gone.at(-1)).toBe("p");
    rt.destroy();
  });

  it("spawns no node for an off instance", () => {
    const { rt, ctx } = load([{ id: "p", prefab: "post", at: [0, 0], off: true }]);
    expect(ctx.exists("p")).toBe(false);
    expect(ctx.exists("p/foot")).toBe(false);
    rt.destroy();
  });
});

describe("ctx.instantiate and the node", () => {
  it("spawns the node, raises entity:spawned for it, and lists the children only", () => {
    const { rt, ctx, step, events, at } = load([]);
    let made: { id: string; entities: readonly string[] } | undefined;
    rt.ctx.timers.after(0, () => {
      made = ctx.instantiate("post", [10, 20]);
    });
    step(2);
    expect(made).toBeDefined();
    const { id, entities } = made!;
    expect(ctx.get(id)).toMatchObject({ type: "node", at: [10, 20] });
    expect(entities).not.toContain(id);
    expect(entities).not.toContain(`${id}/top`);
    expect([...entities].sort((a, b) => a.localeCompare(b))).toEqual([
      `${id}/foot`,
      `${id}/top/base`,
      `${id}/top/bulb`,
    ]);
    const spawned = events.filter((e) => e.type === ENTITY_SPAWNED).map((e) => e.entityId);
    expect(spawned).toContain(id);
    expect(spawned).toContain(`${id}/top`);
    expect(ctx.tree.parent(`${id}/foot`)).toBe(id);
    ctx.setPose(id, 15, 20);
    step();
    expect(at(`${id}/foot`)).toEqual([15, 20]);
    rt.destroy();
  });
});

describe("a spawner placing prefabs", () => {
  const spawnerAt = (block: Record<string, unknown>): RuntimeEntity => ({
    id: "s",
    type: "marker",
    at: [0, 0],
    behaviors: { spawner: block },
  });

  function run(block: Record<string, unknown>) {
    const rt = createSceneRuntime({ rapier: undefined, view: null, game, prefabs: PREFABS });
    const report = rt.load({
      name: "spawning",
      bounds: [-100, -100, 100, 100],
      settings: {
        gravity: [0, 0],
        physics: "none",
        grid: null,
        view: { projection: "orthogonal" },
      },
      entities: [spawnerAt(block)],
    });
    if (!report.ok) throw new Error(report.error);
    const events: StepEvent[] = [];
    const step = (n = 1) => {
      events.push(...stepEvents(rt, n));
    };
    const system = rt.ctx.behavior<SpawnerSystem>("spawner")!;
    return { rt, ctx: rt.ctx, step, events, system };
  }

  it("counts an instance once, not once for its node and again for its children", () => {
    const { rt, step, system } = run({ prefab: "post", rate: 60, cap: 2 });
    step(4);
    const live = system.live("s");
    expect(live).toHaveLength(2);
    expect(live.every((id) => !id.includes("/"))).toBe(true);
    rt.destroy();
  });

  it("frees the slot when the instance's last child goes, and destroys the emptied node", () => {
    const { rt, ctx, step, system } = run({ prefab: "lamp", rate: 60, cap: 1 });
    step(2);
    const [id] = system.live("s");
    expect(id).toBeDefined();
    ctx.destroy(`${id}/bulb`);
    step(2);
    expect(system.live("s")).toEqual([id]);
    ctx.destroy(`${id}/base`);
    step(1);
    expect(ctx.exists(id!)).toBe(false);
    step(1);
    const [next] = system.live("s");
    expect(next).toBeDefined();
    expect(next).not.toBe(id);
    rt.destroy();
  });

  it("frees the slot when the instance is destroyed by its id", () => {
    const { rt, ctx, step, system } = run({ prefab: "post", rate: 60, cap: 1 });
    step(2);
    const [id] = system.live("s");
    ctx.destroy(id!);
    step(2);
    const [next] = system.live("s");
    expect(next).toBeDefined();
    expect(next).not.toBe(id);
    expect(ctx.exists(`${id}/top/bulb`)).toBe(false);
    rt.destroy();
  });

  it("ends a prefab instance's lifeMs with its node", () => {
    const { rt, ctx, step, system } = run({ prefab: "lamp", rate: 60, cap: 1, lifeMs: 100 });
    step(1);
    const [id] = system.live("s");
    step(6);
    expect(ctx.exists(id!)).toBe(false);
    expect(ctx.exists(`${id}/bulb`)).toBe(false);
    rt.destroy();
  });
});
