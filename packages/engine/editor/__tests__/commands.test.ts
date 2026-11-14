import { describe, expect, it } from "vite-plus/test";

import { createRegistry } from "../../game/define";
import { applyOps } from "../../scene/ops";
import { parseSceneOrThrow } from "../../scene/parse";
import { prefabLibrary } from "../../scene/prefab";
import { resolveScene } from "../../scene/resolve";
import { SCENE_FORMAT_VERSION, type OpBatch, type SceneDefinition } from "../../scene/types";
import { isWholePixel, roundLength } from "../../scene/units";
import {
  deleteBatch,
  flipBatch,
  groupBatch,
  hierarchyDown,
  hierarchyUp,
  nudgeBatch,
  nudgeDelta,
  quarterTurnTargets,
  instanceLevels,
  rotateSelectionBatch,
  selectAllRefs,
  selectionBounds,
  selectionRoots,
  turnBatch,
  ungroupBatch,
  zOrderBatch,
} from "../commands";
import { outlineBounds, outlineLook } from "../outline-bounds";
import { createSpatialIndex } from "../spatial-index";

const registry = createRegistry();
/** The engine yard's entities in metres. */
const yard = {
  v: SCENE_FORMAT_VERSION,
  name: "engine-yard",
  bounds: [0, 0, 20, 10],
  solid: [
    ["box", 10, 9.8, 10, 0.2],
    ["box", 0.2, 5, 0.2, 5],
    ["box", 19.8, 5, 0.2, 5],
  ],
  entities: [
    { id: "ledge", type: "solid", shape: ["box", 14, 8, 1.2, 0.1], oneWay: true },
    { id: "avatar", type: "prop", shape: ["box", 3, 9.4, 0.2, 0.2], density: 1, restitution: 0 },
    { id: "crate", type: "prop", shape: ["circle", 12, 9.4, 0.2], density: 2, restitution: 0.3 },
    { id: "start", type: "marker", at: [3, 9.6], tags: ["spawn"] },
    { id: "readme", type: "note", at: [1, 1], text: "Engine fixture: primitives only." },
  ],
};
const doc: SceneDefinition = parseSceneOrThrow(yard, registry);
const run = (batch: OpBatch | null, def = doc) => {
  const r = applyOps(def, batch!, registry);
  if (!r.ok) throw new Error(r.issue.message);
  return r.def;
};
const entity = (def: SceneDefinition, id: string) => def.entities!.find((e) => e.id === id)!;

describe("nudge", () => {
  it("moves one world px, ten with -coarse, one with -fine, in metres", () => {
    expect(nudgeDelta("nudge-left", 100)).toEqual([-0.01, 0]);
    expect(nudgeDelta("nudge-down-coarse", 100)).toEqual([0, 0.1]);
    expect(nudgeDelta("nudge-up-fine", 100)).toEqual([0, -0.01]);
    expect(nudgeDelta("nudge-right", 32)).toEqual([0.03125, 0]);
    expect(nudgeDelta("rotate-cw", 100)).toBeNull();
  });

  it("lands on whole world px at 100, 32 and 48 px per metre", () => {
    for (const ppm of [100, 32, 48])
      for (const command of ["nudge-up", "nudge-left-coarse", "nudge-down-fine"]) {
        const d = nudgeDelta(command, ppm)!;
        expect(d.every((v) => isWholePixel(v, ppm))).toBe(true);
        expect(Math.abs(d[0] + d[1]) * ppm).toBeCloseTo(command.endsWith("coarse") ? 10 : 1, 4);
      }
  });

  it("is one move of the selection, on whole world px", () => {
    expect(nudgeBatch(["crate", "~solid:1"], [0.16, 0], 100)).toEqual({
      label: "Nudge 2 entities",
      ops: [{ op: "move", refs: ["crate", "~solid:1"], by: [0.16, 0] }],
    });
    expect(nudgeBatch(["crate"], [0.1, 0], 48)?.ops).toEqual([
      { op: "move", refs: ["crate"], by: [0.104167, 0] },
    ]);
    expect(nudgeBatch([], [0.16, 0], 100)).toBeNull();
  });
});

describe("rotateSelectionBatch", () => {
  it("turns one box about its centre", () => {
    const after = run(rotateSelectionBatch(doc, registry, ["ledge"], 15));
    expect(entity(after, "ledge").shape).toEqual(["box", 14, 8, 1.2, 0.1, 15]);
  });

  it("orbits several about the box around them", () => {
    const after = run(rotateSelectionBatch(doc, registry, ["avatar", "start"], 180));
    // The box around both spans x 2.8..3.2, y 9.2..9.6: the centre is 3, 9.4.
    expect(entity(after, "start").at).toEqual([3, 9.2]);
  });
});

describe("the tree commands", () => {
  const prefabs = prefabLibrary([
    {
      kind: "prefab",
      v: doc.v,
      id: "post",
      entities: [
        { id: "top", type: "marker", at: [0, -1] },
        { id: "foot", type: "marker", at: [0, 1] },
      ],
    },
    {
      kind: "prefab",
      v: doc.v,
      id: "yard",
      instances: [{ id: "post-a", prefab: "post", at: [1, 0] }],
      entities: [{ id: "gate", type: "marker", at: [-1, 0] }],
    },
  ]);
  const tree: SceneDefinition = {
    ...structuredClone(doc),
    instances: [
      { id: "post-1", prefab: "post", at: [5, 5] },
      { id: "yard-1", prefab: "yard", at: [10, 5], parent: "base" },
    ],
    entities: [
      ...structuredClone(doc.entities!),
      { id: "base", type: "node", at: [8, 2] },
      { id: "lamp", type: "marker", at: [1, 1], parent: "base" },
      { id: "flag", type: "marker", at: [0, -0.5], parent: "post-1/top" },
    ],
  };
  const apply = (def: SceneDefinition, batch: OpBatch) => {
    const r = applyOps(def, batch, registry, { prefabs });
    if (!r.ok) throw new Error(r.issue.message);
    return r;
  };
  const world = (def: SceneDefinition, id: string) =>
    resolveScene(def, registry, prefabs).entities!.find((e) => e.id === id)!;

  it("groups the selection under a node at its centre, under their common parent, in one undo", () => {
    const edit = groupBatch(tree, registry, ["lamp", "yard-1"], prefabs)!;
    expect(edit.select).toEqual(["node-1"]);
    expect(edit.batch.label).toBe("Group 2 entities");
    const r = apply(tree, edit.batch);
    const node = entity(r.def, "node-1");
    expect(node).toMatchObject({ type: "node", parent: "base" });
    expect(entity(r.def, "lamp").parent).toBe("node-1");
    expect(r.def.instances!.find((i) => i.id === "yard-1")!.parent).toBe("node-1");
    // The node sits at the centre of what the two outline, and nothing moved in the world.
    const box = selectionBounds(resolveScene(tree, registry, prefabs), registry, [
      "lamp",
      "yard-1",
    ])!;
    expect(world(r.def, "node-1").at).toEqual([
      roundLength((box.minX + box.maxX) / 2),
      roundLength((box.minY + box.maxY) / 2),
    ]);
    for (const id of ["lamp", "yard-1/gate", "yard-1/post-a/top"])
      expect(world(r.def, id).at).toEqual(world(tree, id).at);
    // One batch, so one inverse takes it all back.
    expect(apply(r.def, r.inverse).def).toEqual(tree);
  });

  it("groups roots only, at the root when the selection shares no parent but the scene", () => {
    const edit = groupBatch(tree, registry, ["crate", "lamp", "base", "post-1/top"], prefabs)!;
    const ops = edit.batch.ops;
    expect(ops.find((o) => o.op === "reparent" && o.refs.includes("node-1"))).toBeUndefined();
    expect(ops.at(-1)).toEqual({ op: "reparent", refs: ["crate", "base"], parent: "node-1" });
    const r = apply(tree, edit.batch);
    expect(entity(r.def, "node-1").parent).toBeUndefined();
    expect(entity(r.def, "lamp").parent).toBe("base");
    expect(world(r.def, "lamp").at).toEqual(world(tree, "lamp").at);
  });

  it("makes no group from what can't be in the tree, or without a node type", () => {
    expect(groupBatch(tree, registry, ["~solid:0", "post-1/top"], prefabs)).toBeNull();
    expect(groupBatch(tree, registry, [], prefabs)).toBeNull();
    const bare = {
      ...registry,
      types: new Map([...registry.types].filter(([type]) => type !== "node")),
    };
    expect(groupBatch(tree, bare, ["crate"], prefabs)).toBeNull();
  });

  it("ungroups a node into its parent and removes it, in one undo", () => {
    const edit = ungroupBatch(tree, ["base"])!;
    expect(edit).toEqual({
      batch: {
        label: "Ungroup base",
        ops: [
          { op: "reparent", refs: ["lamp", "yard-1"], parent: null },
          { op: "remove", refs: ["base"] },
        ],
      },
      select: ["lamp", "yard-1"],
    });
    const r = apply(tree, edit.batch);
    expect(r.def.entities!.some((e) => e.id === "base")).toBe(false);
    expect(entity(r.def, "lamp").parent).toBeUndefined();
    for (const id of ["lamp", "yard-1/gate"])
      expect(world(r.def, id).at).toEqual(world(tree, id).at);
    expect(apply(r.def, r.inverse).def).toEqual(tree);
    expect(ungroupBatch(tree, ["lamp", "post-1"])).toBeNull();
  });

  it("round-trips a group through ungroup", () => {
    const grouped = apply(
      tree,
      groupBatch(tree, registry, ["crate", "avatar"], prefabs)!.batch,
    ).def;
    const back = apply(grouped, ungroupBatch(grouped, ["node-1"])!.batch).def;
    for (const id of ["crate", "avatar"]) expect(entity(back, id)).toEqual(entity(tree, id));
  });

  it("hands a nested node's children to the nearest node that stays", () => {
    const nested = apply(tree, groupBatch(tree, registry, ["lamp"], prefabs)!.batch).def;
    expect(entity(nested, "lamp").parent).toBe("node-1");
    const ops = ungroupBatch(nested, ["base", "node-1"])!.batch.ops;
    expect(ops).toEqual([
      { op: "reparent", refs: ["lamp", "yard-1"], parent: null },
      { op: "remove", refs: ["base", "node-1"] },
    ]);
  });

  it("walks up by the tree, a prefab's child to its instance, across instance boundaries", () => {
    expect(hierarchyUp(tree, ["lamp"])).toEqual(["base"]);
    expect(hierarchyUp(tree, ["yard-1"])).toEqual(["base"]);
    expect(hierarchyUp(tree, ["post-1/top"])).toEqual(["post-1"]);
    expect(hierarchyUp(tree, ["yard-1/post-a/top"])).toEqual(["yard-1/post-a"]);
    expect(hierarchyUp(tree, ["yard-1/post-a"])).toEqual(["yard-1"]);
    expect(hierarchyUp(tree, ["flag"])).toEqual(["post-1/top"]);
    expect(hierarchyUp(tree, ["lamp", "yard-1", "flag"])).toEqual(["base", "post-1/top"]);
    expect(hierarchyUp(tree, ["base"])).toBeNull();
    expect(hierarchyUp(tree, ["crate"])).toBeNull();
    // A bulk entry at the root climbs to its bucket.
    expect(hierarchyUp(tree, ["~solid:1"])).toEqual(["~solid:0", "~solid:1", "~solid:2"]);
    expect(hierarchyUp(tree, ["~solid:0", "~solid:1", "~solid:2"])).toBeNull();
  });

  it("walks down to the first child, one instance level at a time", () => {
    expect(hierarchyDown(tree, registry, ["base"], prefabs)).toEqual(["lamp"]);
    expect(hierarchyDown(tree, registry, ["post-1"], prefabs)).toEqual(["post-1/top"]);
    expect(hierarchyDown(tree, registry, ["post-1/top"], prefabs)).toEqual(["flag"]);
    expect(hierarchyDown(tree, registry, ["yard-1"], prefabs)).toEqual(["yard-1/gate"]);
    expect(hierarchyDown(tree, registry, ["yard-1/post-a"], prefabs)).toEqual([
      "yard-1/post-a/top",
    ]);
    expect(hierarchyDown(tree, registry, ["crate"], prefabs)).toBeNull();
    expect(hierarchyDown(tree, registry, [], prefabs)).toBeNull();
    // From several, the first in outline order.
    expect(hierarchyDown(doc, registry, ["ledge", "~solid:2", "~solid:1"])).toEqual(["~solid:1"]);
  });

  it("names the levels a click walks into an instance", () => {
    expect(instanceLevels("room-1/door-1/panel")).toEqual([
      "room-1",
      "room-1/door-1",
      "room-1/door-1/panel",
    ]);
    expect(instanceLevels("crate")).toEqual(["crate"]);
  });

  it("keeps only the selection's roots", () => {
    expect(selectionRoots(tree, ["lamp", "base", "post-1/top", "flag", "crate"])).toEqual([
      "base",
      "post-1/top",
      "crate",
    ]);
    expect(selectionRoots(tree, ["post-1", "post-1/top", "yard-1/post-a/top"])).toEqual([
      "post-1",
      "yard-1/post-a/top",
    ]);
  });

  it("rotates instances and nodes by one transform, and what's under them with them", () => {
    expect(rotateSelectionBatch(tree, registry, ["post-1"], 15, prefabs)).toEqual({
      label: "Rotate post-1",
      ops: [{ op: "transform", refs: ["post-1"], rotate: 15 }],
    });
    expect(rotateSelectionBatch(tree, registry, ["base", "lamp"], -15, prefabs)?.ops).toEqual([
      { op: "transform", refs: ["base"], rotate: -15 },
    ]);
    const mixed = rotateSelectionBatch(tree, registry, ["post-1", "crate"], 90, prefabs)!;
    const box = selectionBounds(resolveScene(tree, registry, prefabs), registry, [
      "post-1",
      "crate",
    ])!;
    const about = [(box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2];
    expect(mixed.ops[0]).toEqual({ op: "transform", refs: ["post-1"], rotate: 90, about });
    expect(mixed.ops[1]).toMatchObject({ op: "update", ref: "crate" });
    const r = apply(tree, mixed);
    expect(r.def.instances![0]!.rot).toBe(90);
  });
});

describe("zOrderBatch", () => {
  it("brings forward and sends backward by one setZ, skipping bulk entries", () => {
    expect(zOrderBatch(["crate", "~solid:0", "ledge", "crate"], 1)).toEqual({
      label: "Bring 2 entities forward",
      ops: [{ op: "setZ", refs: ["crate", "ledge"], by: 1 }],
    });
    expect(zOrderBatch(["crate"], -1)).toEqual({
      label: "Send crate backward",
      ops: [{ op: "setZ", refs: ["crate"], by: -1 }],
    });
  });

  it("is null when only bulk entries, or nothing, are selected", () => {
    expect(zOrderBatch(["~solid:0", "~solid:1"], 1)).toBeNull();
    expect(zOrderBatch(["gate-1/~solid:0"], 1)).toBeNull();
    expect(zOrderBatch([], -1)).toBeNull();
  });

  it("leaves an instance's bulk children out of a mixed selection", () => {
    expect(zOrderBatch(["gate-1/~solid:0", "crate", "gate-1/door", "gate-1"], -1)).toEqual({
      label: "Send 3 entities backward",
      ops: [{ op: "setZ", refs: ["crate", "gate-1/door", "gate-1"], by: -1 }],
    });
  });

  it("applies a mixed selection holding a bulk child instead of refusing it", () => {
    const def: SceneDefinition = {
      ...structuredClone(doc),
      instances: [{ id: "post-1", prefab: "post", at: [100, 900] }],
    };
    const prefabs = prefabLibrary([
      {
        kind: "prefab",
        v: doc.v,
        id: "post",
        entities: [{ id: "top", type: "marker", at: [0, 0] }],
        bulk: { solid: [["box", 0, 20, 8, 2]] },
      },
    ]);
    const r = applyOps(def, zOrderBatch(["post-1/~solid:0", "crate", "post-1"], 1)!, registry, {
      prefabs,
    });
    if (!r.ok) throw new Error(r.issue.message);
    expect(entity(r.def, "crate").z).toBe(1);
    expect(r.def.instances![0]!.z).toBe(1);
  });

  it("shifts z on entities and instances, and undoes exactly", () => {
    const def: SceneDefinition = {
      ...structuredClone(doc),
      instances: [{ id: "post-1", prefab: "post", at: [100, 900] }],
    };
    const prefabs = prefabLibrary([
      {
        kind: "prefab",
        v: doc.v,
        id: "post",
        entities: [{ id: "top", type: "marker", at: [0, 0] }],
      },
    ]);
    const r = applyOps(def, zOrderBatch(["crate", "post-1"], 1)!, registry, { prefabs });
    if (!r.ok) throw new Error(r.issue.message);
    expect(entity(r.def, "crate").z).toBe(1);
    expect(r.def.instances![0]!.z).toBe(1);
    const back = applyOps(r.def, r.inverse, registry, { prefabs });
    if (!back.ok) throw new Error(back.issue.message);
    expect(back.def).toEqual(def);
  });
});

describe("turn and flip", () => {
  const prefabs = prefabLibrary([
    {
      kind: "prefab",
      v: doc.v,
      id: "post",
      entities: [{ id: "top", type: "marker", at: [10, 0] }],
    },
  ]);
  const placed: SceneDefinition = {
    ...structuredClone(doc),
    instances: [
      { id: "post-1", prefab: "post", at: [100, 900] },
      { id: "post-2", prefab: "post", at: [200, 900], parent: "pair" },
    ],
    entities: [
      ...structuredClone(doc.entities!),
      { id: "pair", type: "node", at: [400, 800] },
      { id: "pin", type: "marker", at: [0, 0], parent: "pair" },
    ],
  };

  it("finds instances by id or child, and what's left", () => {
    expect(quarterTurnTargets(placed, ["post-1/top", "post-1", "crate"])).toEqual({
      instances: ["post-1"],
      rest: ["crate"],
    });
    expect(quarterTurnTargets(placed, ["pin", "post-2/top", "post-1"])).toEqual({
      instances: ["post-2", "post-1"],
      rest: ["pin"],
    });
    expect(quarterTurnTargets(placed, ["pin", "~solid:0"])).toEqual({
      instances: [],
      rest: ["pin", "~solid:0"],
    });
  });

  it("turns and flips through one transform op, leaving plain entities out", () => {
    expect(turnBatch(placed, ["post-1/top", "crate"], 1)).toEqual({
      label: "Turn post-1 clockwise",
      ops: [{ op: "transform", refs: ["post-1"], turn: 1 }],
    });
    expect(turnBatch(placed, ["pin", "post-2", "post-1"], -1)).toEqual({
      label: "Turn 2 items counter-clockwise",
      ops: [{ op: "transform", refs: ["post-2", "post-1"], turn: -1 }],
    });
    expect(flipBatch(placed, ["pin", "post-2"], "x")).toEqual({
      label: "Flip post-2 horizontally",
      ops: [{ op: "transform", refs: ["post-2"], flip: "x" }],
    });
    expect(flipBatch(placed, ["post-1"], "y")?.label).toBe("Flip post-1 vertically");
    expect(turnBatch(placed, ["crate", "~solid:0"], 1)).toBeNull();
    expect(flipBatch(placed, [], "x")).toBeNull();
  });

  it("composes onto the instance and undoes exactly", () => {
    const turned = applyOps(placed, turnBatch(placed, ["post-1"], 1)!, registry, { prefabs });
    if (!turned.ok) throw new Error(turned.issue.message);
    expect(turned.def.instances![0]).toEqual({
      id: "post-1",
      prefab: "post",
      at: [100, 900],
      rot: 90,
    });
    const flipped = applyOps(turned.def, flipBatch(turned.def, ["post-1"], "x")!, registry, {
      prefabs,
    });
    if (!flipped.ok) throw new Error(flipped.issue.message);
    expect(flipped.def.instances![0]).toMatchObject({ rot: 270, flip: true });
    const back = applyOps(turned.def, turned.inverse, registry, { prefabs });
    if (!back.ok) throw new Error(back.issue.message);
    expect(back.def).toEqual(placed);
  });
});

describe("select-all, delete and bounds", () => {
  it("selects everything but hidden and locked layers", () => {
    const index = createSpatialIndex();
    index.rebuild(doc, registry);
    const all = selectAllRefs(doc, index);
    expect(all).toContain("~solid:0");
    expect(all).toContain("readme");
    const some = selectAllRefs(doc, index, {
      hidden: new Set(["editor"]),
      locked: new Set(["terrain"]),
    });
    expect(some).not.toContain("readme");
    expect(some).not.toContain("~solid:0");
    expect(some).toContain("crate");
  });

  it("deletes the selection in one remove", () => {
    expect(deleteBatch(["crate", "crate"])).toEqual({
      label: "Delete crate",
      ops: [{ op: "remove", refs: ["crate"] }],
    });
    expect(deleteBatch([])).toBeNull();
  });

  it("names what goes with a deleted parent: everything below it", () => {
    const tree: SceneDefinition = {
      v: SCENE_FORMAT_VERSION,
      name: "tree",
      bounds: [0, 0, 10, 10],
      entities: [
        { id: "pivot", type: "node", at: [1, 1] },
        { id: "arm", type: "node", at: [1, 0], parent: "pivot" },
        { id: "tip", type: "marker", at: [1, 0], parent: "arm" },
        { id: "lamp", type: "marker", at: [5, 5] },
      ],
    };
    expect(deleteBatch(["pivot"], tree)?.label).toBe("Delete pivot and 2 children");
    expect(deleteBatch(["arm", "pivot"], tree)?.label).toBe("Delete 2 entities and 1 child");
    expect(deleteBatch(["lamp"], tree)?.label).toBe("Delete lamp");
  });

  it("frames the box around the selection", () => {
    const box = selectionBounds(doc, registry, ["avatar", "start"])!;
    expect(Object.fromEntries(Object.entries(box).map(([k, v]) => [k, roundLength(v)]))).toEqual({
      minX: 2.8,
      minY: 9.2,
      maxX: 3.2,
      maxY: 9.6,
    });
    expect(selectionBounds(doc, registry, [])).toBeNull();
  });

  it("bounds a selection as the editor outlines it, an instance by its children", () => {
    const refs = ["crate", "~solid:0", "readme"];
    expect(selectionBounds(doc, registry, refs)).toEqual(
      outlineBounds(doc, refs, outlineLook(registry)),
    );
    const resolved: SceneDefinition = {
      ...doc,
      entities: [
        ...doc.entities!,
        { id: "gate/left", type: "marker", at: [5, 2] },
        { id: "gate/right", type: "prop", shape: ["box", 7, 3, 0.5, 0.5] },
      ],
    };
    expect(selectionBounds(resolved, registry, ["gate"])).toEqual({
      minX: 5,
      minY: 2,
      maxX: 7.5,
      maxY: 3.5,
    });
  });
});
