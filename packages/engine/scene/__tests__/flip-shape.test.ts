import { describe, expect, it } from "vite-plus/test";

import { flipShapeX, mirrorDeg } from "../shape-geometry";
import { shapeToTuple } from "../shapes";
import { dihedral, flipWorld } from "../transform";
import { transformTuple } from "../translate";
import type { ShapeObj } from "../types";

const MIRROR_X = dihedral(flipWorld({ rot: 0, flip: false }, "x"), [0, 0]);

const SHAPES: ShapeObj[] = [
  { type: "box", cx: 0.5, cy: -0.25, hw: 0.75, hh: 0.5, rotDeg: 0 },
  { type: "box", cx: -1, cy: 2, hw: 0.5, hh: 0.25, rotDeg: 30 },
  { type: "capsule", cx: 0.25, cy: 0.5, halfLen: 1, r: 0.25, rotDeg: 90 },
  { type: "circle", cx: 1.5, cy: -0.5, r: 0.5 },
  {
    type: "poly",
    pts: [
      [0, 0],
      [1, 0],
      [1, 1],
    ],
  },
  {
    type: "chain",
    pts: [
      [-1, 0],
      [0, 0.5],
      [2, 0.25],
    ],
  },
];

describe("flipShapeX", () => {
  it("mirrors every shape as a scene flip of its tuple does", () => {
    for (const s of SHAPES) {
      expect(shapeToTuple(flipShapeX(s)), s.type).toStrictEqual(
        transformTuple(shapeToTuple(s), MIRROR_X),
      );
    }
  });

  it("keeps a polygon's winding and a box's angle in [0, 360)", () => {
    const tri = SHAPES[4]!;
    expect(flipShapeX(tri)).toStrictEqual({
      type: "poly",
      pts: [
        [-1, 1],
        [-1, 0],
        [0, 0],
      ],
    });
    expect(flipShapeX(SHAPES[1]!)).toMatchObject({ cx: 1, rotDeg: 330 });
    expect(mirrorDeg(30)).toBe(-30);
  });

  it("is its own inverse", () => {
    for (const s of SHAPES) expect(flipShapeX(flipShapeX(s)), s.type).toStrictEqual(s);
  });
});
