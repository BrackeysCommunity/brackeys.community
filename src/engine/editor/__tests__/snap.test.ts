import { describe, expect, it } from "vite-plus/test";

import { createRegistry } from "../../game/define";
import type { Aabb, SceneDefinition } from "../../scene/types";
import { roundPt, snapAngle, snapMove, snapPoint } from "../snap";
import { createSpatialIndex } from "../spatial-index";
import { DEFAULT_SNAP, type SnapSettings } from "../tools";

const grid64: SnapSettings = { ...DEFAULT_SNAP, geometry: false };
const off: SnapSettings = { ...DEFAULT_SNAP, enabled: false };

describe("roundPt and snapPoint", () => {
  it("rounds without -0", () => {
    expect(roundPt([-0.2, 2.5])).toEqual([0, 3]);
    expect(Object.is(roundPt([-0.2, 0])[0], 0)).toBe(true);
  });

  it("snaps to the grid step, or only rounds when bypassed or off", () => {
    expect(snapPoint([100, 31], DEFAULT_SNAP)).toEqual([128, 0]);
    expect(snapPoint([100, 31], { ...DEFAULT_SNAP, step: 8 })).toEqual([104, 32]);
    expect(snapPoint([100.4, 31.6], DEFAULT_SNAP, { bypass: true })).toEqual([100, 32]);
    expect(snapPoint([100.4, 31.6], off)).toEqual([100, 32]);
  });
});

describe("snapAngle", () => {
  it("snaps to 15°, and Shift is free", () => {
    expect(snapAngle(37, DEFAULT_SNAP, false)).toBe(30);
    expect(snapAngle(38, DEFAULT_SNAP, false)).toBe(45);
    expect(snapAngle(-7, DEFAULT_SNAP, false)).toBe(0);
    expect(Object.is(snapAngle(-7, DEFAULT_SNAP, false), 0)).toBe(true);
    expect(snapAngle(37.4, DEFAULT_SNAP, true)).toBe(37.4);
  });
});

/** A 64px box at 0..64 grabbed near its right edge. */
const box: Aabb = { minX: 0, minY: 0, maxX: 64, maxY: 32 };

describe("snapMove", () => {
  it("snaps the box edge nearest the grab to the grid, not the centre", () => {
    const right = snapMove({
      aabb: box,
      grab: [60, 4],
      delta: [70, 5],
      settings: grid64,
      scale: 1,
      bypass: false,
    });
    // The right edge (64 + 70 = 134) goes to 128.
    expect(right.delta).toEqual([64, 0]);
    expect(right.by).toEqual({ x: "grid", y: "grid" });
    const left = snapMove({
      aabb: box,
      grab: [4, 4],
      delta: [70, 5],
      settings: grid64,
      scale: 1,
      bypass: false,
    });
    // The left edge (0 + 70) goes to 64.
    expect(left.delta).toEqual([64, 0]);
    const odd: Aabb = { minX: 0, minY: 0, maxX: 40, maxY: 40 };
    expect(
      snapMove({
        aabb: odd,
        grab: [38, 2],
        delta: [30, 0],
        settings: grid64,
        scale: 1,
        bypass: false,
      }).delta,
    ).toEqual([24, 0]);
  });

  it("Ctrl/Cmd bypasses snapping but still rounds", () => {
    const r = snapMove({
      aabb: box,
      grab: [60, 28],
      delta: [70.6, 5.2],
      settings: grid64,
      scale: 1,
      bypass: true,
    });
    expect(r).toEqual({ delta: [71, 5], guides: [], by: {} });
    expect(
      snapMove({
        aabb: box,
        grab: [0, 0],
        delta: [70.6, 5.2],
        settings: off,
        scale: 1,
        bypass: false,
      }).delta,
    ).toEqual([71, 5]);
  });

  describe("geometry targets", () => {
    const def: SceneDefinition = {
      v: 1,
      name: "snap",
      bounds: [0, 0, 2000, 1000],
      entities: [
        // Edges at x 300 and 340, y 500 and 540; centre 320, 520.
        { id: "post", type: "solid", shape: ["box", 320, 520, 20, 20] },
        // A vertex at 403, 203.
        { id: "tri", type: "solid", shape: ["poly", 403, 203, 450, 260, 380, 260] },
        { id: "mark", type: "marker", at: [710, 77] },
        { id: "self", type: "solid", shape: ["box", 32, 16, 32, 16] },
      ],
    };
    const index = createSpatialIndex();
    index.rebuild(def, createRegistry());
    const fine: SnapSettings = { ...DEFAULT_SNAP, step: 64 };
    const move = (grab: [number, number], delta: [number, number], scale = 1) =>
      snapMove({
        aabb: box,
        grab,
        delta,
        settings: fine,
        index,
        exclude: ["self"],
        scale,
        bypass: false,
      });

    it("prefers a nearby edge over a farther grid line, with a guide", () => {
      // Right edge 64 + 242 = 306: post's left edge (300) is 6px away, the grid line 320 is 14.
      const r = move([60, 4], [242, 470]);
      expect(r.delta[0]).toBe(236);
      expect(r.by.x).toBe("edge");
      // y snapped to the grid (448), so the guide runs from the moved box's top to post's bottom.
      expect(r.guides).toEqual([{ from: [300, 448], to: [300, 540] }]);
    });

    it("snaps to vertices and point entities", () => {
      // Left edge 0 + 405 = 405: tri's vertex at 403.
      expect(move([2, 2], [405, 100]).by.x).toBe("vertex");
      expect(move([2, 2], [405, 100]).delta[0]).toBe(403);
      // Top edge 0 + 74 = 74: the marker at y 77.
      const r = move([2, 2], [690, 74]);
      expect(r.by.y).toBe("vertex");
      expect(r.delta[1]).toBe(77);
    });

    it("snaps to centres last", () => {
      // Left edge to 322: post's centre at 320 is 2px away and the grid line 320 is the same, so the grid wins.
      expect(move([2, 2], [322, 0]).by.x).toBe("grid");
      const r = snapMove({
        aabb: box,
        grab: [2, 2],
        delta: [323, 480],
        settings: { ...fine, step: 128 },
        index,
        exclude: ["self"],
        scale: 1,
        bypass: false,
      });
      expect(r.by.x).toBe("center");
      expect(r.delta[0]).toBe(320);
    });

    it("reaches about 8 screen px, so less world px when zoomed in", () => {
      expect(move([60, 4], [242, 470], 1).by.x).toBe("edge");
      expect(move([60, 4], [242, 470], 4).by.x).toBe("grid");
    });

    it("snaps to the grid only when geometry is off", () => {
      const r = snapMove({
        aabb: box,
        grab: [60, 4],
        delta: [242, 470],
        settings: grid64,
        index,
        scale: 1,
        bypass: false,
      });
      expect(r.by.x).toBe("grid");
      expect(r.guides).toEqual([]);
    });
  });
});
