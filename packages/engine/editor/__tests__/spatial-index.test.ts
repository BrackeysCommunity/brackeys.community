import { describe, expect, it } from "vite-plus/test";

import { createRegistry, defineGame } from "../../game/define";
import { sceneHash } from "../../scene/hash";
import { applyOps } from "../../scene/ops";
import type { OpBatch, SceneDefinition, SceneOp } from "../../scene/types";
import { roundLength } from "../../scene/units";
import yard from "../../scenes/engine-yard.json";
import sink from "../../scenes/kitchen-sink.json";
import { dropBatch, dropPreview, type AssetDrop } from "../asset-drop";
import * as tree from "../gizmos/__tests__/tree-fixture";
import { pickAt } from "../picking";
import { createSpatialIndex, type EditableSpatialIndex } from "../spatial-index";

const registry = createRegistry();
const engineYard = () => structuredClone(yard) as unknown as SceneDefinition;

/** The yard plus a row of 40 small solids and a disabled entity. */
function crowdedYard(): SceneDefinition {
  const def = engineYard();
  const solid = def.solid as unknown[];
  for (let i = 0; i < 40; i++) solid.push(["box", 1 + i * 0.4, 7, 0.16, 0.08]);
  def.entities!.push({ id: "spare", type: "solid", shape: ["circle", 6, 3, 0.3], off: true });
  return def;
}

function apply(def: SceneDefinition, ops: SceneOp[]) {
  const batch: OpBatch = { base: sceneHash(def), ops };
  const result = applyOps(def, batch, registry);
  if (!result.ok) throw new Error(result.issue.message);
  return result;
}

/** A box's numeric fields rounded to the scene's length precision. */
const r6 = (box: object | undefined) =>
  box &&
  Object.fromEntries(
    Object.entries(box)
      .filter((kv): kv is [string, number] => typeof kv[1] === "number")
      .map(([k, v]) => [k, roundLength(v)]),
  );

const snapshot = (index: EditableSpatialIndex) =>
  index.entries().sort((a, b) => (a.ref < b.ref ? -1 : 1));

function expectSameAsRebuild(index: EditableSpatialIndex, def: SceneDefinition) {
  const fresh = createSpatialIndex();
  fresh.rebuild(def, registry);
  expect(snapshot(index)).toEqual(snapshot(fresh));
  expect(index.size).toBe(fresh.size);
  for (const rect of [
    { minX: 0, minY: 6, maxX: 9, maxY: 8 },
    { minX: 15, minY: 0, maxX: 20, maxY: 10 },
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
    });
    expect(r6(index.get("~solid:0")?.aabb)).toEqual({ minX: 0, minY: 9.6, maxX: 20, maxY: 10 });
    // A follower's local shape sits at its path's first point.
    expect(index.get("lift")).toMatchObject({
      layer: "gameplay",
      geometry: { type: "box", cx: 17, cy: 9 },
    });
    expect(r6(index.get("lift")?.aabb)).toEqual({ minX: 16.4, minY: 8.92, maxX: 17.6, maxY: 9.08 });
    expect(index.get("start")).toMatchObject({
      geometry: [3, 9.6],
      aabb: { minX: 3, maxX: 3 },
    });
    expect(index.get("readme")?.layer).toBe("editor");
  });

  it("stacks by layer, then document order", () => {
    const def = engineYard();
    def.entities!.find((e) => e.id === "zone")!.layer = "decor";
    const index = createSpatialIndex();
    index.rebuild(def, registry);
    const hits = index.query({ minX: 8.8, minY: 9.5, maxX: 9.2, maxY: 9.7 }).map((e) => e.ref);
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

  it("marks camera regions, and only them", () => {
    const index = createSpatialIndex();
    index.rebuild(structuredClone(sink) as unknown as SceneDefinition, registry);
    expect(index.get("framing")?.region).toBe(true);
    expect(
      index
        .entries()
        .filter((e) => e.region)
        .map((e) => e.ref),
    ).toEqual(["framing"]);
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
    const index = createSpatialIndex({ cell: 0.64 });
    const def = engineYard();
    (def.solid as unknown[]).push(["box", 0, 0, 1e4, 0.1]);
    index.rebuild(def, registry);
    expect(index.query({ minX: 5, minY: -0.05, maxX: 5.01, maxY: 0.05 }).map((e) => e.ref)).toEqual(
      ["~solid:3"],
    );
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
          entity: { id: "pad", type: "sensor", shape: ["box", 6.4, 6.4, 0.32, 0.32] },
          index: 0,
        },
        { op: "addBulk", key: "solid", shapes: [["circle", 10, 2, 0.4]], index: 0 },
      ],
      [{ op: "move", refs: ["~solid:5", "lift", "start"], by: [3, -0.64] }],
      [{ op: "remove", refs: ["~solid:2", "~solid:30", "crate"] }],
      [
        {
          op: "update",
          ref: "ledge",
          set: { layer: "decor", shape: ["box", 14, 8.2, 1.6, 0.1, 15] },
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
    expect(r6(crate?.sprite)).toEqual({
      cx: 8.8,
      cy: 11.4,
      hw: 0.36,
      hh: 0.36,
      rotDeg: 0,
    });
    expect(crate?.sprite?.type).toBe("box");
    expect(r6(crate?.aabb)).toEqual({ minX: 8.44, minY: 11.04, maxX: 9.16, maxY: 11.76 });
    // Outside the 0.4 m body, inside the 0.72 m sprite; screen px per metre at zoom 1.
    const at = (p: [number, number]) =>
      pickAt(index, p, { tolPx: 0, scale: 100 }).map((e) => e.ref);
    expect(at([9.1, 11.4])).toContain("crate");
    expect(at([9.2, 11.4])).not.toContain("crate");
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
    const preview = dropPreview(drop, [12, 4], { def: scene, registry, asset });
    const placed = dropBatch(drop, [12, 4], { def: scene, registry });
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

describe("the index by the tree", () => {
  const { registry: reg, doc, source, view, viewOf } = tree;
  const indexed = (def = view, src = source) => {
    const index = createSpatialIndex();
    index.rebuild(def, reg, src);
    return index;
  };
  const moved = (refs: string[], by: [number, number]) => {
    const result = applyOps(doc, { ops: [{ op: "move", refs, by }] }, reg, {
      prefabs: tree.prefabs,
    });
    if (!result.ok) throw new Error(result.issue.message);
    return result.def;
  };

  it("indexes a node as a point at its origin", () => {
    expect(indexed().get("tilt")).toMatchObject({
      type: "node",
      geometry: [10, 5],
      aabb: { minX: 10, minY: 5, maxX: 10, maxY: 5 },
    });
  });

  it("gives each instance an entry over its subtree, and its children the instances they sit in", () => {
    const index = indexed();
    const inst = index.get("turret-a")!;
    expect(inst).toMatchObject({ instance: true, type: "node", layer: "gameplay" });
    // Its two parts, and the document's flag under its barrel.
    expect(inst.aabb).toEqual({ minX: 1.6, minY: 5.2, maxX: 3, maxY: 6 });
    expect(index.get("turret-a/base")!.instances).toEqual(["turret-a"]);
    expect(index.get("flag")!.instances).toBeUndefined();
    expect(index.get("lone")!.instances).toBeUndefined();
    // Under the node, with the document; without it the view can't tell.
    expect(index.get("tilt-turret")!.aabb).toEqual({ minX: 10.6, minY: 4.4, maxX: 12, maxY: 5 });
    expect(indexed(view, undefined).get("tilt-turret")).toBeDefined();
  });

  it("stacks an instance's entry with the topmost entry under it", () => {
    const index = indexed();
    const zs = ["turret-a/base", "turret-a/barrel", "flag"].map((r) => index.get(r)!.z);
    expect(index.get("turret-a")!.z).toBe(Math.max(...zs));
  });

  it("re-indexes a touched parent with its subtree, and the instances' entries over it", () => {
    for (const [refs, by] of [
      [["tilt"], [1, 0]],
      [["turret-a"], [0, -1]],
      [["tilt-board"], [0.5, 0.5]],
    ] as const) {
      const index = indexed();
      const next = moved([...refs], [...by] as [number, number]);
      const src = { ...source, doc: next };
      index.update(viewOf(next), reg, [...refs], src);
      expect(snapshot(index)).toEqual(snapshot(indexed(viewOf(next), src)));
    }
  });

  it("rewrites only the instance entries over what an update touched", () => {
    const applied = (ops: SceneOp[]) => {
      const result = applyOps(doc, { ops }, reg, { prefabs: tree.prefabs });
      if (!result.ok) throw new Error(result.issue.message);
      return result.def;
    };
    const instances = ["turret-a", "tilt-turret"];
    for (const [ops, refs, rewritten] of [
      [[{ op: "move", refs: ["lone"], by: [1, 0] }], ["lone"], []],
      [[{ op: "move", refs: ["tilt"], by: [1, 0] }], ["tilt"], ["tilt-turret"]],
      [[{ op: "move", refs: ["flag"], by: [0, -1] }], ["flag"], ["turret-a"]],
      [[{ op: "reparent", refs: ["flag"], parent: null }], ["flag"], ["turret-a"]],
      [[{ op: "reparent", refs: ["lone"], parent: "turret-a/barrel" }], ["lone"], ["turret-a"]],
    ] as [SceneOp[], string[], string[]][]) {
      const index = indexed();
      const before = new Map(instances.map((r) => [r, index.get(r)]));
      const next = applied(ops);
      const src = { ...source, doc: next };
      index.update(viewOf(next), reg, refs, src);
      expect(instances.filter((r) => index.get(r) !== before.get(r))).toEqual(rewritten);
      expect(snapshot(index)).toEqual(snapshot(indexed(viewOf(next), src)));
    }
  });

  it("drops an instance's entries with it", () => {
    const index = indexed();
    const result = applyOps(doc, { ops: [{ op: "remove", refs: ["turret-a"] }] }, reg, {
      prefabs: tree.prefabs,
    });
    if (!result.ok) throw new Error(result.issue.message);
    const src = { ...source, doc: result.def };
    index.update(viewOf(result.def), reg, ["turret-a"], src);
    expect(index.get("turret-a")).toBeUndefined();
    expect(index.get("turret-a/base")).toBeUndefined();
    expect(snapshot(index)).toEqual(snapshot(indexed(viewOf(result.def), src)));
  });
});
