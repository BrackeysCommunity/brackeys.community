// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import { polygonSide, polygonsOverlap, signedArea } from "../../scene/shape-geometry";
import type { Pt } from "../../scene/types";
import { triangulate } from "../triangulate";

/** A seeded generator (mulberry32), so a failure reproduces. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const area = (pts: readonly Pt[]) => Math.abs(signedArea(pts));

const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

/** Every triangle positive, inside the polygon and out of its holes, no two overlapping, areas summing exactly. */
function expectTiling(outer: Pt[], holes: Pt[][]) {
  const tris = triangulate(outer, holes);
  const total = tris.reduce((sum, t) => sum + signedArea(t), 0);
  expect(total).toBe(area(outer) - holes.reduce((sum, h) => sum + area(h), 0));
  for (const t of tris) {
    expect(signedArea(t)).toBeGreaterThan(0);
    const c: Pt = [(t[0][0] + t[1][0] + t[2][0]) / 3, (t[0][1] + t[1][1] + t[2][1]) / 3];
    expect(polygonSide(c, outer)).toBe(1);
    for (const h of holes) expect(polygonSide(c, h)).toBe(-1);
  }
  for (let i = 0; i < tris.length; i++) {
    for (let j = i + 1; j < tris.length; j++) {
      expect(polygonsOverlap(tris[i]!, tris[j]!), `triangles ${i} and ${j}`).toBe(false);
    }
  }
  return tris;
}

describe("triangulate", () => {
  it("splits a square into two triangles", () => {
    expect(expectTiling(rect(0, 0, 10, 10), [])).toHaveLength(2);
  });

  it("tiles concave rings exactly, in either winding", () => {
    const l: Pt[] = [
      [0, 0],
      [100, 0],
      [100, 40],
      [40, 40],
      [40, 100],
      [0, 100],
    ];
    expectTiling(l, []);
    expectTiling([...l].reverse(), []);
    const comb: Pt[] = [
      [0, 0],
      [50, 0],
      [50, 30],
      [40, 30],
      [40, 10],
      [30, 10],
      [30, 30],
      [20, 30],
      [20, 10],
      [10, 10],
      [10, 30],
      [0, 30],
    ];
    expect(expectTiling(comb, [])).toHaveLength(comb.length - 2);
    const spiral: Pt[] = [
      [0, 0],
      [9, 0],
      [9, 9],
      [2, 9],
      [2, 4],
      [6, 4],
      [6, 6],
      [4, 6],
      [4, 7],
      [7, 7],
      [7, 2],
      [0, 2],
    ];
    expectTiling(spiral, []);
  });

  it("keeps collinear corners as triangle corners", () => {
    const outer: Pt[] = [
      [0, 0],
      [5, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    const tris = expectTiling(outer, []);
    const corners = tris.flat();
    expect(corners).toContainEqual([5, 0]);
  });

  it("cuts holes out exactly", () => {
    expectTiling(rect(0, 0, 100, 100), [rect(40, 40, 60, 60)]);
    expectTiling(rect(0, 0, 100, 100), [[...rect(40, 40, 60, 60)].reverse()]);
    expectTiling(rect(0, 0, 100, 60), [
      rect(10, 10, 30, 50),
      rect(40, 10, 60, 50),
      rect(70, 10, 90, 50),
    ]);
  });

  it("bridges holes whose rightmost corners tie, and holes in a concave ring", () => {
    // Same rightmost x: the greater y bridges first.
    expectTiling(rect(0, 0, 100, 100), [
      rect(60, 10, 80, 30),
      rect(60, 60, 80, 80),
      rect(10, 35, 80, 55),
    ]);
    const l: Pt[] = [
      [0, 0],
      [100, 0],
      [100, 40],
      [40, 40],
      [40, 100],
      [0, 100],
    ];
    expectTiling(l, [
      [
        [50, 25],
        [60, 15],
        [70, 25],
        [70, 39],
        [50, 39],
      ],
      [
        [10, 60],
        [30, 50],
        [20, 80],
      ],
    ]);
  });

  it("tiles seeded scatters of many holes exactly", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const next = rng(seed);
      const holes: Pt[][] = [];
      for (let cx = 0; cx < 6; cx++) {
        for (let cy = 0; cy < 6; cy++) {
          if (next() < 0.4) continue;
          const x = 10 + cx * 20;
          const y = 10 + cy * 20;
          const w = 2 + Math.floor(next() * 14);
          const h = 2 + Math.floor(next() * 14);
          if (next() < 0.5) holes.push(rect(x, y, x + w, y + h));
          else
            holes.push([
              [x, y],
              [x + w, y + Math.floor(next() * h)],
              [x + Math.floor(next() * w), y + h],
            ]);
        }
      }
      expectTiling(rect(0, 0, 130, 130), holes);
    }
  });

  it("gives the same triangles for the same input", () => {
    const run = () =>
      triangulate(rect(0, 0, 100, 60), [rect(10, 10, 30, 50), rect(40, 10, 60, 50)]);
    expect(run()).toEqual(run());
  });

  it("doesn't alias the input points", () => {
    const outer = rect(0, 0, 10, 10);
    const tris = triangulate(outer, []);
    tris[0]![0][0] = 99;
    expect(outer).toEqual(rect(0, 0, 10, 10));
  });
});
