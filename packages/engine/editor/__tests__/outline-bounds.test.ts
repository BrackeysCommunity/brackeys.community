import { describe, expect, it } from "vite-plus/test";

import { createRegistry } from "../../game/define";
import { SCENE_FORMAT_VERSION, type SceneDefinition } from "../../scene/types";
import { outlineBounds, outlineLook, outlinesOfRef, type OutlineMarks } from "../outline-bounds";

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
