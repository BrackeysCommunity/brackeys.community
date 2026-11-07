import { describe, expect, it } from "vite-plus/test";

import { createRegistry } from "../../game/define";
import type { SceneDefinition } from "../../scene/types";
import yard from "../../scenes/engine-yard.json";
import {
  gizmoTarget,
  hitHandle,
  resizeCursor,
  selectionHandles,
  shapeHandles,
  STALK_PX,
  targetHandles,
} from "../gizmos";

const registry = createRegistry();
const def = structuredClone(yard) as unknown as SceneDefinition;
def.entities!.push(
  { id: "wedge", type: "solid", shape: ["poly", 600, 400, 700, 400, 650, 300] },
  { id: "rail", type: "solid", shape: ["chain", 100, 300, 300, 300, 400, 200] },
  { id: "pill", type: "prop", shape: ["capsule", 800, 300, 30, 10], density: 1, restitution: 0 },
);
const target = (ref: string) => gizmoTarget(def, registry, ref)!;
const ids = (hs: { id: string }[]) => hs.map((h) => h.id);

describe("shapeHandles", () => {
  it("gives a box move, eight resize handles and a rotate stalk", () => {
    const hs = shapeHandles(target("ledge").shape!, 1);
    expect(ids(hs)).toEqual([
      "move",
      "resize:nw",
      "resize:n",
      "resize:ne",
      "resize:e",
      "resize:se",
      "resize:s",
      "resize:sw",
      "resize:w",
      "rotate",
    ]);
    expect(hs.find((h) => h.id === "resize:se")!.at).toEqual([1520, 810]);
    expect(hs.find((h) => h.id === "rotate")!.at).toEqual([1400, 790 - STALK_PX]);
  });

  it("keeps the stalk a constant screen length", () => {
    const at = (scale: number) =>
      shapeHandles(target("ledge").shape!, scale).find((h) => h.id === "rotate")!.at;
    expect(at(2)).toEqual([1400, 790 - STALK_PX / 2]);
    expect(at(0.5)).toEqual([1400, 790 - STALK_PX * 2]);
  });

  it("turns a rotated box's handles and cursors with it", () => {
    const hs = shapeHandles({ type: "box", cx: 0, cy: 0, hw: 10, hh: 5, rotDeg: 90 }, 1);
    const e = hs.find((h) => h.id === "resize:e")!;
    expect(e.at[0]).toBeCloseTo(0);
    expect(e.at[1]).toBeCloseTo(10);
    expect(e.cursor).toBe("ns-resize");
    expect(resizeCursor([1, 1])).toBe("nwse-resize");
    expect(resizeCursor([-1, 1])).toBe("nesw-resize");
  });

  it("gives a circle a radius, a capsule length, radius and rotate, an outline rotate", () => {
    expect(ids(shapeHandles(target("crate").shape!, 1))).toEqual(["move", "radius"]);
    expect(ids(shapeHandles(target("pill").shape!, 1))).toEqual([
      "move",
      "length",
      "radius",
      "rotate",
    ]);
    expect(shapeHandles(target("pill").shape!, 1)[1]!.at).toEqual([800, 260]);
    expect(ids(shapeHandles(target("wedge").shape!, 1))).toEqual(["move", "rotate"]);
  });
});

describe("targetHandles", () => {
  it("gives a point a move handle only", () => {
    expect(ids(targetHandles(target("start"), { scale: 1 }))).toEqual(["move"]);
  });

  it("shows vertices and inserts in sub-object mode, closing a poly", () => {
    const poly = targetHandles(target("wedge"), { scale: 1, subObject: true });
    expect(ids(poly)).toEqual([
      "insert:0",
      "insert:1",
      "insert:2",
      "vertex:0",
      "vertex:1",
      "vertex:2",
    ]);
    expect(poly[2]!.at).toEqual([625, 350]);
    const chain = targetHandles(target("rail"), { scale: 1, subObject: true });
    expect(ids(chain)).toEqual(["insert:0", "insert:1", "vertex:0", "vertex:1", "vertex:2"]);
  });

  it("draws a follower's waypoints under its shape, and edits them in sub-object mode", () => {
    const hs = targetHandles(target("lift"), { scale: 1 });
    expect(ids(hs).slice(0, 3)).toEqual(["waypoint:0", "waypoint:1", "move"]);
    // Waypoint 0 sits under the move handle, which wins.
    expect(hitHandle(hs, [1700, 900], 1)!.id).toBe("move");
    const sub = targetHandles(target("lift"), { scale: 1, subObject: true });
    expect(ids(sub)).toEqual(["insert:0", "waypoint:0", "waypoint:1"]);
    expect(hitHandle(sub, [1700, 900], 1)!.id).toBe("waypoint:0");
  });
});

describe("hitHandle", () => {
  it("grabs within a constant screen distance", () => {
    const hs = shapeHandles(target("ledge").shape!, 1);
    expect(hitHandle(hs, [1525, 805], 1)!.id).toBe("resize:se");
    expect(hitHandle(hs, [1525, 805], 4)).toBeUndefined();
    expect(hitHandle(hs, [1300, 900], 1)).toBeUndefined();
  });
});

describe("selectionHandles", () => {
  it("is move and rotate only", () => {
    const hs = selectionHandles({ minX: 0, minY: 0, maxX: 100, maxY: 50 }, 1);
    expect(hs.map((h) => [h.id, h.at])).toEqual([
      ["move", [50, 25]],
      ["rotate", [50, -STALK_PX]],
    ]);
  });
});
