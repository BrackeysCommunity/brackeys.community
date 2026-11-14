import { describe, expect, it } from "vite-plus/test";

import { createRegistry } from "../../game/define";
import { SCENE_FORMAT_VERSION, type SceneDefinition } from "../../scene/types";
import * as tree from "../gizmos/__tests__/tree-fixture";
import {
  isComposite,
  outlineBounds,
  outlineLook,
  outlinesOfRef,
  type OutlineMarks,
} from "../outline-bounds";

const registry = createRegistry();
const look = outlineLook(registry);

const def: SceneDefinition = {
  v: SCENE_FORMAT_VERSION,
  name: "regions",
  bounds: [0, 0, 20, 10],
  entities: [
    { id: "hall", type: "camera-region", shape: ["box", 5, 5, 2, 2, 45] },
    { id: "tilted", type: "solid", shape: ["box", 15, 5, 2, 2, 45] },
  ],
};

const outlinesOf = (ref: string) => {
  const marks: OutlineMarks = { outlines: [], points: [] };
  outlinesOfRef(def, ref, "selected", marks, look);
  return marks.outlines.map((o) => o.shape);
};

describe("camera region outlines", () => {
  it("outlines a turned region by the box it frames, as the canvas draws it", () => {
    const [shape, ...rest] = outlinesOf("hall");
    expect(rest).toEqual([]);
    expect(shape).toMatchObject({ type: "box", cx: 5, cy: 5, rotDeg: 0 });
    const half = 2 * Math.SQRT2;
    const box = outlineBounds(def, ["hall"], look)!;
    expect(box.minX).toBeCloseTo(5 - half, 9);
    expect(box.maxY).toBeCloseTo(5 + half, 9);
  });

  it("outlines any other turned shape as authored", () => {
    expect(outlinesOf("tilted")).toEqual([
      { type: "box", cx: 15, cy: 5, hw: 2, hh: 2, rotDeg: 45 },
    ]);
  });
});

describe("outlines by the tree", () => {
  const withDoc = outlineLook(tree.registry, undefined, tree.source);

  it("bounds a parent with everything under it", () => {
    expect(outlineBounds(tree.view, ["tilt"], withDoc)).toEqual({
      minX: 9.5,
      minY: 4.4,
      maxX: 12,
      maxY: 6.1,
    });
    // Without the document, the instance under the node is out of sight.
    expect(outlineBounds(tree.view, ["tilt"], outlineLook(tree.registry))).toEqual({
      minX: 9.5,
      minY: 5,
      maxX: 10.5,
      maxY: 6.1,
    });
    expect(outlineBounds(tree.view, ["tilt-board"], withDoc)).toEqual({
      minX: 9.5,
      minY: 5.9,
      maxX: 10.5,
      maxY: 6.1,
    });
  });

  it("outlines an instance's children and the document's entities under them, as the instance", () => {
    const marks: OutlineMarks = { outlines: [], points: [] };
    outlinesOfRef(tree.view, "turret-a", "selected", marks, withDoc);
    expect(marks.outlines.map((o) => o.ref)).toEqual(["turret-a", "turret-a"]);
    expect(marks.points).toEqual([{ at: [2.5, 5.2], tone: "selected", ref: "turret-a" }]);
  });

  it("calls an instance and a node with children composite, and nothing else", () => {
    expect(isComposite(tree.view, "turret-a", withDoc)).toBe(true);
    expect(isComposite(tree.view, "tilt", withDoc)).toBe(true);
    expect(isComposite(tree.view, "tilt-board", withDoc)).toBe(false);
    expect(isComposite(tree.view, "lone", withDoc)).toBe(false);
  });
});
