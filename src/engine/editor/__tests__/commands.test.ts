import { describe, expect, it } from "vite-plus/test";

import { createRegistry } from "../../game/define";
import { applyOps } from "../../scene/ops";
import { parseSceneOrThrow } from "../../scene/parse";
import type { OpBatch, SceneDefinition } from "../../scene/types";
import yard from "../../scenes/engine-yard.json";
import {
  deleteBatch,
  groupBatch,
  hierarchyDown,
  hierarchyUp,
  nextGroupName,
  nudgeBatch,
  nudgeDelta,
  rotateSelectionBatch,
  selectAllRefs,
  selectionBounds,
  ungroupBatch,
} from "../commands";
import { createSpatialIndex } from "../spatial-index";

const registry = createRegistry();
const doc: SceneDefinition = parseSceneOrThrow(yard, registry);
const run = (batch: OpBatch | null, def = doc) => {
  const r = applyOps(def, batch!, registry);
  if (!r.ok) throw new Error(r.issue.message);
  return r.def;
};
const entity = (def: SceneDefinition, id: string) => def.entities!.find((e) => e.id === id)!;

describe("nudge", () => {
  it("moves one grid step, four with -coarse, one px with -fine", () => {
    expect(nudgeDelta("nudge-left", 64)).toEqual([-64, 0]);
    expect(nudgeDelta("nudge-down-coarse", 16)).toEqual([0, 64]);
    expect(nudgeDelta("nudge-up-fine", 64)).toEqual([0, -1]);
    expect(nudgeDelta("rotate-cw", 64)).toBeNull();
  });

  it("is one move of the selection", () => {
    expect(nudgeBatch(["crate", "~solid:1"], [16, 0])).toEqual({
      label: "Nudge 2 entities",
      ops: [{ op: "move", refs: ["crate", "~solid:1"], by: [16, 0] }],
    });
    expect(nudgeBatch([], [16, 0])).toBeNull();
  });
});

describe("rotateSelectionBatch", () => {
  it("turns one box about its centre", () => {
    const after = run(rotateSelectionBatch(doc, registry, ["ledge"], 15));
    expect(entity(after, "ledge").shape).toEqual(["box", 1400, 800, 120, 10, 15]);
  });

  it("orbits several about the box around them", () => {
    const after = run(rotateSelectionBatch(doc, registry, ["avatar", "start"], 180));
    // The box around both spans x 280..320, y 920..960: the centre is 300, 940.
    expect(entity(after, "start").at).toEqual([300, 920]);
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
    expect(selectionBounds(doc, registry, ["avatar", "start"])).toEqual({
      minX: 280,
      minY: 920,
      maxX: 320,
      maxY: 960,
    });
    expect(selectionBounds(doc, registry, [])).toBeNull();
  });
});
