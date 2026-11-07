import { describe, expect, it } from "vite-plus/test";

import {
  aabb,
  centroid,
  containsPoint,
  isConvex,
  topSpan,
  translateShape,
} from "../shape-geometry";
import type { Pt } from "../types";

describe("aabb", () => {
  it("covers axis-aligned shapes", () => {
    expect(aabb({ type: "box", cx: 10, cy: 20, hw: 5, hh: 2, rotDeg: 0 })).toEqual({
      minX: 5,
      minY: 18,
      maxX: 15,
      maxY: 22,
    });
    expect(aabb({ type: "circle", cx: 0, cy: 0, r: 3 })).toEqual({
      minX: -3,
      minY: -3,
      maxX: 3,
      maxY: 3,
    });
    expect(
      aabb({
        type: "chain",
        pts: [
          [0, 5],
          [10, -5],
        ],
      }),
    ).toEqual({ minX: 0, minY: -5, maxX: 10, maxY: 5 });
  });

  it("rotates box corners", () => {
    const b = aabb({ type: "box", cx: 0, cy: 0, hw: 10, hh: 2, rotDeg: 90 });
    expect(b.minX).toBeCloseTo(-2);
    expect(b.maxX).toBeCloseTo(2);
    expect(b.minY).toBeCloseTo(-10);
    expect(b.maxY).toBeCloseTo(10);
    const d = aabb({ type: "box", cx: 0, cy: 0, hw: 1, hh: 1, rotDeg: 45 });
    expect(d.maxX).toBeCloseTo(Math.SQRT2);
    expect(aabb({ type: "box", cx: 0, cy: 0, hw: 10, hh: 2, rotDeg: 360 })).toEqual({
      minX: -10,
      minY: -2,
      maxX: 10,
      maxY: 2,
    });
  });

  it("rotates capsules, vertical before rotation", () => {
    const upright = aabb({ type: "capsule", cx: 0, cy: 0, halfLen: 10, r: 2, rotDeg: 0 });
    expect(upright).toEqual({ minX: -2, minY: -12, maxX: 2, maxY: 12 });
    const flat = aabb({ type: "capsule", cx: 0, cy: 0, halfLen: 10, r: 2, rotDeg: 90 });
    expect(flat.minX).toBeCloseTo(-12);
    expect(flat.maxY).toBeCloseTo(2);
  });
});

describe("isConvex", () => {
  const square: Pt[] = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ];
  it("accepts convex polygons in both windings, with collinear points", () => {
    expect(isConvex(square)).toBe(true);
    expect(isConvex([...square].reverse())).toBe(true);
    expect(
      isConvex([
        [0, 0],
        [5, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ]),
    ).toBe(true);
  });
  it("rejects concave, degenerate and self-intersecting outlines", () => {
    expect(
      isConvex([
        [0, 0],
        [10, 0],
        [5, 2],
        [10, 10],
        [0, 10],
      ]),
    ).toBe(false);
    expect(
      isConvex([
        [0, 0],
        [10, 0],
        [20, 0],
      ]),
    ).toBe(false);
    expect(
      isConvex([
        [0, 0],
        [10, 0],
        [10, 0],
        [0, 10],
      ]),
    ).toBe(false);
    expect(
      isConvex([
        [0, 0],
        [10, 10],
        [10, 0],
        [0, 10],
      ]),
    ).toBe(false);
    const star: Pt[] = [0, 2, 4, 1, 3].map((k) => [
      Math.cos((k * 2 * Math.PI) / 5) * 10,
      Math.sin((k * 2 * Math.PI) / 5) * 10,
    ]);
    expect(isConvex(star)).toBe(false);
    expect(
      isConvex([
        [0, 0],
        [1, 1],
      ]),
    ).toBe(false);
  });
});

describe("centroid, translate, contains, topSpan", () => {
  it("finds the area centroid", () => {
    expect(
      centroid([
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ]),
    ).toEqual([5, 5]);
    expect(
      centroid([
        [0, 0],
        [4, 0],
      ]),
    ).toEqual([2, 0]);
  });
  it("translates every form", () => {
    expect(
      translateShape({ type: "box", cx: 0, cy: 0, hw: 1, hh: 1, rotDeg: 0 }, [5, -5]),
    ).toMatchObject({ cx: 5, cy: -5 });
    expect(
      translateShape(
        {
          type: "poly",
          pts: [
            [0, 0],
            [1, 0],
            [0, 1],
          ],
        },
        [1, 1],
      ),
    ).toEqual({
      type: "poly",
      pts: [
        [1, 1],
        [2, 1],
        [1, 2],
      ],
    });
  });
  it("tests containment with tolerance", () => {
    const box = { type: "box", cx: 0, cy: 0, hw: 10, hh: 2, rotDeg: 0 } as const;
    expect(containsPoint(box, [9, 1])).toBe(true);
    expect(containsPoint(box, [11, 0])).toBe(false);
    expect(containsPoint(box, [11, 0], 1)).toBe(true);
    expect(containsPoint({ ...box, rotDeg: 90 }, [0, 9])).toBe(true);
    expect(containsPoint({ type: "circle", cx: 0, cy: 0, r: 5 }, [3, 4])).toBe(true);
    expect(
      containsPoint({ type: "capsule", cx: 0, cy: 0, halfLen: 10, r: 2, rotDeg: 0 }, [0, 11]),
    ).toBe(true);
    expect(
      containsPoint(
        {
          type: "poly",
          pts: [
            [0, 0],
            [10, 0],
            [0, 10],
          ],
        },
        [2, 2],
      ),
    ).toBe(true);
    expect(
      containsPoint(
        {
          type: "chain",
          pts: [
            [0, 0],
            [10, 0],
          ],
        },
        [5, 1],
        1,
      ),
    ).toBe(true);
    expect(
      containsPoint(
        {
          type: "chain",
          pts: [
            [0, 0],
            [10, 0],
          ],
        },
        [5, 1],
      ),
    ).toBe(false);
  });
  it("gives the top span", () => {
    expect(topSpan({ type: "box", cx: 100, cy: 1000, hw: 100, hh: 8, rotDeg: 0 })).toEqual([
      0, 200, 992,
    ]);
  });
});
