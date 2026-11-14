import { describe, expect, it } from "vite-plus/test";

import {
  convexHull,
  signedArea,
  aabb,
  aabbBox,
  boxCorners,
  centroid,
  closestOnSegment,
  containedInRect,
  containsPoint,
  geometryPose,
  intersectsRect,
  isConvex,
  isSimplePolygon,
  polygonInside,
  polygonSide,
  polygonsDisjoint,
  polygonsOverlap,
  segmentsMeet,
  walkPolygonIssues,
  nearestPointOnShape,
  nearestSegment,
  nearestVertex,
  normDeg,
  raycastShape,
  regionBox,
  rotateShape,
  shapeAtPose,
  shapeCentre,
  shapesIntersect,
  shapeVertices,
  sweepShape,
  topSpan,
  translateShape,
  turnBy,
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

describe("aabbBox and regionBox", () => {
  it("turns bounds into an unturned box with the same bounds", () => {
    const b = { minX: -1, minY: 2, maxX: 5, maxY: 3 };
    const box = aabbBox(b);
    expect(box).toEqual({ type: "box", cx: 2, cy: 2.5, hw: 3, hh: 0.5, rotDeg: 0 });
    expect(aabb(box)).toEqual(b);
  });

  it("keeps an unturned box and frames anything else by its bounds", () => {
    const upright: ShapeObj = { type: "box", cx: 1, cy: 1, hw: 2, hh: 1, rotDeg: 360 };
    expect(regionBox(upright)).toBe(upright);
    const turned: ShapeObj = { type: "box", cx: 0, cy: 0, hw: 2, hh: 2, rotDeg: 45 };
    const framed = regionBox(turned);
    expect(framed).toMatchObject({ type: "box", cx: 0, cy: 0, rotDeg: 0 });
    expect(aabb(framed)).toEqual(aabb(turned));
    const ball: ShapeObj = { type: "circle", cx: 3, cy: 4, r: 1 };
    expect(regionBox(ball)).toEqual({ type: "box", cx: 3, cy: 4, hw: 1, hh: 1, rotDeg: 0 });
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

describe("turnBy, shapeCentre and geometryPose", () => {
  it("turns clockwise on screen, exact on quarter turns and never -0", () => {
    expect(turnBy([3, 4], 0)).toEqual([3, 4]);
    expect(turnBy([3, 4], Math.PI / 2)).toEqual([-4, 3]);
    expect(turnBy([3, 4], (90 * Math.PI) / 180)).toEqual([-4, 3]);
    expect(turnBy([3, 0], Math.PI)).toEqual([-3, 0]);
    expect(Object.is(turnBy([3, 0], Math.PI)[1], -0)).toBe(false);
    expect(turnBy([3, 4], -Math.PI / 2)).toEqual([4, -3]);
    const [x, y] = turnBy([10, 0], Math.PI / 4);
    expect(x).toBeCloseTo(Math.SQRT1_2 * 10);
    expect(y).toBeCloseTo(Math.SQRT1_2 * 10);
  });

  it("centres each shape; only a box or capsule fixes its angle", () => {
    expect(shapeCentre({ type: "box", cx: 1, cy: 2, hw: 3, hh: 4, rotDeg: 30 })).toEqual({
      at: [1, 2],
      rotDeg: 30,
    });
    expect(shapeCentre({ type: "capsule", cx: 1, cy: 2, r: 3, halfLen: 4, rotDeg: 0 })).toEqual({
      at: [1, 2],
      rotDeg: 0,
    });
    expect(shapeCentre({ type: "circle", cx: 5, cy: 6, r: 1 })).toEqual({ at: [5, 6] });
    expect(
      shapeCentre({
        type: "poly",
        pts: [
          [0, 0],
          [4, 0],
          [4, 4],
          [0, 4],
        ],
      }),
    ).toEqual({ at: [2, 2] });
    expect(
      shapeCentre({
        type: "chain",
        pts: [
          [0, 0],
          [10, 2],
        ],
      }),
    ).toEqual({ at: [5, 1] });
  });

  it("places a shape at its path's first point, else takes the point, else the path's start", () => {
    const circle: ShapeObj = { type: "circle", cx: 1, cy: 2, r: 1 };
    const path = { pts: [[100, 200] as Pt, [300, 200] as Pt] };
    expect(geometryPose({ shape: circle, at: [9, 9], path })).toEqual({ at: [101, 202] });
    expect(geometryPose({ at: [9, 8], path })).toEqual({ at: [9, 8] });
    expect(geometryPose({ path })).toEqual({ at: [100, 200] });
    expect(geometryPose({})).toBeNull();
  });
});

/** A seeded generator, so a failure names the same shapes every run. */
function random(seed: number) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  return { next, int };
}

const SHAPE_TYPES = ["box", "circle", "capsule", "poly", "chain"] as const;

function randomShape(type: ShapeObj["type"], rnd: ReturnType<typeof random>): ShapeObj {
  const quarter = () => rnd.int(0, 3) * 90;
  const at = () => rnd.int(5, 35);
  switch (type) {
    case "box":
      return {
        type,
        cx: at(),
        cy: at(),
        hw: rnd.int(1, 10),
        hh: rnd.int(1, 10),
        rotDeg: quarter(),
      };
    case "circle":
      return { type, cx: at(), cy: at(), r: rnd.int(1, 10) };
    case "capsule":
      return {
        type,
        cx: at(),
        cy: at(),
        halfLen: rnd.int(1, 10),
        r: rnd.int(1, 6),
        rotDeg: quarter(),
      };
    case "poly": {
      for (;;) {
        const ox = rnd.int(0, 20);
        const oy = rnd.int(0, 20);
        const pts = Array.from(
          { length: rnd.int(3, 6) },
          (): Pt => [ox + rnd.int(0, 20), oy + rnd.int(0, 20)],
        );
        const hull = convexHull(pts);
        if (hull.length >= 3) return { type, pts: hull };
      }
    }
    case "chain":
      return { type, pts: Array.from({ length: rnd.int(2, 4) }, (): Pt => [at(), at()]) };
  }
}

const STEP = 0.5;

/** Whether some point of a `STEP` grid lies within `tol` of both shapes. */
function sampled(a: ShapeObj, b: ShapeObj, tol: number): boolean {
  const ba = aabb(a);
  const bb = aabb(b);
  const minX = Math.floor(Math.max(ba.minX, bb.minX) - tol);
  const maxX = Math.ceil(Math.min(ba.maxX, bb.maxX) + tol);
  const minY = Math.floor(Math.max(ba.minY, bb.minY) - tol);
  const maxY = Math.ceil(Math.min(ba.maxY, bb.maxY) + tol);
  for (let x = minX; x <= maxX; x += STEP) {
    for (let y = minY; y <= maxY; y += STEP) {
      if (containsPoint(a, [x, y], tol) && containsPoint(b, [x, y], tol)) return true;
    }
  }
  return false;
}

const box = (cx: number, cy: number, hw: number, hh: number, rotDeg = 0): ShapeObj => ({
  type: "box",
  cx,
  cy,
  hw,
  hh,
  rotDeg,
});

describe("shapesIntersect", () => {
  it("agrees with a point sampler on random integer shapes, for every pair of types", () => {
    const rnd = random(14);
    const grid = STEP * Math.SQRT1_2 + 1e-9;
    for (const ta of SHAPE_TYPES) {
      for (const tb of SHAPE_TYPES) {
        let hits = 0;
        let misses = 0;
        for (let i = 0; i < 40; i++) {
          const a = randomShape(ta, rnd);
          const b = randomShape(tb, rnd);
          const hit = shapesIntersect(a, b);
          const where = JSON.stringify([a, b]);
          expect(shapesIntersect(b, a), where).toBe(hit);
          if (sampled(a, b, 0)) expect(hit, where).toBe(true);
          if (hit) expect(sampled(a, b, grid), where).toBe(true);
          if (hit) hits++;
          else misses++;
        }
        expect(hits, `${ta}/${tb}`).toBeGreaterThan(0);
        if (ta !== "chain" || tb !== "chain") expect(misses, `${ta}/${tb}`).toBeGreaterThan(0);
      }
    }
  });

  it("counts touching, and nothing nearer than touching", () => {
    expect(shapesIntersect(box(0, 0, 5, 5), box(10, 0, 5, 5))).toBe(true);
    expect(shapesIntersect(box(0, 0, 5, 5), box(10.000001, 0, 5, 5))).toBe(false);
    expect(shapesIntersect(box(0, 0, 5, 5), { type: "circle", cx: 10, cy: 0, r: 5 })).toBe(true);
    // The circle's box overlaps the square's corner, but the circle doesn't.
    expect(shapesIntersect(box(0, 0, 5, 5), { type: "circle", cx: 12, cy: 12, r: 9 })).toBe(false);
    expect(shapesIntersect(box(0, 0, 5, 5), { type: "circle", cx: 12, cy: 12, r: 10 })).toBe(true);
  });

  it("treats chains as segments: a crossing or a chain wholly inside counts", () => {
    const through: ShapeObj = {
      type: "chain",
      pts: [
        [-20, 0],
        [20, 0],
      ],
    };
    const inside: ShapeObj = {
      type: "chain",
      pts: [
        [-1, -1],
        [1, 1],
      ],
    };
    expect(shapesIntersect(through, box(0, 0, 5, 5))).toBe(true);
    expect(shapesIntersect(inside, box(0, 0, 5, 5))).toBe(true);
    expect(shapesIntersect(inside, { type: "circle", cx: 0, cy: 0, r: 5 })).toBe(true);
    expect(shapesIntersect(through, box(0, 10, 5, 5))).toBe(false);
  });

  it("separates collinear capsules and segments end to end", () => {
    const cap = (cy: number): ShapeObj => ({
      type: "capsule",
      cx: 0,
      cy,
      halfLen: 5,
      r: 2,
      rotDeg: 0,
    });
    expect(shapesIntersect(cap(0), cap(14))).toBe(true);
    expect(shapesIntersect(cap(0), cap(14.5))).toBe(false);
    const seg = (x0: number, x1: number): ShapeObj => ({
      type: "chain",
      pts: [
        [x0, 0],
        [x1, 0],
      ],
    });
    expect(shapesIntersect(seg(0, 5), seg(6, 9))).toBe(false);
    expect(shapesIntersect(seg(0, 5), seg(5, 9))).toBe(true);
  });

  it("handles boxes at other angles", () => {
    const diamond = box(0, 0, 10, 10, 45);
    expect(shapesIntersect(diamond, box(14, 0, 1, 1))).toBe(true);
    expect(shapesIntersect(diamond, box(16, 0, 1, 1))).toBe(false);
  });
});

describe("shapeAtPose", () => {
  it("translates and turns by exact quarter turns", () => {
    const local = box(10, 0, 4, 2);
    expect(shapeAtPose(local, { x: 100, y: 50, rot: Math.PI / 2 })).toEqual(box(100, 60, 4, 2, 90));
    expect(shapeAtPose(local, { x: 100, y: 50, rot: -Math.PI / 2 })).toEqual(
      box(100, 40, 4, 2, 270),
    );
    expect(shapeAtPose(local, { x: 0, y: 0, rot: Math.PI })).toEqual(box(-10, 0, 4, 2, 180));
    expect(shapeAtPose(local, { x: 1, y: 2, rot: 0 })).toEqual(box(11, 2, 4, 2));
    expect(
      shapeAtPose(
        { type: "capsule", cx: 0, cy: 0, halfLen: 3, r: 1, rotDeg: 90 },
        { x: 5, y: 5, rot: Math.PI / 2 },
      ),
    ).toEqual({ type: "capsule", cx: 5, cy: 5, halfLen: 3, r: 1, rotDeg: 180 });
  });

  it("moves every point of a poly or chain", () => {
    const tri: ShapeObj = {
      type: "poly",
      pts: [
        [0, 0],
        [10, 0],
        [0, 5],
      ],
    };
    expect(shapeAtPose(tri, { x: 100, y: 0, rot: Math.PI / 2 })).toEqual({
      type: "poly",
      pts: [
        [100, 0],
        [100, 10],
        [95, 0],
      ],
    });
    expect(shapeAtPose({ type: "chain", pts: [[1, 2]] }, { x: 10, y: 20, rot: Math.PI })).toEqual({
      type: "chain",
      pts: [[9, 18]],
    });
  });

  it("turns a circle's centre and leaves its radius", () => {
    expect(
      shapeAtPose({ type: "circle", cx: 0, cy: 3, r: 2 }, { x: 1, y: 1, rot: Math.PI / 2 }),
    ).toEqual({ type: "circle", cx: -2, cy: 1, r: 2 });
  });

  it("uses cos and sin for other angles", () => {
    const s = shapeAtPose(box(10, 0, 4, 2), { x: 0, y: 0, rot: 0.3 });
    if (s.type !== "box") throw new Error("box expected");
    expect(s.cx).toBeCloseTo(10 * Math.cos(0.3));
    expect(s.cy).toBeCloseTo(10 * Math.sin(0.3));
    expect(s.rotDeg).toBeCloseTo((0.3 * 180) / Math.PI);
  });
});

describe("raycastShape", () => {
  it("gives the time of impact as a fraction of maxDist, with the face's normal", () => {
    expect(raycastShape(box(50, 50, 10, 10), [0, 50], [1, 0], 100)).toEqual({
      toi: 0.4,
      normal: [-1, 0],
    });
    expect(raycastShape(box(50, 50, 10, 10), [0, 50], [5, 0], 100)).toEqual({
      toi: 0.4,
      normal: [-1, 0],
    });
    expect(raycastShape(box(50, 50, 10, 10), [50, 100], [0, -1], 50)?.normal).toEqual([0, 1]);
    expect(raycastShape(box(50, 50, 10, 10), [0, 50], [1, 0], 39)).toBeNull();
    expect(raycastShape(box(50, 50, 10, 10), [0, 50], [-1, 0], 100)).toBeNull();
    expect(raycastShape(box(50, 50, 10, 10), [0, 50], [0, 0], 100)).toBeNull();
  });

  it("hits at 0 with no normal from inside a solid shape", () => {
    expect(raycastShape(box(50, 50, 10, 10), [50, 50], [1, 0], 100)).toEqual({
      toi: 0,
      normal: [0, 0],
    });
    expect(raycastShape({ type: "circle", cx: 0, cy: 0, r: 5 }, [1, 1], [1, 0], 10)).toEqual({
      toi: 0,
      normal: [0, 0],
    });
  });

  it("casts against circles and capsules, sides and caps", () => {
    expect(raycastShape({ type: "circle", cx: 50, cy: 50, r: 10 }, [50, 0], [0, 1], 100)).toEqual({
      toi: 0.4,
      normal: [0, -1],
    });
    const cap: ShapeObj = { type: "capsule", cx: 50, cy: 50, halfLen: 10, r: 5, rotDeg: 0 };
    expect(raycastShape(cap, [0, 50], [1, 0], 100)).toEqual({ toi: 0.45, normal: [-1, 0] });
    expect(raycastShape(cap, [50, 0], [0, 1], 100)).toEqual({ toi: 0.35, normal: [0, -1] });
    expect(raycastShape({ ...cap, rotDeg: 90 }, [0, 50], [1, 0], 100)).toEqual({
      toi: 0.35,
      normal: [-1, 0],
    });
  });

  it("hits a chain from either side, the normal facing the ray", () => {
    const chain: ShapeObj = {
      type: "chain",
      pts: [
        [0, 100],
        [100, 100],
      ],
    };
    expect(raycastShape(chain, [50, 150], [0, -1], 100)).toEqual({ toi: 0.5, normal: [0, 1] });
    expect(raycastShape(chain, [50, 50], [0, 1], 100)).toEqual({ toi: 0.5, normal: [0, -1] });
    expect(raycastShape(chain, [150, 50], [0, 1], 100)).toBeNull();
    expect(raycastShape(chain, [-50, 100], [1, 0], 100)).toBeNull();
  });

  it("agrees with marching the ray on random shapes", () => {
    const rnd = random(7);
    const dt = 0.01;
    for (const type of ["box", "circle", "capsule", "poly"] as const) {
      for (let i = 0; i < 40; i++) {
        const s = randomShape(type, rnd);
        const from: Pt = [rnd.int(-10, 50) + 0.5, rnd.int(-10, 50) + 0.5];
        const a = rnd.next() * 2 * Math.PI;
        const dir: Pt = [Math.cos(a), Math.sin(a)];
        const maxDist = 80;
        const hit = raycastShape(s, from, dir, maxDist);
        let marched: number | null = null;
        for (let t = 0; t <= maxDist; t += dt) {
          if (containsPoint(s, [from[0] + dir[0] * t, from[1] + dir[1] * t], 1e-9)) {
            marched = t;
            break;
          }
        }
        const where = JSON.stringify({ s, from, dir });
        if (marched === null) {
          expect(hit, where).toBeNull();
          continue;
        }
        expect(hit, where).not.toBeNull();
        expect(Math.abs(hit!.toi * maxDist - marched), where).toBeLessThanOrEqual(dt + 1e-9);
        if (hit!.toi > 0) {
          const t = hit!.toi * maxDist;
          expect(containsPoint(s, [from[0] + dir[0] * t, from[1] + dir[1] * t], 1e-6)).toBe(true);
          expect(Math.hypot(hit!.normal[0], hit!.normal[1])).toBeCloseTo(1, 9);
          expect(hit!.normal[0] * dir[0] + hit!.normal[1] * dir[1]).toBeLessThanOrEqual(1e-9);
        }
      }
    }
  });
});

describe("sweepShape", () => {
  it("finds the time of impact to 1/1024 of the motion, with the separating normal", () => {
    const hit = sweepShape(box(0, 0, 5, 5), [0, 100], box(0, 60, 50, 10));
    expect(hit).not.toBeNull();
    expect(hit!.toi).toBeLessThanOrEqual(0.45);
    expect(hit!.toi).toBeGreaterThan(0.45 - 1 / 1024);
    expect(hit!.normal).toEqual([0, -1]);
    expect(hit!.at[1]).toBe(50);
  });

  it("catches a wall the motion passes clean through", () => {
    const hit = sweepShape(box(0, 0, 2, 2), [100, 0], box(50, 0, 1, 20));
    expect(hit!.toi).toBeGreaterThan(0.47 - 1 / 1024);
    expect(hit!.toi).toBeLessThanOrEqual(0.47);
    expect(hit!.normal).toEqual([-1, 0]);
  });

  it("takes its normal from the separating axis on a corner", () => {
    const hit = sweepShape({ type: "circle", cx: 0, cy: 0, r: 5 }, [100, 100], box(50, 50, 10, 10));
    expect(hit!.normal[0]).toBeCloseTo(-Math.SQRT1_2, 2);
    expect(hit!.normal[1]).toBeCloseTo(-Math.SQRT1_2, 2);
  });

  it("is a hit at 0 when touching at the start, and null with no motion or no contact", () => {
    expect(sweepShape(box(0, 0, 5, 5), [0, 10], box(10, 0, 5, 5))?.toi).toBe(0);
    expect(sweepShape(box(0, 0, 5, 5), [0, 0], box(10, 0, 5, 5))).toBeNull();
    expect(sweepShape(box(0, 0, 5, 5), [0, 100], box(50, 0, 5, 5))).toBeNull();
  });
});

describe("nearestPointOnShape", () => {
  it("is the point itself inside, else the nearest point of the outline", () => {
    expect(nearestPointOnShape(box(0, 0, 5, 5), [1, 2])).toEqual([1, 2]);
    expect(nearestPointOnShape(box(0, 0, 5, 5), [20, 2])).toEqual([5, 2]);
    expect(nearestPointOnShape({ type: "circle", cx: 0, cy: 0, r: 5 }, [0, 20])).toEqual([0, 5]);
    expect(
      nearestPointOnShape(
        {
          type: "chain",
          pts: [
            [0, 0],
            [10, 0],
          ],
        },
        [4, 3],
      ),
    ).toEqual([4, 0]);
  });
});

describe("walk-polygon predicates", () => {
  const sq = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
  const l: Pt[] = [
    [0, 0],
    [100, 0],
    [100, 40],
    [40, 40],
    [40, 100],
    [0, 100],
  ];

  it("segmentsMeet counts crossings and touches", () => {
    expect(segmentsMeet([0, 0], [10, 10], [0, 10], [10, 0])).toBe(true);
    expect(segmentsMeet([0, 0], [10, 0], [10, 0], [20, 5])).toBe(true);
    expect(segmentsMeet([0, 0], [10, 0], [5, 0], [5, 5])).toBe(true);
    expect(segmentsMeet([0, 0], [10, 0], [5, 1], [5, 5])).toBe(false);
    expect(segmentsMeet([0, 0], [10, 0], [11, 0], [20, 0])).toBe(false);
    expect(segmentsMeet([0, 0], [10, 0], [5, 0], [20, 0])).toBe(true);
  });

  it("polygonSide tells inside, outline and outside apart in either winding", () => {
    for (const pts of [l, [...l].reverse()]) {
      expect(polygonSide([20, 20], pts)).toBe(1);
      expect(polygonSide([70, 40], pts)).toBe(0);
      expect(polygonSide([40, 40], pts)).toBe(0);
      expect(polygonSide([70, 70], pts)).toBe(-1);
      expect(polygonSide([-1, 50], pts)).toBe(-1);
    }
  });

  it("isSimplePolygon accepts concave and collinear rings, refuses knots", () => {
    expect(isSimplePolygon(l)).toBe(true);
    expect(isSimplePolygon([...l].reverse())).toBe(true);
    expect(
      isSimplePolygon([
        [0, 0],
        [5, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ]),
    ).toBe(true);
    // Bow-tie.
    expect(
      isSimplePolygon([
        [0, 0],
        [10, 10],
        [10, 0],
        [0, 10],
      ]),
    ).toBe(false);
    // Two squares meeting at one corner (a figure eight).
    expect(
      isSimplePolygon([
        [0, 0],
        [10, 0],
        [10, 10],
        [20, 10],
        [20, 20],
        [10, 20],
        [10, 10],
        [0, 10],
      ]),
    ).toBe(false);
    // A corner touching an edge.
    expect(
      isSimplePolygon([
        [0, 0],
        [20, 0],
        [20, 10],
        [10, 0],
        [0, 10],
      ]),
    ).toBe(false);
    // A spike doubling back.
    expect(
      isSimplePolygon([
        [0, 0],
        [10, 0],
        [5, 0],
        [5, 10],
      ]),
    ).toBe(false);
    expect(
      isSimplePolygon([
        [0, 0],
        [10, 0],
        [10, 0],
        [0, 10],
      ]),
    ).toBe(false);
    expect(
      isSimplePolygon([
        [0, 0],
        [5, 0],
        [10, 0],
      ]),
    ).toBe(false);
    expect(
      isSimplePolygon([
        [0, 0],
        [10, 0],
      ]),
    ).toBe(false);
    expect(
      isSimplePolygon([
        [0, 0],
        [10, Number.NaN],
        [0, 10],
      ]),
    ).toBe(false);
  });

  it("polygonInside is strict: touching or crossing the outline fails", () => {
    expect(polygonInside(sq(10, 10, 20, 20), l)).toBe(true);
    expect(polygonInside(sq(10, 10, 20, 20), [...l].reverse())).toBe(true);
    expect(polygonInside(sq(0, 10, 20, 20), l)).toBe(false);
    expect(polygonInside(sq(30, 30, 50, 50), l)).toBe(false);
    expect(polygonInside(sq(60, 60, 70, 70), l)).toBe(false);
    expect(polygonInside(l, sq(10, 10, 20, 20))).toBe(false);
    // A hole around the inner corner, every corner inside, one edge crossing out.
    expect(
      polygonInside(
        [
          [30, 30],
          [60, 30],
          [30, 60],
        ],
        l,
      ),
    ).toBe(false);
  });

  it("polygonsDisjoint needs no shared point and no nesting", () => {
    expect(polygonsDisjoint(sq(0, 0, 10, 10), sq(20, 0, 30, 10))).toBe(true);
    expect(polygonsDisjoint(sq(0, 0, 10, 10), sq(10, 0, 20, 10))).toBe(false);
    expect(polygonsDisjoint(sq(0, 0, 10, 10), sq(10, 10, 20, 20))).toBe(false);
    expect(polygonsDisjoint(sq(0, 0, 10, 10), sq(2, 2, 8, 8))).toBe(false);
    expect(polygonsDisjoint(sq(2, 2, 8, 8), sq(0, 0, 10, 10))).toBe(false);
  });

  it("polygonsOverlap is about interiors: shared edges and corners don't count", () => {
    expect(polygonsOverlap(sq(0, 0, 10, 10), sq(10, 0, 20, 10))).toBe(false);
    expect(polygonsOverlap(sq(0, 0, 10, 10), sq(10, 5, 20, 15))).toBe(false);
    expect(polygonsOverlap(sq(0, 0, 10, 10), sq(10, 10, 20, 20))).toBe(false);
    expect(polygonsOverlap(sq(0, 0, 10, 10), sq(20, 0, 30, 10))).toBe(false);
    expect(polygonsOverlap(sq(0, 0, 10, 10), sq(5, 5, 15, 15))).toBe(true);
    expect(polygonsOverlap(sq(0, 0, 10, 10), sq(2, 2, 8, 8))).toBe(true);
    expect(polygonsOverlap(sq(2, 2, 8, 8), sq(0, 0, 10, 10))).toBe(true);
    expect(polygonsOverlap(sq(0, 0, 10, 10), sq(0, 0, 10, 10))).toBe(true);
    expect(polygonsOverlap(sq(0, 0, 10, 10), [...sq(0, 0, 10, 10)].reverse())).toBe(true);
    // Same outline with an extra collinear corner.
    expect(
      polygonsOverlap(sq(0, 0, 10, 10), [
        [0, 0],
        [5, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ]),
    ).toBe(true);
    // Sharing part of an edge from inside: a box against the L's inner corner.
    expect(polygonsOverlap(l, sq(40, 40, 60, 60))).toBe(false);
    expect(polygonsOverlap(l, sq(30, 40, 60, 60))).toBe(true);
    // A cross: no corner of either inside the other.
    expect(polygonsOverlap(sq(0, 4, 10, 6), sq(4, 0, 6, 10))).toBe(true);
  });

  it("walkPolygonIssues reports each broken rule and keeps the rest", () => {
    const { issues, areas } = walkPolygonIssues(
      [
        { id: "room", pts: l },
        { id: "annex", pts: sq(100, 0, 140, 40) },
        { id: "over", pts: sq(90, 30, 120, 60) },
        {
          id: "knot",
          pts: [
            [200, 0],
            [210, 10],
            [210, 0],
            [200, 10],
          ],
        },
      ],
      [
        { id: "pillar", pts: sq(10, 10, 20, 20) },
        { id: "stray", pts: sq(300, 0, 310, 10) },
        { id: "seam", pts: sq(95, 10, 105, 20) },
        { id: "nested", pts: sq(12, 12, 14, 14) },
        { id: "crate", pts: sq(110, 10, 120, 20) },
      ],
    );
    expect(issues.map((i) => i.entityIds)).toEqual([
      ["room", "over"],
      ["knot"],
      ["stray"],
      ["seam"],
      ["pillar", "nested"],
    ]);
    expect(issues.every((i) => i.message.length > 0)).toBe(true);
    expect(areas.map((a) => [a.area.id, a.holes.map((h) => h.id)])).toEqual([
      ["room", ["pillar"]],
      ["annex", ["crate"]],
    ]);
  });
});
