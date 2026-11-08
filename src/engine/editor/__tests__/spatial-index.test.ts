import { describe, expect, it } from "vite-plus/test";

import { createRegistry, defineGame } from "../../game/define";
import { sceneHash } from "../../scene/hash";
import { applyOps } from "../../scene/ops";
import type { OpBatch, SceneDefinition, SceneOp } from "../../scene/types";
import yard from "../../scenes/engine-yard.json";
import { createSpatialIndex, type EditableSpatialIndex } from "../spatial-index";

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

  it("stacks decor under gameplay, as the registry's layers run", () => {
    const def = engineYard();
    def.entities!.find((e) => e.id === "zone")!.layer = "decor";
    const index = createSpatialIndex();
    index.rebuild(def, registry);
    const z = (ref: string) => index.get(ref)!.z;
    expect(z("zone")).toBeLessThan(z("avatar"));
    expect(z("zone")).toBeGreaterThan(z("~solid:0"));
  });

  it("stacks by z within a layer, then document order, and updates with it", () => {
    const def = engineYard();
    const index = createSpatialIndex();
    index.rebuild(def, registry);
    const z = (ref: string) => index.get(ref)!.z;
    expect(z("avatar")).toBeGreaterThan(z("ledge"));
    const lowered = apply(def, [{ op: "update", ref: "avatar", set: { z: -1 } }]);
    index.update(lowered.def, registry, lowered.touched);
    expect(z("avatar")).toBeLessThan(z("ledge"));
    expectSameAsRebuild(index, lowered.def);
    const raised = apply(lowered.def, [{ op: "update", ref: "ledge", set: { z: 10000 } }]);
    index.update(raised.def, registry, raised.touched);
    expect(z("ledge")).toBeGreaterThan(z("avatar"));
    expect(z("ledge")).toBeLessThan(z("readme"));
  });

  it("orders a game's own layers and defaults through them", () => {
    const layered = createRegistry(
      defineGame({
        id: "layered",
        types: [],
        actions: [],
        createRuntime: () => ({ snapshot: () => null }),
        layers: [
          { name: "back", description: "Behind.", draw: 0 },
          { name: "front", description: "In front.", draw: 10 },
          { name: "notes", description: "Helpers.", draw: 60, editorOnly: true },
        ],
      }),
    );
    const def: SceneDefinition = {
      v: 2,
      name: "layered",
      bounds: [0, 0, 1000, 1000],
      solid: [["box", 500, 500, 400, 400]],
      entities: [
        { id: "far", type: "solid", layer: "back", shape: ["box", 500, 500, 10, 10], z: 50 },
        { id: "near", type: "solid", layer: "front", shape: ["box", 500, 500, 10, 10], z: -50 },
        { id: "plain", type: "solid", shape: ["box", 500, 500, 10, 10] },
        { id: "stray", type: "solid", layer: "terrain", shape: ["box", 500, 500, 10, 10] },
        { id: "memo", type: "note", at: [500, 500], text: "hi" },
      ],
    };
    const index = createSpatialIndex();
    index.rebuild(def, layered);
    expect(index.get("~solid:0")?.layer).toBe("back");
    expect(index.get("plain")?.layer).toBe("back");
    expect(index.get("stray")?.layer).toBe("back");
    expect(index.get("memo")?.layer).toBe("notes");
    expect(index.query({ minX: 499, minY: 499, maxX: 501, maxY: 501 }).map((e) => e.ref)).toEqual([
      "memo",
      "near",
      "far",
      "stray",
      "plain",
      "~solid:0",
    ]);
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

describe("sprite boxes", () => {
  const withSprites = (): SceneDefinition => {
    const def = engineYard();
    def.entities!.push(
      {
        id: "sign",
        type: "marker",
        at: [600, 960],
        behaviors: { sprite: { size: [64, 32], anchor: [0.5, 1] } },
      },
      {
        id: "barrel",
        type: "prop",
        shape: ["circle", 800, 940, 10],
        density: 1,
        restitution: 0,
        behaviors: { sprite: { asset: "barrel" } },
      },
    );
    return def;
  };

  it("indexes a point entity by its sprite's box, and a body by its body and sprite", () => {
    const index = createSpatialIndex();
    index.rebuild(withSprites(), registry);
    expect(index.get("sign")).toMatchObject({
      aabb: { minX: 568, minY: 928, maxX: 632, maxY: 960 },
      geometry: { type: "box", cx: 600, cy: 944, hw: 32, hh: 16 },
      sprite: { type: "box", cx: 600, cy: 944 },
    });
    // No asset info: the 32×32 fallback, wider than the 10px ball.
    expect(index.get("barrel")).toMatchObject({
      aabb: { minX: 784, minY: 924, maxX: 816, maxY: 956 },
      geometry: { type: "circle", cx: 800, cy: 940, r: 10 },
    });
    expect(index.query({ minX: 812, minY: 925, maxX: 813, maxY: 926 }).map((e) => e.ref)).toEqual([
      "barrel",
    ]);
    // Entities without sprites are as before.
    expect(index.get("start")).toMatchObject({ geometry: [300, 960] });
  });

  it("sizes sprite boxes from the asset lookup", () => {
    const index = createSpatialIndex({
      asset: (id) =>
        id === "barrel" ? { id, kind: "texture", size: [40, 20], pivot: [0.5, 1] } : undefined,
    });
    index.rebuild(withSprites(), registry);
    expect(index.get("barrel")?.aabb).toEqual({ minX: 780, minY: 920, maxX: 820, maxY: 950 });
  });

  it("keeps sprite boxes current through updates", () => {
    let def = withSprites();
    const index = createSpatialIndex();
    index.rebuild(def, registry);
    const result = apply(def, [
      { op: "update", ref: "sign", set: { behaviors: { sprite: { size: [16, 16] } } } },
      { op: "move", refs: ["barrel"], by: [100, 0] },
    ]);
    def = result.def;
    index.update(def, registry, result.touched);
    expectSameAsRebuild(index, def);
    expect(index.get("sign")?.aabb).toEqual({ minX: 592, minY: 952, maxX: 608, maxY: 968 });
    expect(index.get("barrel")?.aabb.minX).toBe(884);
  });
});
