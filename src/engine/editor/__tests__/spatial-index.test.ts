import { describe, expect, it } from "vite-plus/test";

import { createRegistry, defineGame } from "../../game/define";
import { sceneHash } from "../../scene/hash";
import { applyOps } from "../../scene/ops";
import type { OpBatch, SceneDefinition, SceneOp } from "../../scene/types";
import { roundLength } from "../../scene/units";
import yard from "../../scenes/engine-yard.json";
import sink from "../../scenes/kitchen-sink.json";
import { dropBatch, dropPreview, type AssetDrop } from "../asset-drop";
import { pickAt } from "../picking";
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
  /** The yard in metres with a sign and a barrel that carry sprites. */
  const withSprites = (): SceneDefinition => ({
    v: 3,
    name: "sprites",
    bounds: [0, 0, 20, 10],
    entities: [
      { id: "start", type: "marker", at: [3, 9.6] },
      {
        id: "sign",
        type: "marker",
        at: [6, 9.6],
        behaviors: { sprite: { size: [0.64, 0.32], anchor: [0.5, 1] } },
      },
      {
        id: "barrel",
        type: "prop",
        shape: ["circle", 8, 9.4, 0.1],
        density: 1,
        restitution: 0,
        behaviors: { sprite: { asset: "barrel" } },
      },
    ],
  });
  const r6 = (box: Record<string, number> | undefined) =>
    box && Object.fromEntries(Object.entries(box).map(([k, v]) => [k, roundLength(v)]));

  it("indexes a point entity by its sprite's box, and a body by its body and sprite", () => {
    const index = createSpatialIndex();
    index.rebuild(withSprites(), registry);
    expect(r6(index.get("sign")?.aabb)).toEqual({ minX: 5.68, minY: 9.28, maxX: 6.32, maxY: 9.6 });
    expect(index.get("sign")).toMatchObject({
      geometry: { type: "box", cx: 6, hw: 0.32, hh: 0.16 },
      sprite: { type: "box", cx: 6 },
    });
    // No asset info: the 32 × 32 px fallback, 0.32 m at 100 px per metre, wider than the 0.1 m ball.
    expect(r6(index.get("barrel")?.aabb)).toEqual({
      minX: 7.84,
      minY: 9.24,
      maxX: 8.16,
      maxY: 9.56,
    });
    expect(index.get("barrel")).toMatchObject({
      geometry: { type: "circle", cx: 8, cy: 9.4, r: 0.1 },
    });
    expect(
      index.query({ minX: 8.12, minY: 9.25, maxX: 8.13, maxY: 9.26 }).map((e) => e.ref),
    ).toEqual(["barrel"]);
    // Entities without sprites are as before.
    expect(index.get("start")).toMatchObject({ geometry: [3, 9.6] });
  });

  it("sizes sprite boxes from the asset lookup", () => {
    const index = createSpatialIndex({
      asset: (id) =>
        id === "barrel" ? { id, kind: "texture", size: [40, 20], pivot: [0.5, 1] } : undefined,
    });
    index.rebuild(withSprites(), registry);
    expect(r6(index.get("barrel")?.aabb)).toEqual({ minX: 7.8, minY: 9.2, maxX: 8.2, maxY: 9.5 });
  });

  it("keeps sprite boxes current through updates", () => {
    let def = withSprites();
    const index = createSpatialIndex();
    index.rebuild(def, registry);
    const result = apply(def, [
      { op: "update", ref: "sign", set: { behaviors: { sprite: { size: [0.16, 0.16] } } } },
      { op: "move", refs: ["barrel"], by: [1, 0] },
    ]);
    def = result.def;
    index.update(def, registry, result.touched);
    expectSameAsRebuild(index, def);
    expect(r6(index.get("sign")?.aabb)).toEqual({ minX: 5.92, minY: 9.52, maxX: 6.08, maxY: 9.68 });
    expect(roundLength(index.get("barrel")!.aabb.minX)).toBe(8.84);
  });
});

describe("the kitchen sink's sprites", () => {
  const def = () => structuredClone(sink) as unknown as SceneDefinition;

  it("carries the crate's sprite box on its entry, which picking hits past the body", () => {
    const index = createSpatialIndex();
    index.rebuild(def(), registry);
    const crate = index.get("crate");
    expect(crate?.sprite).toEqual({ type: "box", cx: 880, cy: 1140, hw: 36, hh: 36, rotDeg: 0 });
    expect(crate?.aabb).toEqual({ minX: 844, minY: 1104, maxX: 916, maxY: 1176 });
    // Outside the 40 px body, inside the 72 px sprite.
    expect(pickAt(index, [910, 1140], { tolPx: 0, scale: 1 }).map((e) => e.ref)).toContain("crate");
    expect(pickAt(index, [920, 1140], { tolPx: 0, scale: 1 }).map((e) => e.ref)).not.toContain(
      "crate",
    );
  });

  it("draws a dropped frame's ghost on the box the placed entity's entry carries", () => {
    const drop: AssetDrop = {
      entry: {
        key: "k-crates",
        id: "crates",
        kind: "atlas",
        path: "art/crates.json",
        created: { at: 0, by: "t" },
      },
      info: { id: "crates", kind: "atlas", size: [24, 24] },
      frame: "crate-0",
    };
    const asset = (id: string) => (id === "crates" ? drop.info : undefined);
    const scene = def();
    const preview = dropPreview(drop, [1200, 400], { def: scene, registry, asset });
    const placed = dropBatch(drop, [1200, 400], { def: scene, registry });
    if (!placed.ok) throw new Error("the drop was refused");
    const after = applyOps(scene, placed.batch, registry, { validate: "none" });
    if (!after.ok) throw new Error(after.issue.message);
    const index = createSpatialIndex({ asset });
    index.rebuild(after.def, registry);
    const entry = index.get(placed.select[0]!);
    expect(entry?.sprite).toBeDefined();
    expect(preview.ghosts.map((g) => g.shape)).toEqual([entry!.sprite]);
  });
});
