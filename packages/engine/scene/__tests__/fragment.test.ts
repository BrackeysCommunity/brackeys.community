import { describe, expect, it } from "vite-plus/test";

import {
  fragmentBounds,
  fragmentOf,
  fragmentSchemaFor,
  parseFragment,
  placeFragment,
  type SceneFragment,
} from "../fragment";
import { applyOps } from "../ops";
import { prefabLibrary } from "../prefab";
import { resolveScene } from "../resolve";
import type { InstanceDef, Prefab, Pt, SceneDefinition } from "../types";
import { engine, fake } from "./fixtures/fake-game";
import door from "./fixtures/prefabs/door.json";
import gate from "./fixtures/prefabs/gate.json";
import room from "./fixtures/prefabs/room.json";
import { fake as yardFake, engine as yardEngine, yardPrefabs } from "./fixtures/random-ops";

const def: SceneDefinition = {
  v: 5,
  game: "fake",
  name: "f",
  bounds: [0, 0, 1000, 1000],
  solid: [
    ["box", 100, 100, 50, 10],
    ["box", 300, 100, 50, 10],
  ],
  flag: [
    [10, 10],
    [20, 20],
  ],
  entities: [
    { id: "door", type: "door", shape: ["box", 500, 500, 10, 40], opens: "btn", speed: 60 },
    { id: "btn", type: "button", shape: ["box", 400, 540, 10, 4] },
    {
      id: "lift",
      type: "follower",
      shape: ["box", 0, 0, 40, 6],
      path: {
        pts: [
          [600, 300],
          [600, 100],
        ],
        mode: "ping_pong",
        speed: 80,
      },
    },
  ],
};

describe("fragmentOf", () => {
  it("takes entities in document order and bulk entries under their key", () => {
    const f = fragmentOf(def, ["btn", "~solid:1", "door", "~flag:0", "nope", "~nope:0"], fake);
    expect(f).toEqual({
      kind: "scene-fragment",
      v: 5,
      game: "fake",
      entities: [def.entities![0], def.entities![1]],
      bulk: { flag: [[10, 10]], solid: [["box", 300, 100, 50, 10]] },
    });
    expect(f.entities[0]).not.toBe(def.entities![0]);
    expect(fragmentSchemaFor(fake).safeParse(f).success).toBe(true);
  });

  it("leaves out empty parts", () => {
    expect(fragmentOf({ ...def, game: undefined }, ["lift"], fake)).toEqual({
      kind: "scene-fragment",
      v: 5,
      entities: [def.entities![2]],
    });
  });
});

describe("fragmentSchemaFor", () => {
  it("checks entities and bulk entries against the registry", () => {
    const schema = fragmentSchemaFor(fake);
    const base = { kind: "scene-fragment", v: 5 };
    expect(schema.safeParse({ ...base, entities: [] }).success).toBe(true);
    expect(schema.safeParse({ ...base, bulk: { pad: [["box", 0, 0, 1, 1]] } }).success).toBe(true);
    expect(schema.safeParse({ ...base, bulk: { pad: [["circle", 0, 0, 1]] } }).success).toBe(false);
    expect(schema.safeParse({ ...base, entities: [{ id: "x", type: "crate" }] }).success).toBe(
      false,
    );
    expect(schema.safeParse({ ...base, game: "other", entities: [] }).success).toBe(false);
  });
});

describe("parseFragment", () => {
  const text = JSON.stringify(fragmentOf(def, ["door", "btn", "~solid:0"], fake));

  it("round-trips copied text", () => {
    const r = parseFragment(text, fake);
    expect(r).toEqual({ ok: true, fragment: JSON.parse(text), issues: [] });
  });

  it("judges a fragment naming no game by the registry it's pasted into", () => {
    const { game: _, ...gameless } = JSON.parse(text) as Record<string, unknown>;
    const r = parseFragment(gameless, fake);
    expect(r.ok && r.fragment.game).toBe(undefined);
    expect(r.ok && r.fragment.entities.map((e) => e.type)).toEqual(["door", "button"]);
  });

  it("refuses another game's fragment", () => {
    const r = parseFragment(text, engine);
    expect(!r.ok && r.issues.map((i) => i.code)).toEqual(["unknown-game"]);
  });

  it("maps schema problems to scene issues pointing into the fragment", () => {
    const bad = {
      kind: "scene-fragment",
      v: 5,
      entities: [{ id: "door", type: "door", shape: ["box", 0, 0, 1, 1], speed: 1, sped: 2 }],
      bulk: { flag: [[1, "x"]] },
    };
    const r = parseFragment(bad, fake);
    expect(!r.ok && r.issues.map((i) => [i.code, i.path])).toEqual(
      expect.arrayContaining([
        ["unknown-key", "/entities/0/sped"],
        ["schema", "/bulk/flag/0/1"],
      ]),
    );
  });

  it("rejects text that isn't a fragment", () => {
    for (const input of ["{", "[]", '{"kind":"scene"}', { kind: "scene-fragment", v: 1, x: 1 }]) {
      const r = parseFragment(input, fake);
      expect(r.ok, JSON.stringify(input)).toBe(false);
    }
    const dup = { kind: "scene-fragment", v: 1, entities: [def.entities![1], def.entities![1]] };
    const r = parseFragment(dup, fake);
    expect(!r.ok && r.issues.map((i) => i.code)).toEqual(["dup-id"]);
  });

  it("refuses a fragment from a newer format", () => {
    const r = parseFragment({ kind: "scene-fragment", v: 99, entities: [] }, fake);
    expect(!r.ok && r.issues.map((i) => i.code)).toEqual(["version-newer"]);
  });
});

describe("fragmentBounds", () => {
  it("covers shapes, points and a path rider along its path", () => {
    const all = fragmentOf(def, ["~solid:0", "~flag:1", "lift"], fake);
    expect(fragmentBounds(all, fake)).toEqual({ minX: 20, minY: 20, maxX: 640, maxY: 306 });
    expect(fragmentBounds({ kind: "scene-fragment", v: 1, entities: [] }, fake)).toBeNull();
  });

  it("boxes an instance's children turned and flipped with it, exactly", () => {
    const prefabs = yardPrefabs();
    for (const flip of [false, true])
      for (const rot of [0, 1, 2, 3] as const) {
        const inst = { id: "gate-1", prefab: "gate", at: [100, 200] as Pt, ...turn(rot, flip) };
        const box = fragmentBounds(
          { kind: "scene-fragment", v: 5, entities: [], instances: [inst] },
          yardEngine,
          prefabs,
        )!;
        for (const n of Object.values(box)) expect(Number.isInteger(n)).toBe(true);
        const resolved = resolveScene(
          { v: 5, name: "g", bounds: [0, 0, 1000, 1000], instances: [inst] },
          yardEngine,
          prefabs,
        );
        const reference = fragmentBounds(
          { kind: "scene-fragment", v: 5, entities: resolved.entities ?? [] },
          yardEngine,
        )!;
        for (const k of ["minX", "minY", "maxX", "maxY"] as const)
          expect(box[k]).toBeCloseTo(reference[k], 9);
      }
    const flipped = fragmentBounds(
      {
        kind: "scene-fragment",
        v: 5,
        entities: [],
        instances: [{ id: "g", prefab: "gate", at: [0, 0], flip: true }],
      },
      yardEngine,
      prefabs,
    );
    expect(flipped).toEqual({ minX: -80, minY: -120, maxX: 40, maxY: 56 });
  });

  it("boxes a variant's base and nested instances' children", () => {
    const lib = prefabLibrary([
      ...yardPrefabs().values(),
      { kind: "prefab", v: 5, id: "tall-post", base: "post", entities: [] },
      {
        kind: "prefab",
        v: 5,
        id: "pair",
        entities: [],
        instances: [
          { id: "p1", prefab: "post", at: [-100, 0] },
          { id: "p2", prefab: "tall-post", at: [100, 0], rot: 90 },
        ],
      },
      ...([room, door, gate] as unknown as Prefab[]),
    ]);
    const boxOf = (inst: InstanceDef) =>
      fragmentBounds(
        { kind: "scene-fragment", v: 5, entities: [], instances: [inst] },
        yardEngine,
        lib,
      );
    const resolvedBox = (inst: InstanceDef) =>
      fragmentBounds(
        {
          kind: "scene-fragment",
          v: 5,
          entities:
            resolveScene(
              { v: 5, name: "r", bounds: [0, 0, 1, 1], instances: [inst] },
              yardEngine,
              lib,
            ).entities ?? [],
        },
        yardEngine,
      );
    const variant: InstanceDef = { id: "v", prefab: "tall-post", at: [100, 200] };
    expect(boxOf(variant)).toEqual({ minX: 94, minY: 160, maxX: 106, maxY: 240 });
    const pair: InstanceDef = { id: "n", prefab: "pair", at: [500, 500], flip: true };
    expect(boxOf(pair)).toEqual({ minX: 360, minY: 460, maxX: 606, maxY: 540 });
    const room1: InstanceDef = { id: "room-1", prefab: "room", at: [0, 0], rot: 270 };
    const own = fragmentBounds(
      { kind: "scene-fragment", v: 5, entities: [], instances: [room1] },
      yardEngine,
      prefabLibrary([{ ...(room as unknown as Prefab), instances: [] }]),
    );
    for (const inst of [variant, pair, room1]) expect(boxOf(inst)).toEqual(resolvedBox(inst));
    expect(boxOf(room1)).not.toEqual(own);
  });

  it("skips an instance whose prefab isn't given", () => {
    const f = {
      kind: "scene-fragment" as const,
      v: 5,
      entities: [],
      instances: [{ id: "g", prefab: "gate", at: [0, 0] as Pt }],
    };
    expect(fragmentBounds(f, yardEngine)).toBeNull();
    expect(fragmentBounds(f, yardEngine, new Map())).toBeNull();
  });
});

const turn = (rot: 0 | 1 | 2 | 3, flip: boolean) => ({
  ...(rot !== 0 ? { rot: 90 * rot } : {}),
  ...(flip ? { flip: true as const } : {}),
});

describe("fragments with instances", () => {
  const prefabs = yardPrefabs("fake");
  const yard: SceneDefinition = {
    v: 5,
    game: "fake",
    name: "y",
    bounds: [0, 0, 2000, 1000],
    instances: [
      {
        id: "gate-2",
        prefab: "gate",
        at: [300, 400],
        flip: true,
        z: 3,
        params: { speed: 90 },
        overrides: { "door.path.speed": 120 },
      },
      { id: "post-1", prefab: "post", at: [600, 900], parent: "raised" },
    ],
    entities: [
      { id: "lever", type: "lever", at: [10, 20], target: "gate-2/door" },
      { id: "raised", type: "node", at: [40, -20], rot: 90 },
    ],
  };

  it("copies an instance as itself and an instance's child as a plain entity", () => {
    const f = fragmentOf(yard, ["gate-2", "lever", "post-1/top"], yardFake, prefabs);
    expect(f.instances).toEqual([yard.instances![0]]);
    expect(f.entities.map((e) => e.id)).toEqual(["lever", "top"]);
    expect(f.entities[1]).toMatchObject({ type: "marker" });
    expect(fragmentSchemaFor(yardFake).safeParse(f).success).toBe(true);
  });

  it("names a copied child by its own id, refs to it following", () => {
    const f = fragmentOf(yard, ["lever", "gate-2/door", "gate-2/~solid:0"], yardFake, prefabs);
    expect(f.entities.map((e) => [e.id, e.type])).toEqual([
      ["lever", "lever"],
      ["door", "follower"],
      ["solid", "solid"],
    ]);
    expect(f.entities[0]).toMatchObject({ target: "door" });
    expect(parseFragment(f, yardFake).ok).toBe(true);
  });

  it("leaves out the child of an instance it copies", () => {
    const f = fragmentOf(yard, ["gate-2", "gate-2/door"], yardFake, prefabs);
    expect(f.entities).toEqual([]);
    expect(f.instances?.map((i) => i.id)).toEqual(["gate-2"]);
  });

  it("copies an instance under a node where it stands in the world", () => {
    const f = fragmentOf(yard, ["post-1"], yardFake, prefabs);
    // A quarter turn takes (600, 900) to (-900, 600), then the node's origin adds (40, -20).
    expect(f.instances).toEqual([{ id: "post-1", prefab: "post", at: [-860, 580], rot: 90 }]);
  });

  it("parses instances back and refuses one whose id an entity holds", () => {
    const f = fragmentOf(yard, ["gate-2", "lever"], yardFake, prefabs);
    expect(parseFragment(JSON.stringify(f), yardFake)).toEqual({
      ok: true,
      fragment: f,
      issues: [],
    });
    const clash = { ...f, entities: [{ ...f.entities[0]!, id: "gate-2" }] };
    const r = parseFragment(clash, yardFake);
    expect(!r.ok && r.issues.map((i) => i.code)).toContain("dup-id");
    const bad = parseFragment({ ...f, instances: [{ id: "g", prefab: "gate" }] }, yardFake);
    expect(bad.ok).toBe(false);
  });

  it("renames a clashing instance and the child refs into it, instantiating after the adds", () => {
    const f = fragmentOf(yard, ["gate-2", "lever"], yardFake, prefabs);
    const placed = placeFragment(f, yard, yardFake, [5, 5], prefabs);
    expect(placed.issues).toEqual([]);
    expect(placed.ops).toEqual([
      {
        op: "add",
        entity: { id: "lever-2", type: "lever", at: [15, 25], target: "gate-3/door" },
      },
      { op: "instantiate", instance: { ...yard.instances![0]!, id: "gate-3", at: [305, 405] } },
    ]);
    expect(placed.select).toEqual(["lever-2", "gate-3"]);
  });

  it("keeps a child ref into an instance the scene has, and drops one into nothing", () => {
    const lever = (target: string): SceneFragment => ({
      kind: "scene-fragment",
      v: 5,
      entities: [{ id: "l", type: "lever", at: [0, 0], target }],
    });
    const kept = placeFragment(lever("gate-2/door"), yard, yardFake, [0, 0], prefabs);
    expect(kept.issues).toEqual([]);
    expect(kept.ops[0]).toMatchObject({ entity: { target: "gate-2/door" } });
    const dropped = placeFragment(lever("gate-9/door"), yard, yardFake, [0, 0], prefabs);
    expect(dropped.issues.map((i) => i.code)).toEqual(["dangling-ref"]);
    expect(dropped.ops[0]).toEqual({ op: "add", entity: { id: "l", type: "lever", at: [0, 0] } });
  });

  it("places nothing for an instance whose prefab the project lacks", () => {
    const f: SceneFragment = {
      kind: "scene-fragment",
      v: 5,
      entities: [{ id: "lever", type: "lever", at: [0, 0], target: "arch-1/door" }],
      instances: [
        { id: "arch-1", prefab: "arch", at: [0, 0] },
        { id: "gate-9", prefab: "gate", at: [0, 0] },
      ],
    };
    const placed = placeFragment(f, { ...yard, entities: [] }, yardFake, [0, 0], prefabs);
    expect(placed.issues).toMatchObject([
      {
        code: "prefab-unknown",
        severity: "warn",
        path: "/instances/0/prefab",
        entityIds: ["arch-1"],
      },
      { code: "dangling-ref", severity: "warn" },
    ]);
    expect(placed.ops.map((o) => o.op)).toEqual(["add", "instantiate"]);
    expect(placed.select).toEqual(["lever", "gate-9"]);
    expect(placeFragment(f, yard, yardFake, [0, 0]).select).toEqual(["lever-2"]);
  });
});

describe("fragments of a tree", () => {
  const prefabs = yardPrefabs();
  const tree: SceneDefinition = {
    v: 5,
    name: "t",
    bounds: [0, 0, 2000, 1000],
    entities: [
      { id: "pen", type: "node", at: [100, 100], rot: 90 },
      { id: "peg", type: "marker", at: [10, 0], parent: "pen" },
      { id: "pip", type: "marker", at: [0, 10], parent: "peg" },
      { id: "lamp", type: "marker", at: [0, -5], parent: "post-1/top" },
      { id: "far", type: "marker", at: [900, 900] },
    ],
    instances: [{ id: "post-1", prefab: "post", at: [20, 0], parent: "pen" }],
  };
  const world = (def: SceneDefinition, id: string) =>
    resolveScene(def, yardEngine, prefabs).entities!.find((e) => e.id === id)!;
  const apply = (def: SceneDefinition, ops: PlacedOps) => {
    const r = applyOps(def, { ops }, yardEngine, { prefabs, validate: "none" });
    if (!r.ok) throw new Error(`${r.issue.code}: ${r.issue.message}`);
    return r.def;
  };
  type PlacedOps = ReturnType<typeof placeFragment>["ops"];

  it("brings a parent's subtree, children in their parents' frames", () => {
    const f = fragmentOf(tree, ["pen"], yardEngine, prefabs);
    expect(f.entities).toEqual(tree.entities!.slice(0, 4));
    expect(f.instances).toEqual(tree.instances);
  });

  it("copies a child alone where it stands in the world, under nothing", () => {
    const f = fragmentOf(tree, ["peg"], yardEngine, prefabs);
    const { parent: _parent, ...peg } = world(tree, "peg");
    expect(f.entities[0]).toEqual(peg);
    expect(f.entities[0]!.at).toEqual([100, 110]);
    // A marker's frame carries no turn, so what sits under it is rewritten to stay where it was.
    expect(f.entities[1]).toEqual({ id: "pip", type: "marker", at: [-10, 0], parent: "peg" });
    const pasted = apply(tree, placeFragment(f, tree, yardEngine, [0, 0], prefabs).ops);
    expect(world(pasted, "pip-2").at).toEqual(world(tree, "pip").at);
  });

  it("copies an instance under a parent in world coordinates, with what sits under its children", () => {
    const f = fragmentOf(tree, ["post-1"], yardEngine, prefabs);
    expect(f.instances).toEqual([{ id: "post-1", prefab: "post", at: [100, 120], rot: 90 }]);
    expect(f.entities).toEqual([tree.entities![3]]);
    const box = fragmentBounds(f, yardEngine, prefabs)!;
    const view = resolveScene(tree, yardEngine, prefabs).entities!;
    for (const id of ["lamp", "post-1/top"]) {
      const [x, y] = view.find((e) => e.id === id)!.at as Pt;
      expect([box.minX <= x && x <= box.maxX, box.minY <= y && y <= box.maxY], id).toEqual([
        true,
        true,
      ]);
    }
  });

  it("brings what sits under a copied instance child, its parent renamed with it", () => {
    const f = fragmentOf(tree, ["post-1/top"], yardEngine, prefabs);
    expect(f.entities.map((e) => [e.id, e.parent])).toEqual([
      ["lamp", "top"],
      ["top", undefined],
    ]);
  });

  it("keeps a root's own off, not the one it hides under", () => {
    const hidden = structuredClone(tree);
    hidden.entities![0]!.off = true;
    const f = fragmentOf(hidden, ["peg"], yardEngine, prefabs);
    expect(f.entities[0]!.off).toBeUndefined();
    expect(fragmentOf(hidden, ["pen"], yardEngine, prefabs).entities[0]!.off).toBe(true);
  });

  it("boxes a child where its parent puts it", () => {
    const f = fragmentOf(tree, ["pen"], yardEngine, prefabs);
    const box = fragmentBounds(f, yardEngine, prefabs)!;
    const [x, y] = world(tree, "pip").at as Pt;
    expect(box.minX).toBeLessThanOrEqual(x);
    expect(box.maxY).toBeGreaterThanOrEqual(y);
    expect(
      fragmentBounds({ ...f, entities: [f.entities[0]!, f.entities[2]!] }, yardEngine),
    ).toEqual({ minX: 0, minY: 10, maxX: 100, maxY: 100 });
  });

  it("pastes with renames, the links following and only the roots moving", () => {
    const f = fragmentOf(tree, ["pen"], yardEngine, prefabs);
    const placed = placeFragment(f, tree, yardEngine, [5, 5], prefabs);
    expect(placed.issues).toEqual([]);
    expect(placed.ops).toEqual([
      { op: "add", entity: { id: "pen-2", type: "node", at: [105, 105], rot: 90 } },
      { op: "add", entity: { id: "peg-2", type: "marker", at: [10, 0], parent: "pen-2" } },
      { op: "add", entity: { id: "pip-2", type: "marker", at: [0, 10], parent: "peg-2" } },
      {
        op: "instantiate",
        instance: { id: "post-2", prefab: "post", at: [20, 0], parent: "pen-2" },
      },
      { op: "add", entity: { id: "lamp-2", type: "marker", at: [0, -5], parent: "post-2/top" } },
    ]);
    expect(placed.ids).toEqual({
      pen: "pen-2",
      peg: "peg-2",
      pip: "pip-2",
      lamp: "lamp-2",
      "post-1": "post-2",
    });
    const after = apply(tree, placed.ops);
    for (const [from, to] of Object.entries(placed.ids)) {
      if (!after.entities!.some((e) => e.id === to)) continue;
      const [x, y] = world(tree, from).at as Pt;
      expect(world(after, to).at, to).toEqual([x + 5, y + 5]);
    }
  });

  it("places a parent before what sits under it", () => {
    const f: SceneFragment = {
      kind: "scene-fragment",
      v: 5,
      entities: [
        { id: "kid", type: "marker", at: [1, 1], parent: "box" },
        { id: "box", type: "node", at: [7, 7], parent: "post-9/top" },
      ],
      instances: [{ id: "post-9", prefab: "post", at: [50, 50] }],
    };
    const placed = placeFragment(f, tree, yardEngine, [0, 0], prefabs);
    expect(placed.select).toEqual(["post-9", "box", "kid"]);
    expect(placed.issues).toEqual([]);
  });

  it("keeps a parent the scene has and clears one into nothing, with a warning", () => {
    const f = (parent: string): SceneFragment => ({
      kind: "scene-fragment",
      v: 5,
      entities: [{ id: "m", type: "marker", at: [1, 1], parent }],
    });
    expect(placeFragment(f("pen"), tree, yardEngine, [0, 0], prefabs).ops).toEqual([
      { op: "add", entity: { id: "m", type: "marker", at: [1, 1], parent: "pen" } },
    ]);
    const dropped = placeFragment(f("gone"), tree, yardEngine, [2, 2], prefabs);
    expect(dropped.ops).toEqual([{ op: "add", entity: { id: "m", type: "marker", at: [3, 3] } }]);
    expect(dropped.issues).toMatchObject([
      { code: "dangling-ref", path: "/ops/0/entity/parent", entityIds: ["m"] },
    ]);
  });

  it("round-trips a tree through clipboard text", () => {
    const f = fragmentOf(tree, ["pen", "far"], yardEngine, prefabs);
    expect(parseFragment(JSON.stringify(f), yardEngine)).toEqual({
      ok: true,
      fragment: f,
      issues: [],
    });
  });
});
