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
  { id: "wedge", type: "solid", shape: ["poly", 6, 4, 7, 4, 6.5, 3] },
  { id: "rail", type: "solid", shape: ["chain", 1, 3, 3, 3, 4, 2] },
  { id: "pill", type: "prop", shape: ["capsule", 8, 3, 0.3, 0.1], density: 1, restitution: 0 },
);
const target = (ref: string) => gizmoTarget(def, registry, ref)!;
const ids = (hs: { id: string }[]) => hs.map((h) => h.id);
/** Screen px per metre at zoom 1. */
const S = 100;
const expectAt = ([x, y]: readonly number[], [ex, ey]: readonly number[]) => {
  expect(x).toBeCloseTo(ex!, 9);
  expect(y).toBeCloseTo(ey!, 9);
};

describe("shapeHandles", () => {
  it("gives a box move, eight resize handles and a rotate stalk", () => {
    const hs = shapeHandles(target("ledge").shape!, S);
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
    expectAt(hs.find((h) => h.id === "resize:se")!.at, [15.2, 8.1]);
    expectAt(hs.find((h) => h.id === "rotate")!.at, [14, 7.9 - STALK_PX / S]);
  });

  it("keeps the stalk a constant screen length", () => {
    const at = (scale: number) =>
      shapeHandles(target("ledge").shape!, scale).find((h) => h.id === "rotate")!.at;
    expectAt(at(2 * S), [14, 7.9 - STALK_PX / (2 * S)]);
    expectAt(at(0.5 * S), [14, 7.9 - STALK_PX / (0.5 * S)]);
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
    expect(ids(shapeHandles(target("crate").shape!, S))).toEqual(["move", "radius"]);
    expect(ids(shapeHandles(target("pill").shape!, S))).toEqual([
      "move",
      "length",
      "radius",
      "rotate",
    ]);
    expectAt(shapeHandles(target("pill").shape!, S)[1]!.at, [8, 2.6]);
    expect(ids(shapeHandles(target("wedge").shape!, S))).toEqual(["move", "rotate"]);
  });
});

describe("targetHandles", () => {
  it("gives a point a move handle only", () => {
    expect(ids(targetHandles(target("start"), { scale: S }))).toEqual(["move"]);
  });

  it("shows vertices and inserts in sub-object mode, closing a poly", () => {
    const poly = targetHandles(target("wedge"), { scale: S, subObject: true });
    expect(ids(poly)).toEqual([
      "insert:0",
      "insert:1",
      "insert:2",
      "vertex:0",
      "vertex:1",
      "vertex:2",
    ]);
    expectAt(poly[2]!.at, [6.25, 3.5]);
    const chain = targetHandles(target("rail"), { scale: S, subObject: true });
    expect(ids(chain)).toEqual(["insert:0", "insert:1", "vertex:0", "vertex:1", "vertex:2"]);
  });

  it("draws a follower's waypoints under its shape, and edits them in sub-object mode", () => {
    const hs = targetHandles(target("lift"), { scale: S });
    expect(ids(hs).slice(0, 3)).toEqual(["waypoint:0", "waypoint:1", "move"]);
    // Waypoint 0 sits under the move handle, which wins.
    expect(hitHandle(hs, [17, 9], S)!.id).toBe("move");
    const sub = targetHandles(target("lift"), { scale: S, subObject: true });
    expect(ids(sub)).toEqual(["insert:0", "waypoint:0", "waypoint:1"]);
    expect(hitHandle(sub, [17, 9], S)!.id).toBe("waypoint:0");
  });
});

describe("hitHandle", () => {
  it("grabs within a constant screen distance", () => {
    const hs = shapeHandles(target("ledge").shape!, S);
    expect(hitHandle(hs, [15.25, 8.05], S)!.id).toBe("resize:se");
    expect(hitHandle(hs, [15.25, 8.05], 4 * S)).toBeUndefined();
    expect(hitHandle(hs, [13, 9], S)).toBeUndefined();
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
