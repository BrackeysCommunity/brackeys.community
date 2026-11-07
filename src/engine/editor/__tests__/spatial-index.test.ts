import { describe, expect, it } from "vite-plus/test";

import { createRegistry } from "../../game/define";
import { sceneHash } from "../../scene/hash";
import { applyOps } from "../../scene/ops";
import type { OpBatch, SceneDefinition, SceneOp } from "../../scene/types";
import yard from "../../scenes/engine-yard.json";
import { createSpatialIndex, defaultLayer, type EditableSpatialIndex } from "../spatial-index";

const registry = createRegistry();
const engineYard = () => structuredClone(yard) as unknown as SceneDefinition;

/** The yard plus a row of 40 small solids and a disabled entity. */
function crowdedYard(): SceneDefinition {
  const def = engineYard();
  const solid = def.solid as unknown[];
  for (let i = 0; i < 40; i++) solid.push(["box", 100 + i * 40, 700, 16, 8]);
  def.entities!.push({ id: "spare", type: "solid", shape: ["circle", 600, 300, 30], off: true });
  return def;
}

function apply(def: SceneDefinition, ops: SceneOp[]) {
  const batch: OpBatch = { base: sceneHash(def), ops };
  const result = applyOps(def, batch, registry);
  if (!result.ok) throw new Error(result.issue.message);
  return result;
}

const snapshot = (index: EditableSpatialIndex) =>
  index.entries().sort((a, b) => (a.ref < b.ref ? -1 : 1));

function expectSameAsRebuild(index: EditableSpatialIndex, def: SceneDefinition) {
  const fresh = createSpatialIndex();
  fresh.rebuild(def, registry);
  expect(snapshot(index)).toEqual(snapshot(fresh));
  expect(index.size).toBe(fresh.size);
  for (const rect of [
    { minX: 0, minY: 600, maxX: 900, maxY: 800 },
    { minX: 1500, minY: 0, maxX: 2000, maxY: 1000 },
    { minX: -1e6, minY: -1e6, maxX: 1e6, maxY: 1e6 },
  ]) {
    expect(index.query(rect).map((e) => e.ref)).toEqual(fresh.query(rect).map((e) => e.ref));
  }
}

describe("createSpatialIndex", () => {
  it("indexes bulk entries, shapes and points with the renderers' geometry", () => {
    const index = createSpatialIndex();
    index.rebuild(engineYard(), registry);
    expect(index.size).toBe(10);
    expect(index.get("~solid:0")).toMatchObject({
      key: "~solid:0",
      type: "solid",
      layer: "terrain",
      aabb: { minX: 0, minY: 960, maxX: 2000, maxY: 1000 },
    });
    // A follower's local shape sits at its path's first point.
    expect(index.get("lift")).toMatchObject({
      layer: "gameplay",
      aabb: { minX: 1640, minY: 892, maxX: 1760, maxY: 908 },
      geometry: { type: "box", cx: 1700, cy: 900 },
    });
    expect(index.get("start")).toMatchObject({
      geometry: [300, 960],
      aabb: { minX: 300, maxX: 300 },
    });
    expect(index.get("readme")?.layer).toBe("editor");
  });

  it("stacks by layer, then document order", () => {
    const def = engineYard();
    def.entities!.find((e) => e.id === "zone")!.layer = "decor";
    const index = createSpatialIndex();
    index.rebuild(def, registry);
    const hits = index.query({ minX: 880, minY: 950, maxX: 920, maxY: 970 }).map((e) => e.ref);
    expect(hits).toEqual(["zone", "~solid:0"]);
    const z = (ref: string) => index.get(ref)!.z;
    expect(z("~solid:1")).toBeGreaterThan(z("~solid:0"));
    expect(z("avatar")).toBeGreaterThan(z("ledge"));
    expect(z("readme")).toBeGreaterThan(z("zone"));
  });

  it("defaults layers by kind", () => {
    expect(defaultLayer(registry.types.get("note"), false)).toBe("editor");
    expect(defaultLayer(registry.types.get("solid"), true)).toBe("terrain");
    expect(defaultLayer(registry.types.get("solid"), false)).toBe("gameplay");
  });

  it("keeps disabled entities and skips shapes that don't parse", () => {
    const def = crowdedYard();
    def.entities!.push({ id: "broken", type: "solid", shape: ["box", 0, 0] });
    const index = createSpatialIndex();
    index.rebuild(def, registry);
    expect(index.get("spare")).toBeDefined();
    expect(index.get("broken")).toBeUndefined();
  });

  it("finds wide entries from any cell, and narrow ones only where they are", () => {
    const index = createSpatialIndex({ cell: 64 });
    const def = engineYard();
    (def.solid as unknown[]).push(["box", 0, 0, 1e6, 10]);
    index.rebuild(def, registry);
    expect(index.query({ minX: 500, minY: -5, maxX: 501, maxY: 5 }).map((e) => e.ref)).toEqual([
      "~solid:3",
    ]);
  });

  it("uses the session's doc keys when given", () => {
    const index = createSpatialIndex({ keyOf: (ref) => (ref === "lift" ? "k-lift" : undefined) });
    index.rebuild(engineYard(), registry);
    expect(index.get("lift")?.key).toBe("k-lift");
    expect(index.get("crate")?.key).toBe("crate");
  });

  it("matches a rebuild after add, move and remove batches", () => {
    let def = crowdedYard();
    const index = createSpatialIndex();
    index.rebuild(def, registry);
    const steps: SceneOp[][] = [
      [
        {
          op: "add",
          entity: { id: "pad", type: "sensor", shape: ["box", 640, 640, 32, 32] },
          index: 0,
        },
        { op: "addBulk", key: "solid", shapes: [["circle", 1000, 200, 40]], index: 0 },
      ],
      [{ op: "move", refs: ["~solid:5", "lift", "start"], by: [300, -64] }],
      [{ op: "remove", refs: ["~solid:2", "~solid:30", "crate"] }],
      [
        {
          op: "update",
          ref: "ledge",
          set: { layer: "decor", shape: ["box", 1400, 820, 160, 10, 15] },
        },
      ],
      [{ op: "rename", from: "avatar", to: "hero" }],
      [{ op: "promote", ref: "~solid:0", id: "floor" }],
      [{ op: "remove", refs: ["~solid:0", "~solid:1", "~solid:2"] }],
    ];
    for (const ops of steps) {
      const result = apply(def, ops);
      def = result.def;
      index.update(def, registry, result.touched);
      expectSameAsRebuild(index, def);
    }
    expect(index.get("avatar")).toBeUndefined();
    expect(index.get("hero")).toBeDefined();
    expect(index.get("ledge")?.layer).toBe("decor");
  });

  it("rebuilds when nothing names what was touched", () => {
    const index = createSpatialIndex();
    index.rebuild(engineYard(), registry);
    const next = engineYard();
    next.entities = next.entities!.filter((e) => e.id !== "zone");
    index.update(next, registry, []);
    expect(index.get("zone")).toBeUndefined();
    expectSameAsRebuild(index, next);
  });
});
