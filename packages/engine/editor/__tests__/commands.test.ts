import { describe, expect, it } from "vite-plus/test";

import { createRegistry } from "../../game/define";
import { applyOps } from "../../scene/ops";
import { parseSceneOrThrow } from "../../scene/parse";
import { prefabLibrary } from "../../scene/prefab";
import { SCENE_FORMAT_VERSION, type OpBatch, type SceneDefinition } from "../../scene/types";
import { isWholePixel, roundLength } from "../../scene/units";
import {
  deleteBatch,
  flipBatch,
  groupBatch,
  hierarchyDown,
  hierarchyUp,
  nextGroupName,
  nudgeBatch,
  nudgeDelta,
  quarterTurnTargets,
  rotateSelectionBatch,
  selectAllRefs,
  selectionBounds,
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

describe("groups", () => {
  it("puts entities in a fresh group and takes them out again, leaving bulk entries alone", () => {
    expect(nextGroupName(doc)).toBe("group-1");
    const grouped = run(groupBatch(doc, ["crate", "avatar", "~solid:0"]));
    expect(entity(grouped, "crate").group).toBe("group-1");
    expect(nextGroupName(grouped)).toBe("group-2");
    expect(groupBatch(grouped, ["crate"], "group-1")).toBeNull();
    const ungrouped = run(ungroupBatch(grouped, ["crate"]), grouped);
    expect(entity(ungrouped, "crate").group).toBeUndefined();
    expect(entity(ungrouped, "avatar").group).toBe("group-1");
    expect(ungroupBatch(doc, ["crate"])).toBeNull();
  });

  it("walk up to the group, then to the outline row, and down to the first", () => {
    const grouped = run(groupBatch(doc, ["crate", "ledge"], "pair"));
    expect(hierarchyUp(grouped, registry, ["crate"])).toEqual(["ledge", "crate"]);
    // The whole group is selected: up goes to the first ref's outline row, the props.
    expect(hierarchyUp(grouped, registry, ["crate", "ledge"])).toEqual(["avatar", "crate"]);
    expect(hierarchyUp(grouped, registry, ["avatar", "crate"])).toBeNull();
    expect(hierarchyUp(doc, registry, ["readme"])).toBeNull();
    expect(hierarchyUp(doc, registry, ["~solid:1"])).toEqual(["~solid:0", "~solid:1", "~solid:2"]);
    expect(hierarchyUp(doc, registry, ["~solid:0", "~solid:1", "~solid:2"])).toEqual([
      "~solid:0",
      "~solid:1",
      "~solid:2",
      "ledge",
    ]);
    expect(hierarchyDown(doc, registry, ["ledge", "~solid:2", "~solid:1"])).toEqual(["~solid:1"]);
    expect(hierarchyDown(doc, registry, ["ledge"])).toBeNull();
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
    groups: { pair: { at: [400, 800] } },
    instances: [
      { id: "post-1", prefab: "post", at: [100, 900] },
      { id: "post-2", prefab: "post", at: [200, 900], group: "pair" },
    ],
    entities: [
      ...structuredClone(doc.entities!),
      { id: "pin", type: "marker", at: [0, 0], group: "pair" },
    ],
  };

  it("finds instances by id or child, whole groups, and what's left", () => {
    expect(quarterTurnTargets(placed, ["post-1/top", "post-1", "crate"])).toEqual({
      instances: ["post-1"],
      groups: [],
      rest: ["crate"],
    });
    expect(quarterTurnTargets(placed, ["pin", "post-2/top", "post-1"])).toEqual({
      instances: ["post-1"],
      groups: ["pair"],
      rest: [],
    });
    expect(quarterTurnTargets(placed, ["pin", "~solid:0"])).toEqual({
      instances: [],
      groups: [],
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
      ops: [{ op: "transform", refs: ["post-1"], groups: ["pair"], turn: -1 }],
    });
    expect(flipBatch(placed, ["pin", "post-2"], "x")).toEqual({
      label: "Flip pair horizontally",
      ops: [{ op: "transform", groups: ["pair"], flip: "x" }],
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
      rot: 1,
    });
    const flipped = applyOps(turned.def, flipBatch(turned.def, ["post-1"], "x")!, registry, {
      prefabs,
    });
    if (!flipped.ok) throw new Error(flipped.issue.message);
    expect(flipped.def.instances![0]).toMatchObject({ rot: 3, flip: true });
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
