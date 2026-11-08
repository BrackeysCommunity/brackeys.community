import { describe, expect, it } from "vite-plus/test";

import {
  convexHull,
  signedArea,
  aabb,
  boxCorners,
  centroid,
  closestOnSegment,
  containedInRect,
  containsPoint,
  intersectsRect,
  isConvex,
  nearestSegment,
  nearestVertex,
  normDeg,
  rotateShape,
  shapeVertices,
  topSpan,
  translateShape,
} from "../shape-geometry";
import type { Aabb, Pt, ShapeObj } from "../types";

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

  it("turns a full revolution past a non-quarter angle bit for bit like the angle itself", () => {
    const box = { type: "box", cx: 3, cy: 7, hw: 11, hh: 4, rotDeg: 45 } as const;
    expect(boxCorners({ ...box, rotDeg: 405 })).toEqual(boxCorners(box));
    expect(boxCorners({ ...box, rotDeg: -405 })).toEqual(boxCorners({ ...box, rotDeg: -45 }));
    expect(aabb({ ...box, rotDeg: 765 })).toEqual(aabb(box));
    const cap = { type: "capsule", cx: 0, cy: 0, halfLen: 9, r: 2, rotDeg: 30 } as const;
    expect(aabb({ ...cap, rotDeg: 390 })).toEqual(aabb(cap));
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

describe("convexHull", () => {
  it("drops inner, collinear and repeated points and keeps the input's winding", () => {
    const pts: Pt[] = [
      [0, 0],
      [5, 0],
      [10, 0],
      [5, 3],
      [10, 10],
      [10, 10],
      [0, 10],
    ];
    const hull = convexHull(pts);
    expect(hull).toHaveLength(4);
    expect(isConvex(hull)).toBe(true);
    expect(Math.sign(signedArea(hull))).toBe(Math.sign(signedArea(pts)));
    expect(Math.sign(signedArea(convexHull([...pts].reverse())))).toBe(
      Math.sign(signedArea([...pts].reverse())),
    );
  });

  it("returns fewer than 3 points for points on one line", () => {
    expect(
      convexHull([
        [0, 0],
        [5, 5],
        [10, 10],
      ]).length,
    ).toBeLessThan(3);
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

const rect = (minX: number, minY: number, maxX: number, maxY: number): Aabb => ({
  minX,
  minY,
  maxX,
  maxY,
});

describe("intersectsRect", () => {
  it("treats an unrotated box as its bounds, edges included", () => {
    const b: ShapeObj = { type: "box", cx: 0, cy: 0, hw: 10, hh: 5, rotDeg: 0 };
    expect(intersectsRect(b, rect(10, 5, 20, 20))).toBe(true);
    expect(intersectsRect(b, rect(10.1, 0, 20, 1))).toBe(false);
  });

  it("is exact for a rotated box", () => {
    const d: ShapeObj = { type: "box", cx: 0, cy: 0, hw: 10, hh: 10, rotDeg: 45 };
    // Inside the AABB's corner but outside the diamond.
    expect(intersectsRect(d, rect(10, 10, 14, 14))).toBe(false);
    expect(intersectsRect(d, rect(6, 6, 8, 8))).toBe(true);
    // A rect wholly inside the box.
    expect(intersectsRect(d, rect(-1, -1, 1, 1))).toBe(true);
  });

  it("measures circles and capsules by distance", () => {
    const c: ShapeObj = { type: "circle", cx: 0, cy: 0, r: 10 };
    expect(intersectsRect(c, rect(8, 8, 20, 20))).toBe(false);
    expect(intersectsRect(c, rect(7, 7, 20, 20))).toBe(true);
    const cap: ShapeObj = { type: "capsule", cx: 0, cy: 0, halfLen: 20, r: 5, rotDeg: 0 };
    expect(intersectsRect(cap, rect(4, -30, 10, -26))).toBe(false);
    expect(intersectsRect(cap, rect(4, -10, 10, 10))).toBe(true);
    expect(intersectsRect(cap, rect(-2, -26, 2, -24))).toBe(true);
    // Turned flat, the same capsule reaches along x.
    expect(intersectsRect({ ...cap, rotDeg: 90 }, rect(22, -1, 30, 1))).toBe(true);
    expect(intersectsRect({ ...cap, rotDeg: 90 }, rect(-1, 22, 1, 30))).toBe(false);
  });

  it("tests a poly's outline and inside, convex or not", () => {
    const l: ShapeObj = {
      type: "poly",
      pts: [
        [0, 0],
        [20, 0],
        [20, 5],
        [5, 5],
        [5, 20],
        [0, 20],
      ],
    };
    expect(intersectsRect(l, rect(10, 10, 15, 15))).toBe(false);
    expect(intersectsRect(l, rect(1, 1, 2, 2))).toBe(true);
    expect(intersectsRect(l, rect(-5, -5, 30, 30))).toBe(true);
  });

  it("tests a chain's segments only", () => {
    const v: ShapeObj = {
      type: "chain",
      pts: [
        [0, 0],
        [10, 10],
        [20, 0],
      ],
    };
    expect(intersectsRect(v, rect(9, 2, 11, 4))).toBe(false);
    expect(intersectsRect(v, rect(9, 9, 11, 11))).toBe(true);
    expect(intersectsRect(v, rect(-1, -1, 1, 1))).toBe(true);
  });
});

describe("containedInRect", () => {
  it("needs the whole shape inside, edges included", () => {
    const b: ShapeObj = { type: "box", cx: 0, cy: 0, hw: 10, hh: 5, rotDeg: 0 };
    expect(containedInRect(b, rect(-10, -5, 10, 5))).toBe(true);
    expect(containedInRect(b, rect(-9, -5, 10, 5))).toBe(false);
    expect(containedInRect({ ...b, rotDeg: 90 }, rect(-5, -10, 5, 10))).toBe(true);
  });
});

describe("nearestVertex and nearestSegment", () => {
  const tri: ShapeObj = {
    type: "poly",
    pts: [
      [0, 0],
      [10, 0],
      [0, 10],
    ],
  };
  it("finds the nearest point", () => {
    expect(nearestVertex(tri, [9, 1])).toEqual({ index: 1, at: [10, 0], dist: Math.SQRT2 });
    expect(nearestVertex({ type: "circle", cx: 0, cy: 0, r: 1 }, [0, 0])).toBeNull();
  });

  it("includes a poly's closing segment but not a chain's", () => {
    const left = nearestSegment(tri, [-2, 5]);
    expect(left).toMatchObject({ index: 2, at: [0, 5], t: 0.5, dist: 2 });
    const chain: ShapeObj = { type: "chain", pts: tri.type === "poly" ? tri.pts : [] };
    expect(nearestSegment(chain, [-2, 5])!.index).not.toBe(2);
    expect(nearestSegment(chain, [5, -3])).toMatchObject({ index: 0, at: [5, 0], t: 0.5, dist: 3 });
  });

  it("clamps to the segment's ends", () => {
    expect(closestOnSegment([-5, 0], [0, 0], [10, 0])).toEqual({ at: [0, 0], t: 0, dist: 5 });
  });
});

describe("rotateShape and shapeVertices", () => {
  it("turns clockwise on screen about a point", () => {
    const r = rotateShape(
      {
        type: "chain",
        pts: [
          [10, 0],
          [20, 0],
        ],
      },
      [0, 0],
      90,
    );
    expect(r.type === "chain" && r.pts.map(([x, y]) => [Math.round(x), Math.round(y)])).toEqual([
      [0, 10],
      [0, 20],
    ]);
  });

  it("moves a box's centre and adds to its rotDeg, without rounding", () => {
    const r = rotateShape({ type: "box", cx: 10, cy: 0, hw: 5, hh: 2, rotDeg: 10 }, [0, 0], 30);
    expect(r).toMatchObject({ type: "box", hw: 5, hh: 2, rotDeg: 40 });
    if (r.type !== "box") throw new Error("box");
    expect(r.cx).toBeCloseTo(10 * Math.cos(Math.PI / 6));
    expect(r.cy).toBeCloseTo(5);
  });

  it("turns by quarter turns exactly, with no -0", () => {
    const chain: ShapeObj = {
      type: "chain",
      pts: [
        [10, 0],
        [20, 5],
      ],
    };
    expect(rotateShape(chain, [0, 0], 90)).toEqual({
      type: "chain",
      pts: [
        [0, 10],
        [-5, 20],
      ],
    });
    expect(rotateShape(chain, [5, 5], 180)).toEqual({
      type: "chain",
      pts: [
        [0, 10],
        [-10, 5],
      ],
    });
    expect(rotateShape(chain, [0, 0], -90)).toEqual(rotateShape(chain, [0, 0], 270));
    const pt = rotateShape({ type: "poly", pts: [[0, 0]] }, [0, 0], 90);
    expect(pt.type === "poly" && pt.pts[0]!.every((n) => !Object.is(n, -0))).toBe(true);
  });

  it("keeps a turned box's or capsule's rotDeg in [0, 360)", () => {
    const box = { type: "box", cx: 10, cy: 0, hw: 5, hh: 2, rotDeg: 270 } as const;
    expect(rotateShape(box, [0, 0], 90)).toEqual({ ...box, cx: 0, cy: 10, rotDeg: 0 });
    expect(rotateShape(box, [0, 0], -300)).toMatchObject({ rotDeg: 330 });
    const cap = { type: "capsule", cx: 0, cy: 0, halfLen: 20, r: 4, rotDeg: 350 } as const;
    expect(rotateShape(cap, [0, 0], 30)).toMatchObject({ rotDeg: 20 });
    expect([normDeg(-90), normDeg(720), normDeg(-0), normDeg(359.5)]).toEqual([270, 0, 0, 359.5]);
  });

  it("boxes a quarter-turned box or capsule exactly", () => {
    expect(aabb({ type: "box", cx: 0, cy: 0, hw: 30, hh: 5, rotDeg: 90 })).toEqual({
      minX: -5,
      minY: -30,
      maxX: 5,
      maxY: 30,
    });
    expect(aabb({ type: "capsule", cx: 540, cy: 1140, halfLen: 40, r: 20, rotDeg: 90 })).toEqual({
      minX: 480,
      minY: 1120,
      maxX: 600,
      maxY: 1160,
    });
    expect(containsPoint({ type: "box", cx: 0, cy: 0, hw: 30, hh: 5, rotDeg: 270 }, [5, 30])).toBe(
      true,
    );
  });

  it("lists box corners and outline points, none for round shapes", () => {
    expect(shapeVertices({ type: "box", cx: 0, cy: 0, hw: 1, hh: 1, rotDeg: 0 })).toHaveLength(4);
    expect(shapeVertices({ type: "circle", cx: 0, cy: 0, r: 1 })).toEqual([]);
  });
});
