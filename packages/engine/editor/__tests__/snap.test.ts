import { describe, expect, it } from "vite-plus/test";

import { createRegistry } from "../../game/define";
import type { Aabb, Pt, SceneDefinition } from "../../scene/types";
import { isWholePixel, roundLength } from "../../scene/units";
import {
  onePixel,
  pixelSize,
  roundPt,
  snapAngle,
  snapMove,
  snapPoint,
  snapToGrid,
  type SnapMoveInput,
} from "../snap";
import { createSpatialIndex } from "../spatial-index";
import { DEFAULT_SNAP, SNAP_STEPS, type SnapSettings } from "../tools";

/** The default game's px per metre. */
const PPM = 100;
/** A 0.64 m grid with geometry snapping off. */
const grid: SnapSettings = { ...DEFAULT_SNAP, step: 0.64, geometry: false };
const off: SnapSettings = { ...DEFAULT_SNAP, enabled: false };

const whole = (p: Pt, ppm: number) => p.every((v) => isWholePixel(v, ppm));
const guidesOf = (r: { guides: { from: Pt; to: Pt }[] }) =>
  r.guides.map((g) => ({ from: g.from.map(roundLength), to: g.to.map(roundLength) }));

describe("roundPt and snapPoint", () => {
  it("lands on whole world px without -0", () => {
    expect(roundPt([-0.002, 0.025], PPM)).toEqual([0, 0.03]);
    expect(Object.is(roundPt([-0.002, 0], PPM)[0], 0)).toBe(true);
    // One world px at 32 px per metre is 0.03125 m.
    expect(roundPt([0.04, 0.05], 32)).toEqual([0.03125, 0.0625]);
  });

  it("snaps to the grid step in metres, or only lands on whole px when bypassed or off", () => {
    expect(snapPoint([1, 0.31], DEFAULT_SNAP, PPM)).toEqual([1, 0.5]);
    expect(snapPoint([1, 0.31], { ...DEFAULT_SNAP, step: 0.25 }, PPM)).toEqual([1, 0.25]);
    expect(snapPoint([1.004, 0.316], DEFAULT_SNAP, PPM, { bypass: true })).toEqual([1, 0.32]);
    expect(snapPoint([1.004, 0.316], off, PPM)).toEqual([1, 0.32]);
  });

  it("lands on whole px at 100, 32 and 48 px per metre", () => {
    for (const ppm of [100, 32, 48]) {
      for (const p of [
        [1.2345, -0.4321],
        [0.0001, 7.77777],
        [-3.141592, 2.718281],
      ] as Pt[]) {
        expect(whole(snapPoint(p, off, ppm), ppm)).toBe(true);
        expect(whole(snapPoint(p, DEFAULT_SNAP, ppm, { bypass: true }), ppm)).toBe(true);
        expect(whole(snapPoint(p, DEFAULT_SNAP, ppm), ppm)).toBe(true);
      }
    }
    // At 48 px per metre a whole px is a repeating decimal, written to micrometres.
    expect(snapPoint([0.1, 0], off, 48)).toEqual([0.104167, 0]);
  });

  it("puts every grid step on whole px at 100, 32 and 48 px per metre", () => {
    for (const ppm of [100, 32, 48])
      for (const step of SNAP_STEPS) {
        expect(isWholePixel(step, ppm)).toBe(true);
        expect(snapToGrid(step * 3 + 0.01, step, ppm)).toBe(roundLength(step * 3));
      }
  });

  it("keeps sizes at least one world px", () => {
    expect(onePixel(100)).toBe(0.01);
    expect(onePixel(48)).toBe(0.020833);
    expect(pixelSize(0.001, 100)).toBe(0.01);
    expect(pixelSize(0.236, 100)).toBe(0.24);
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

/** A 0.64 m box at 0..0.64 grabbed near its right edge. */
const box: Aabb = { minX: 0, minY: 0, maxX: 0.64, maxY: 0.32 };

/** Screen px per metre at zoom 1 for a game at `PPM`. */
const zoom = (z: number) => PPM * z;

const plain = (input: Partial<SnapMoveInput> & Pick<SnapMoveInput, "grab" | "delta">) =>
  snapMove({
    aabb: box,
    settings: grid,
    scale: zoom(1),
    pxPerMetre: PPM,
    bypass: false,
    ...input,
  });

describe("snapMove", () => {
  it("snaps the box edge nearest the grab to the grid, not the centre", () => {
    const right = plain({ grab: [0.6, 0.04], delta: [0.7, 0.05] });
    // The right edge (0.64 + 0.7 = 1.34) goes to 1.28.
    expect(right.delta).toEqual([0.64, 0]);
    expect(right.by).toEqual({ x: "grid", y: "grid" });
    // The left edge (0 + 0.7) goes to 0.64.
    expect(plain({ grab: [0.04, 0.04], delta: [0.7, 0.05] }).delta).toEqual([0.64, 0]);
    const odd: Aabb = { minX: 0, minY: 0, maxX: 0.4, maxY: 0.4 };
    expect(plain({ aabb: odd, grab: [0.38, 0.02], delta: [0.3, 0] }).delta).toEqual([0.24, 0]);
  });

  it("Ctrl/Cmd bypasses snapping but still lands on whole world px", () => {
    const r = plain({ grab: [0.6, 0.28], delta: [0.706, 0.052], bypass: true });
    expect(r).toEqual({ delta: [0.71, 0.05], guides: [], by: {} });
    expect(plain({ grab: [0, 0], delta: [0.706, 0.052], settings: off }).delta).toEqual([
      0.71, 0.05,
    ]);
  });

  it("lands every free and snapped drag on whole px at 100, 32 and 48 px per metre", () => {
    for (const ppm of [100, 32, 48]) {
      // A box on whole px at this px per metre: 20 by 10 px.
      const onPx: Aabb = {
        minX: 0,
        minY: 0,
        maxX: roundLength(20 / ppm),
        maxY: roundLength(10 / ppm),
      };
      for (const delta of [
        [0.70613, 0.05291],
        [-1.3333, 2.0001],
      ] as Pt[]) {
        const input = {
          aabb: onPx,
          grab: [onPx.maxX, 0] as Pt,
          delta,
          scale: ppm,
          pxPerMetre: ppm,
        };
        expect(whole(snapMove({ ...input, settings: off, bypass: false }).delta, ppm)).toBe(true);
        expect(whole(snapMove({ ...input, settings: grid, bypass: true }).delta, ppm)).toBe(true);
        const step = { ...DEFAULT_SNAP, step: 0.25, geometry: false };
        const snapped = snapMove({ ...input, settings: step, bypass: false });
        expect(whole(snapped.delta, ppm)).toBe(true);
        // The grabbed (right) edge lands on a 0.25 m grid line.
        const edge = onPx.maxX + snapped.delta[0];
        expect(Math.abs(edge / 0.25 - Math.round(edge / 0.25))).toBeLessThan(1e-5);
      }
    }
  });

  describe("geometry targets", () => {
    const def: SceneDefinition = {
      v: 1,
      name: "snap",
      bounds: [0, 0, 20, 10],
      entities: [
        // Edges at x 3 and 3.4, y 5 and 5.4; centre 3.2, 5.2.
        { id: "post", type: "solid", shape: ["box", 3.2, 5.2, 0.2, 0.2] },
        // A vertex at 4.03, 2.03.
        { id: "tri", type: "solid", shape: ["poly", 4.03, 2.03, 4.5, 2.6, 3.8, 2.6] },
        { id: "mark", type: "marker", at: [7.1, 0.77] },
        { id: "self", type: "solid", shape: ["box", 0.32, 0.16, 0.32, 0.16] },
      ],
    };
    const index = createSpatialIndex();
    index.rebuild(def, createRegistry());
    const fine: SnapSettings = { ...DEFAULT_SNAP, step: 0.64 };
    const move = (grab: Pt, delta: Pt, z = 1) =>
      plain({ grab, delta, settings: fine, index, exclude: ["self"], scale: zoom(z) });

    it("prefers a nearby edge over a farther grid line, with a guide", () => {
      // Right edge 0.64 + 2.42 = 3.06: post's left edge (3) is 6 px away, the grid line 3.2 is 14.
      const r = move([0.6, 0.04], [2.42, 4.7]);
      expect(r.delta[0]).toBe(2.36);
      expect(r.by.x).toBe("edge");
      // The x guide runs from the moved box's top (y snapped to 4.48) to post's bottom; the y grid
      // line's runs across the moved box (2.36..3), 16 screen px past each side.
      expect(guidesOf(r)).toEqual([
        { from: [3, 4.48], to: [3, 5.4] },
        { from: [2.2, 4.48], to: [3.16, 4.48] },
      ]);
    });

    it("snaps to vertices and point entities", () => {
      // Left edge 0 + 4.05 = 4.05: tri's vertex at 4.03.
      expect(move([0.02, 0.02], [4.05, 1]).by.x).toBe("vertex");
      expect(move([0.02, 0.02], [4.05, 1]).delta[0]).toBe(4.03);
      // Top edge 0 + 0.74 = 0.74: the marker at y 0.77.
      const r = move([0.02, 0.02], [6.9, 0.74]);
      expect(r.by.y).toBe("vertex");
      expect(r.delta[1]).toBe(0.77);
    });

    it("snaps to centres last", () => {
      // Left edge to 3.22: post's centre at 3.2 is 2 px away and the grid line 3.2 is the same, so the grid wins.
      expect(move([0.02, 0.02], [3.22, 0]).by.x).toBe("grid");
      const r = plain({
        grab: [0.02, 0.02],
        delta: [3.23, 4.8],
        settings: { ...fine, step: 1.28 },
        index,
        exclude: ["self"],
      });
      expect(r.by.x).toBe("center");
      expect(r.delta[0]).toBe(3.2);
    });

    it("reaches about 8 screen px, so fewer metres when zoomed in", () => {
      expect(move([0.6, 0.04], [2.42, 4.7], 1).by.x).toBe("edge");
      expect(move([0.6, 0.04], [2.42, 4.7], 4).by.x).toBe("grid");
    });

    it("snaps to the grid only when geometry is off", () => {
      const r = plain({ grab: [0.6, 0.04], delta: [2.42, 4.7], index });
      expect(r.by.x).toBe("grid");
      // Each axis's grid line, across the moved box (2.56..3.2, 4.48..4.8) and 16 screen px past it.
      expect(r.delta).toEqual([2.56, 4.48]);
      expect(guidesOf(r)).toEqual([
        { from: [3.2, 4.32], to: [3.2, 4.96] },
        { from: [2.4, 4.48], to: [3.36, 4.48] },
      ]);
    });

    it("keeps a grid guide 16 screen px past the box when zoomed", () => {
      const r = plain({ grab: [0.6, 0.04], delta: [0.7, 0.05], scale: zoom(4) });
      expect(guidesOf(r)[0]).toEqual({ from: [1.28, -0.04], to: [1.28, 0.36] });
    });
  });
});
