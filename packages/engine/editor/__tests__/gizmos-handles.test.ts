import { describe, expect, it } from "vite-plus/test";

import { createRegistry } from "../../game/define";
import type { EntityDef, Pt, SceneDefinition } from "../../scene/types";
import yard from "../../scenes/engine-yard.json";
import {
  frameHandles,
  gizmoTarget,
  HANDLE_HIT_PX,
  HANDLE_PX,
  hitHandle,
  resizeCursor,
  selectionHandles,
  shapeHandles,
  STALK_PX,
  targetHandles,
} from "../gizmos";
import * as tree from "../gizmos/__tests__/tree-fixture";
import type { GizmoHandle } from "../tools";

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

  it("takes the drawn square on top, else the nearest handle in reach", () => {
    const hs: GizmoHandle[] = [
      { id: "under", kind: "resize", at: [0, 0] },
      { id: "over", kind: "vertex", at: [5, 0] },
    ];
    expect(hitHandle(hs, [3, 0], 1)!.id).toBe("over");
    expect(hitHandle(hs, [0, 0], 1)!.id).toBe("under");
    expect(hitHandle(hs, [-5, 0], 1)!.id).toBe("under");
    expect(hitHandle([...hs, { id: "same", kind: "move", at: [5, 0] }], [5, 0], 1)!.id).toBe(
      "same",
    );
  });
});

describe("a joint's stacked anchors on a thin collider", () => {
  /** A 0.8 x 0.1 m chain link whose anchors meet `along` metres from its centre. */
  const thinLink = (along: number, rotDeg: number): SceneDefinition => {
    const rad = (rotDeg * Math.PI) / 180;
    const meet: Pt = [10 + along * Math.cos(rad), 5 + along * Math.sin(rad)];
    const post: EntityDef = { id: "post", type: "marker", at: meet };
    const link: EntityDef = {
      id: "link",
      type: "marker",
      at: [10, 5],
      behaviors: {
        body: {},
        collider: { shape: ["box", 0, 0, 0.4, 0.05, rotDeg] },
        joint: {
          kind: "revolute",
          to: "post",
          anchorA: [meet[0] - 10, meet[1] - 5],
          anchorB: [0, 0],
        },
      },
    };
    return { v: 1, name: "thin", bounds: [0, 0, 20, 20], entities: [post, link] };
  };
  const gap = (a: Pt, b: Pt, scale: number) =>
    Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])) * scale;
  /** Whether some screen pixel of the handle's drawn square grabs it. */
  const reachable = (hs: GizmoHandle[], id: string, scale: number) => {
    const at = hs.find((h) => h.id === id)!.at;
    const half = HANDLE_PX / 2;
    for (let x = -half; x <= half; x++)
      for (let y = -half; y <= half; y++)
        if (hitHandle(hs, [at[0] + x / scale, at[1] + y / scale], scale)?.id === id) return true;
    return false;
  };

  for (const scale of [32, 64, 90, 100])
    for (const rotDeg of [0, 90])
      it(`leaves every handle grabbable at ${scale} px per metre, turned ${rotDeg}°`, () => {
        for (const along of [-0.4, -0.3, -0.26, -0.2, 0.1, 0.14, 0.3, 0.4]) {
          const t = gizmoTarget(thinLink(along, rotDeg), registry, "link")!;
          const hs = targetHandles(t, { scale });
          const a = hs.find((h) => h.id === "joint:anchorA")!;
          for (const h of hs)
            if (h !== a && h.id.startsWith("collider:"))
              expect(gap(a.at, h.at, scale), `${along}: ${h.id}`).toBeGreaterThanOrEqual(
                2 * HANDLE_HIT_PX - 1e-6,
              );
          expect(hitHandle(hs, a.at, scale)?.id).toBe("joint:anchorA");
          for (const h of hs) expect(reachable(hs, h.id, scale), `${along}: ${h.id}`).toBe(true);
        }
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

describe("frame handles", () => {
  const frameTarget = (ref: string) => gizmoTarget(tree.view, tree.registry, ref, tree.source)!;

  it("gives an instance and a node a move handle at the origin and a rotate stalk", () => {
    for (const ref of ["turret-a", "tilt"]) {
      const t = frameTarget(ref);
      const hs = targetHandles(t, { scale: S });
      expect(ids(hs)).toEqual(["move", "rotate"]);
      expect(hs[0]!.at).toEqual(t.frame!.at);
      expect(hs[1]).toMatchObject({ kind: "rotate", cursor: "grab", stalk: t.frame!.at });
      // The stalk clears the box over the subtree by the stalk's length, straight up.
      expectAt(hs[1]!.at, [t.frame!.at[0], t.box!.minY - STALK_PX / S]);
    }
  });

  it("points the stalk along the frame's up, out past what sits under it", () => {
    const hs = frameHandles({ at: [0, 0], rot: 90 }, { minX: -1, minY: -1, maxX: 2, maxY: 1 }, S);
    // Turned a quarter clockwise, the frame's up is world +x.
    expectAt(hs[1]!.at, [2 + STALK_PX / S, 0]);
    expect(hs[1]!.stalk).toEqual([0, 0]);
  });

  it("puts a lone node's rotate handle one stalk above it", () => {
    const hs = frameHandles({ at: [3, 3], rot: 0 }, undefined, S);
    expectAt(hs[1]!.at, [3, 3 - STALK_PX / S]);
  });
});
