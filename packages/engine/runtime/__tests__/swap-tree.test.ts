import { describe, expect, it } from "vite-plus/test";

import { swapped } from "../../__tests__/fixtures/live-version";
import { testGame } from "../../__tests__/fixtures/test-game";
import { defineGame } from "../../game/define";
import type { ExpandedScene, RuntimeEntity } from "../../scene/types";
import { createSceneRuntime } from "../runtime";
import type { SceneRuntimeHandle } from "../types";

const marker = (id: string, at: [number, number], extra: Partial<RuntimeEntity> = {}) =>
  ({ id, type: "marker", at, ...extra }) as RuntimeEntity;

/**
 * base ─┬─ arm ── hand
 *       └─ leg
 * loose
 */
const ENTITIES: RuntimeEntity[] = [
  marker("base", [1, 1]),
  marker("arm", [3, 1], { parent: "base" }),
  marker("hand", [4, 1], { parent: "arm" }),
  marker("leg", [1, 3], { parent: "base" }),
  marker("loose", [-5, -5]),
];

const scene = (entities: RuntimeEntity[]): ExpandedScene => ({
  name: "swap-tree",
  bounds: [-20, -20, 20, 20],
  settings: { gravity: [0, 0], physics: "none", grid: null, view: { projection: "orthogonal" } },
  entities,
});

/** `entities` with `id`'s record changed by `patch`. */
const edited = (id: string, patch: Partial<RuntimeEntity>) =>
  ENTITIES.map((e) => (e.id === id ? ({ ...e, ...patch } as RuntimeEntity) : e));

/** The test game; `base` slides and turns every tick, carrying its children. */
const game = defineGame({
  ...testGame,
  createRuntime: (ctx) => ({
    beforeStep() {
      const t = ctx.tick;
      ctx.setPose("base", 1 + t * 0.05, 1, t * 0.01);
    },
    snapshot: () => null,
    restore: () => {},
  }),
});

function started(ticks = 30): SceneRuntimeHandle {
  const rt = createSceneRuntime({ rapier: null, view: null, game });
  expect(rt.load(scene(ENTITIES), undefined, { sceneId: "swap-tree" })).toMatchObject({
    ok: true,
  });
  for (let i = 0; i < ticks; i++) rt.step(rt.ctx.time.tickMs, []);
  return rt;
}

const poseOf = (rt: SceneRuntimeHandle, id: string) => {
  const p = rt.ctx.poses.get(id)!;
  return { x: p.x, y: p.y, rot: p.rot };
};

describe("a live swap in the scene tree", () => {
  it("that reparents an entity takes its authored pose under the new parent", () => {
    const rt = started();
    expect(poseOf(rt, "arm").x).not.toBeCloseTo(3);
    const report = swapped(
      rt.swap(scene(edited("arm", { parent: "loose" })), { prefabs: new Map() }),
    );
    expect(report.strategy).toBe("reconcile");
    expect(rt.ctx.tree.parent("arm")).toBe("loose");
    expect(rt.ctx.tree.children("base")).toEqual(["leg"]);
    expect(rt.ctx.tree.children("arm")).toEqual(["hand"]);
    expect(poseOf(rt, "arm")).toEqual({ x: 3, y: 1, rot: 0 });

    rt.ctx.setPose("loose", -4, -5, 0);
    expect(poseOf(rt, "arm").x).toBeCloseTo(4);
    expect(poseOf(rt, "arm").y).toBeCloseTo(1);
  });

  it("that leaves the parent alone keeps the live pose", () => {
    const rt = started();
    const live = poseOf(rt, "arm");
    swapped(rt.swap(scene(edited("arm", { tags: ["lit"] })), { prefabs: new Map() }));
    expect(rt.ctx.tree.parent("arm")).toBe("base");
    expect(rt.ctx.tree.children("base")).toEqual(["arm", "leg"]);
    expect(poseOf(rt, "arm")).toEqual(live);

    const offset = rt.ctx.tree.local("arm")!;
    rt.step(rt.ctx.time.tickMs, []);
    const base = poseOf(rt, "base");
    const c = Math.cos(base.rot);
    const s = Math.sin(base.rot);
    expect(poseOf(rt, "arm").x).toBeCloseTo(base.x + offset.x * c - offset.y * s);
    expect(poseOf(rt, "arm").y).toBeCloseTo(base.y + offset.x * s + offset.y * c);
  });

  it("that moves an entity to a root keeps its children under it", () => {
    const rt = started();
    const { parent: _parent, ...rooted } = ENTITIES[1]!;
    swapped(
      rt.swap(scene(ENTITIES.map((e) => (e.id === "arm" ? (rooted as RuntimeEntity) : e))), {
        prefabs: new Map(),
      }),
    );
    expect(rt.ctx.tree.parent("arm")).toBeNull();
    expect(rt.ctx.tree.parent("hand")).toBe("arm");
    expect(poseOf(rt, "arm")).toEqual({ x: 3, y: 1, rot: 0 });
  });
});

describe("the edit world in the scene tree", () => {
  it("makes a removed parent's remaining children roots, switched back on when only it was off", () => {
    const rt = started(5);
    rt.ctx.setEnabled("base", false);
    expect(rt.ctx.enabled("arm")).toBe(false);
    rt.remove(["base"]);
    expect(rt.ctx.tree.parent("arm")).toBeNull();
    expect(rt.ctx.tree.parent("leg")).toBeNull();
    expect(rt.ctx.tree.parent("hand")).toBe("arm");
    expect([rt.ctx.enabled("arm"), rt.ctx.enabled("hand"), rt.ctx.enabled("leg")]).toEqual([
      true,
      true,
      true,
    ]);
  });

  it("adding a parent back takes in the live entities whose record names it", () => {
    const rt = started(5);
    rt.remove(["arm"]);
    expect(rt.ctx.tree.parent("hand")).toBeNull();
    expect(rt.add([ENTITIES[1]!])).toEqual({ ok: true });
    expect(rt.ctx.tree.parent("arm")).toBe("base");
    expect(rt.ctx.tree.parent("hand")).toBe("arm");
    expect(rt.ctx.tree.children("base")).toEqual(["leg", "arm"]);
  });

  it("an update that names a new parent relinks the entity, and refuses a cycle", () => {
    const rt = started(5);
    expect(rt.update(edited("leg", { parent: "loose" }))).toEqual({ ok: true });
    expect(rt.ctx.tree.parent("leg")).toBe("loose");
    expect(rt.ctx.tree.children("loose")).toEqual(["leg"]);

    const refused = rt.update(edited("base", { parent: "hand" }));
    expect(refused).toMatchObject({ ok: false, entityId: "base" });
    expect(rt.ctx.tree.parent("base")).toBeNull();
  });
});
