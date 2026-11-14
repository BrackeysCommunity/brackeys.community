import { describe, expect, it } from "vite-plus/test";

import { createRegistry, defineEntityType, defineGame } from "../../game/define";
import { pointField, shapeField } from "../../game/fields";
import { sceneHash } from "../../scene/hash";
import {
  SCENE_FORMAT_VERSION,
  type Prefab,
  type PrefabLibrary,
  type SceneDefinition,
} from "../../scene/types";
import {
  buildOutline,
  buildTreeOutline,
  outlineOrder,
  promotedRefs,
  treeDragRoots,
  treeDropBatch,
  treeDropRefusal,
} from "../outline";

const registry = createRegistry(
  defineGame({
    id: "pegs",
    types: [
      defineEntityType({
        type: "peg",
        description: "A point to hang from.",
        base: "marker",
        fields: { at: pointField("Peg position.") },
        bulk: { form: "point", description: "Pegs." },
        inspector: { label: "Peg" },
      }),
    ],
    materials: { ice: { friction: 0.05, restitution: 0, description: "Slippery." } },
    actions: [],
    createRuntime: () => ({ snapshot: () => null }),
  }),
);

const def: SceneDefinition = {
  v: 1,
  game: "pegs",
  name: "o",
  bounds: [0, 0, 100, 100],
  solid: [
    ["box", 0, 0, 1, 1],
    ["chain", 0, 0, 5, 5],
  ],
  "solid:ice": [["box", 9, 9, 4, 2]],
  peg: [[3, 3]],
  entities: [
    { id: "hook", type: "peg", at: [1, 1] },
    {
      id: "lift",
      type: "follower",
      shape: ["box", 0, 0, 4, 1],
      path: {
        pts: [
          [0, 0],
          [9, 0],
        ],
        mode: "loop",
        speed: 10,
      },
    },
    { id: "wall", type: "solid", shape: ["box", 0, 0, 1, 9], material: "ice" },
    { id: "tip", type: "note", at: [0, 0], text: "hi" },
    { id: "vine", type: "solid", shape: ["box", 1, 1, 1, 1], name: "Vine", off: true },
  ],
};

describe("buildOutline", () => {
  const rows = buildOutline(def, registry);

  it("has one group per registered type in use, in registration order, with counts", () => {
    expect(rows.filter((r) => r.kind === "type").map((r) => [r.label, r.count])).toEqual([
      ["solid", 5],
      ["follower", 1],
      ["note", 1],
      ["Peg", 2],
    ]);
  });

  it("puts a type's bulk keys with child rows first, then its entities", () => {
    const solid = rows.slice(
      1,
      rows.findIndex((r) => r.key === "type:follower"),
    );
    expect(solid.map((r) => [r.key, r.depth])).toEqual([
      ["bucket:solid", 1],
      ["ref:~solid:0", 2],
      ["ref:~solid:1", 2],
      ["bucket:solid:ice", 1],
      ["ref:~solid:ice:0", 2],
      ["ref:wall", 1],
      ["ref:vine", 1],
    ]);
    expect(solid[0]).toMatchObject({ kind: "bucket", label: "solid", count: 2, type: "solid" });
    expect(solid[2]).toMatchObject({ kind: "entity", ref: "~solid:1", detail: "chain" });
    expect(rows.find((r) => r.key === "ref:~peg:0")).toMatchObject({ detail: "3, 3", type: "peg" });
  });

  it("labels entities by name and details them by geometry, material and off", () => {
    expect(rows.find((r) => r.key === "ref:wall")).toMatchObject({ detail: "box · ice" });
    expect(rows.find((r) => r.key === "ref:vine")).toMatchObject({
      label: "Vine",
      detail: "box · off",
    });
    expect(rows.find((r) => r.key === "ref:hook")).toMatchObject({ detail: "1, 1", type: "peg" });
  });

  it("lists types the registry doesn't know last", () => {
    const odd = buildOutline(
      { ...def, entities: [{ id: "x", type: "mystery", at: [0, 0] }] },
      registry,
    );
    expect(odd.at(-2)).toMatchObject({ kind: "type", label: "mystery", count: 1 });
  });

  it("has no group for a spawn-only type, and lists a stray entity of one last", () => {
    const spawned = createRegistry(
      defineGame({
        id: "pegs",
        types: [
          defineEntityType({
            type: "player",
            base: "solid",
            description: "The body the input drives, spawned at Play.",
            spawnOnly: true,
            fields: { shape: shapeField("Body.") },
          }),
          defineEntityType({
            type: "peg",
            description: "A point to hang from.",
            base: "marker",
            fields: { at: pointField("Peg position.") },
          }),
        ],
        actions: [],
        createRuntime: () => ({ snapshot: () => null }),
      }),
    );
    const stray = buildOutline(
      {
        ...def,
        entities: [
          { id: "hero", type: "player", shape: ["box", 0, 0, 1, 1] },
          { id: "hook", type: "peg", at: [1, 1] },
        ],
      },
      spawned,
    );
    expect(stray.filter((r) => r.kind === "type").map((r) => r.type)).toEqual([
      "solid",
      "peg",
      "player",
    ]);
  });

  it("has unique keys, and outlineOrder lists the selectable refs", () => {
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
    expect(outlineOrder(rows)).toEqual([
      "~solid:0",
      "~solid:1",
      "~solid:ice:0",
      "wall",
      "vine",
      "lift",
      "tip",
      "~peg:0",
      "hook",
    ]);
  });
});

describe("buildOutline over nested prefabs", () => {
  const prefab = (id: string, body: Partial<Prefab>): Prefab => ({
    kind: "prefab",
    v: SCENE_FORMAT_VERSION,
    id,
    entities: [],
    ...body,
  });
  const library: PrefabLibrary = new Map([
    ["lock", prefab("lock", { entities: [{ id: "bolt", type: "marker", at: [0, 0] }] })],
    [
      "door",
      prefab("door", {
        entities: [{ id: "panel", type: "marker", at: [0, 0], name: "Panel" }],
        instances: [{ id: "lock-1", prefab: "lock", at: [4, 0] }],
      }),
    ],
    [
      "room",
      prefab("room", {
        entities: [{ id: "floor", type: "solid", shape: ["box", 0, 0, 40, 4] }],
        instances: [{ id: "door-1", prefab: "door", at: [10, 0] }],
      }),
    ],
  ]);
  const scene: SceneDefinition = {
    v: SCENE_FORMAT_VERSION,
    name: "rooms",
    bounds: [0, 0, 100, 100],
    instances: [
      {
        id: "room-1",
        prefab: "room",
        at: [50, 50],
        overrides: { "door-1.at": [12, 0], "door-1/panel.at": [1, 1] },
      },
    ],
  };
  const rows = buildOutline(scene, createRegistry(), library);
  const tree = rows
    .filter((r) => r.ref?.startsWith("room-1"))
    .map((r) => [r.ref, r.depth, r.prefab ?? null, r.overrides]);

  it("nests each instance's children and its nested instances under it, with a/b/c refs", () => {
    expect(tree).toEqual([
      ["room-1", 1, "room", 2],
      ["room-1/floor", 2, null, 0],
      ["room-1/door-1", 2, "door", 2],
      ["room-1/door-1/panel", 3, null, 1],
      ["room-1/door-1/lock-1", 3, "lock", 0],
      ["room-1/door-1/lock-1/bolt", 4, null, 0],
    ]);
  });

  it("labels nested children by their own id or name, with unique keys", () => {
    expect(rows.find((r) => r.ref === "room-1/door-1/panel")!.label).toBe("Panel");
    expect(rows.find((r) => r.ref === "room-1/door-1/lock-1/bolt")!.label).toBe("bolt");
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
  });

  it("marks a missing nested prefab, and lists no children for a prefab that doesn't resolve", () => {
    const room = library.get("room")!;
    const broken: PrefabLibrary = new Map([
      ...library,
      [
        "room",
        { ...room, instances: [...room.instances!, { id: "vent-1", prefab: "vent", at: [0, 0] }] },
      ],
    ]);
    const out = buildOutline(scene, createRegistry(), broken);
    expect(out.find((r) => r.ref === "room-1/vent-1")!.detail).toBe("vent (missing)");
    expect(out.filter((r) => r.ref).map((r) => r.ref)).toEqual([
      "room-1",
      "room-1/door-1",
      "room-1/door-1/lock-1",
      "room-1/vent-1",
    ]);
  });

  it("stops at a cycle instead of recursing", () => {
    const loop: PrefabLibrary = new Map([
      ["a", prefab("a", { instances: [{ id: "b-1", prefab: "b", at: [0, 0] }] })],
      ["b", prefab("b", { instances: [{ id: "a-1", prefab: "a", at: [0, 0] }] })],
    ]);
    const out = buildOutline(
      { ...scene, instances: [{ id: "a-9", prefab: "a", at: [0, 0] }] },
      createRegistry(),
      loop,
    );
    expect(out.filter((r) => r.ref).map((r) => r.ref)).toEqual(["a-9", "a-9/b-1", "a-9/b-1/a-1"]);
  });
});

describe("buildTreeOutline", () => {
  const prefab = (id: string, body: Partial<Prefab>): Prefab => ({
    kind: "prefab",
    v: SCENE_FORMAT_VERSION,
    id,
    entities: [],
    ...body,
  });
  const library: PrefabLibrary = new Map([
    ["lock", prefab("lock", { entities: [{ id: "bolt", type: "marker", at: [0, 0] }] })],
    [
      "turret",
      prefab("turret", {
        entities: [
          { id: "base", type: "solid", shape: ["box", 0, 0, 2, 1] },
          { id: "barrel", type: "marker", parent: "base", at: [1, 0] },
        ],
        instances: [{ id: "lock-1", prefab: "lock", at: [0, 1] }],
      }),
    ],
  ]);
  const reg = createRegistry();
  const scene: SceneDefinition = {
    v: SCENE_FORMAT_VERSION,
    name: "tree",
    bounds: [0, 0, 100, 100],
    solid: [["box", 0, 0, 1, 1]],
    instances: [
      { id: "t-1", prefab: "turret", parent: "tower", at: [0, 0] },
      { id: "t-2", prefab: "turret", at: [50, 0] },
    ],
    entities: [
      { id: "tower", type: "node", name: "Tower", at: [10, 10] },
      { id: "flag", type: "marker", parent: "t-2/barrel", at: [0, -1] },
      { id: "plate", type: "solid", parent: "t-2", shape: ["box", 0, 2, 1, 1] },
      { id: "stand", type: "solid", parent: "tower", shape: ["box", 0, 1, 1, 1] },
      { id: "lost", type: "marker", parent: "gone", at: [0, 0] },
      { id: "odd", type: "marker", parent: "t-2/nothing", at: [0, 0] },
    ],
  };
  const rows = buildTreeOutline(scene, reg, library);
  const tree = rows.map((r) => [r.key, r.depth]);

  it("lists each parent's entities in entities order, then its instances, a level deeper each", () => {
    expect(tree).toEqual([
      ["ref:tower", 0],
      ["ref:stand", 1],
      ["ref:t-1", 1],
      ["ref:t-1/base", 2],
      ["ref:t-1/barrel", 3],
      ["ref:t-1/lock-1", 2],
      ["ref:t-1/lock-1/bolt", 3],
      ["ref:lost", 0],
      ["ref:t-2", 0],
      ["ref:t-2/base", 1],
      ["ref:t-2/barrel", 2],
      ["ref:flag", 3],
      ["ref:t-2/lock-1", 1],
      ["ref:t-2/lock-1/bolt", 2],
      ["ref:plate", 1],
      ["ref:odd", 0],
      ["bucket:solid", 0],
      ["ref:~solid:0", 1],
    ]);
  });

  it("details an entity by its type, since no type row says it", () => {
    expect(rows.find((r) => r.ref === "tower")).toMatchObject({
      label: "Tower",
      detail: "node · 10, 10",
      type: "node",
    });
    expect(rows.find((r) => r.ref === "t-2")).toMatchObject({ prefab: "turret", detail: "turret" });
    expect(rows.find((r) => r.key === "bucket:solid")).toMatchObject({ kind: "bucket", count: 1 });
  });

  it("details a parented entity's point in world coordinates, as the inspector shows it", () => {
    expect(rows.find((r) => r.ref === "flag")?.detail).toMatch(/· 51, -1$/);
    expect(rows.find((r) => r.ref === "lost")?.detail).toMatch(/· 0, 0$/);
  });

  it("puts an entity whose parents loop at the root, with what sits under it", () => {
    const loop = buildTreeOutline(
      {
        ...scene,
        instances: [],
        solid: [],
        entities: [
          { id: "a", type: "node", parent: "b", at: [0, 0] },
          { id: "b", type: "node", parent: "a", at: [0, 0] },
        ],
      },
      reg,
    );
    expect(loop.map((r) => [r.ref, r.depth])).toEqual([
      ["b", 0],
      ["a", 1],
    ]);
  });

  it("has unique keys and the same keys as the type view, so collapse state carries over", () => {
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
    const byType = new Set(buildOutline(scene, reg, library).map((r) => r.key));
    expect(rows.every((r) => byType.has(r.key))).toBe(true);
  });
});

describe("tree drops", () => {
  const reg = createRegistry();
  const scene: SceneDefinition = {
    v: SCENE_FORMAT_VERSION,
    name: "drops",
    bounds: [0, 0, 100, 100],
    solid: [["box", 0, 0, 1, 1]],
    instances: [
      { id: "i-1", prefab: "p", at: [0, 0] },
      { id: "i-2", prefab: "p", parent: "tower", at: [0, 0] },
    ],
    entities: [
      { id: "tower", type: "node", at: [10, 10] },
      { id: "base", type: "solid", parent: "tower", shape: ["box", 0, 0, 1, 1] },
      { id: "barrel", type: "marker", parent: "base", at: [1, 0] },
      { id: "lamp", type: "marker", at: [5, 5] },
      { id: "nav", type: "marker", at: [6, 6] },
    ],
  };
  const library: PrefabLibrary = new Map([
    [
      "p",
      {
        kind: "prefab",
        v: SCENE_FORMAT_VERSION,
        id: "p",
        entities: [{ id: "x", type: "marker", at: [0, 0] }],
      },
    ],
  ]);
  const batch = (refs: string[], drop: Parameters<typeof treeDropBatch>[4]) =>
    treeDropBatch(scene, reg, library, refs, drop);

  it("drags a selection's own entities, instances and drawn shapes, without any under another of them", () => {
    expect(
      treeDragRoots(scene, reg, library, ["barrel", "tower", "lamp", "i-2", "i-1/x", "~solid:0"]),
    ).toEqual(["tower", "lamp", "~solid:0"]);
    expect(treeDragRoots(scene, reg, library, ["base", "lamp"])).toEqual(["base", "lamp"]);
  });

  it("reparents only what changes parent, and is null when nothing does", () => {
    expect(batch(["lamp", "base"], { kind: "reparent", parent: "tower" })).toEqual({
      label: "Put 2 items under tower",
      ops: [{ op: "reparent", refs: ["lamp"], parent: "tower" }],
    });
    expect(batch(["base"], { kind: "reparent", parent: "tower" })).toBeNull();
    expect(batch(["barrel"], { kind: "reparent", parent: null })).toMatchObject({
      label: "Move barrel to the root",
      ops: [{ op: "reparent", refs: ["barrel"], parent: null }],
    });
    expect(batch(["i-1/x"], { kind: "reparent", parent: null })).toBeNull();
  });

  it("promotes a drawn shape dropped in the tree, in the same batch", () => {
    const drop = batch(["~solid:0"], { kind: "reparent", parent: "tower" })!;
    expect(drop).toEqual({
      label: "Put solid-1 under tower",
      base: sceneHash(scene),
      ops: [
        { op: "promote", ref: "~solid:0", id: "solid-1" },
        { op: "reparent", refs: ["solid-1"], parent: "tower" },
      ],
    });
    expect(treeDropRefusal(scene, reg, library, drop)).toBeNull();
    expect(promotedRefs(drop, ["~solid:0", "lamp"])).toEqual(["solid-1", "lamp"]);
    expect(
      promotedRefs({ ops: [{ op: "promote", ref: "~solid:1", id: "s" }] }, [
        "~solid:0",
        "~solid:2",
      ]),
    ).toEqual(["~solid:0", "~solid:1"]);
    const beside = batch(["~solid:0"], { kind: "reorder", before: "lamp" })!;
    expect(beside.ops.map((o) => o.op)).toEqual(["promote", "reorder"]);
    expect(treeDropRefusal(scene, reg, library, beside)).toBeNull();
    // At the root already, and last there once promoted: nothing to do, so nothing is promoted.
    expect(batch(["~solid:0"], { kind: "reparent", parent: null })).toBeNull();
  });

  it("reorders before a sibling in its own list, reparenting first when the parent differs", () => {
    expect(batch(["lamp"], { kind: "reorder", before: "barrel" })).toEqual({
      label: "Move lamp before barrel",
      ops: [
        { op: "reparent", refs: ["lamp"], parent: "base" },
        { op: "reorder", refs: ["lamp"], index: 2 },
      ],
    });
    expect(batch(["nav"], { kind: "reorder", before: "lamp" })).toEqual({
      label: "Move nav before lamp",
      ops: [{ op: "reorder", refs: ["nav"], index: 3 }],
    });
    expect(batch(["lamp"], { kind: "reorder", before: "nav" })).toBeNull();
    expect(batch(["lamp"], { kind: "reorder", before: "lamp" })).toBeNull();
  });

  it("puts an entity dropped before an instance after its sibling entities, and an instance before an entity first among its sibling instances", () => {
    expect(batch(["lamp"], { kind: "reorder", before: "i-2" })).toEqual({
      label: "Move lamp before i-2",
      ops: [{ op: "reparent", refs: ["lamp"], parent: "tower" }],
    });
    expect(batch(["tower"], { kind: "reorder", before: "i-1" })).toEqual({
      label: "Move tower before i-1",
      ops: [{ op: "reorder", refs: ["tower"], index: 4 }],
    });
    expect(batch(["i-1"], { kind: "reorder", before: "base" })).toEqual({
      label: "Move i-1 before base",
      ops: [{ op: "reparent", refs: ["i-1"], parent: "tower" }],
    });
  });

  it("reorders just after a sibling, reparenting first when the parent differs", () => {
    expect(batch(["lamp"], { kind: "reorder", after: "nav" })).toEqual({
      label: "Move lamp after nav",
      ops: [{ op: "reorder", refs: ["lamp"], index: 4 }],
    });
    expect(batch(["lamp"], { kind: "reorder", after: "barrel" })).toEqual({
      label: "Move lamp after barrel",
      ops: [{ op: "reparent", refs: ["lamp"], parent: "base" }],
    });
    expect(batch(["nav"], { kind: "reorder", after: "lamp" })).toBeNull();
    expect(batch(["nav"], { kind: "reorder", after: "nav" })).toBeNull();
  });

  it("puts what is dropped on the parent it already has last among its siblings", () => {
    expect(batch(["tower"], { kind: "reparent", parent: null })).toEqual({
      label: "Move tower last at the root",
      ops: [{ op: "reorder", refs: ["tower"], index: 4 }],
    });
    expect(batch(["lamp", "tower"], { kind: "reparent", parent: null })).toEqual({
      label: "Move 2 items last at the root",
      ops: [{ op: "reorder", refs: ["tower", "lamp"], index: 3 }],
    });
    expect(batch(["nav"], { kind: "reparent", parent: null })).toBeNull();
    expect(batch(["i-1"], { kind: "reparent", parent: null })).toBeNull();
  });

  it("splits a mixed drag into one reorder per list", () => {
    expect(batch(["i-1", "lamp"], { kind: "reorder", before: "tower" })?.ops).toEqual([
      { op: "reorder", refs: ["lamp"], index: 0 },
    ]);
    expect(batch(["i-2", "nav"], { kind: "reorder", before: "tower" })?.ops).toEqual([
      { op: "reparent", refs: ["i-2"], parent: null },
      { op: "reorder", refs: ["nav"], index: 0 },
      { op: "reorder", refs: ["i-2"], index: 0 },
    ]);
  });

  it("names why the scene would refuse a drop: a loop, a parent that can't be one", () => {
    const loop = batch(["tower"], { kind: "reparent", parent: "barrel" })!;
    expect(treeDropRefusal(scene, reg, library, loop)).toMatchObject({ code: "parent-cycle" });
    const bulk = batch(["lamp"], { kind: "reparent", parent: "~solid:0" })!;
    expect(treeDropRefusal(scene, reg, library, bulk)).toMatchObject({ code: "parent-type" });
    const fine = batch(["lamp"], { kind: "reparent", parent: "i-1/x" })!;
    expect(treeDropRefusal(scene, reg, library, fine)).toBeNull();
  });
});
