import { readFileSync } from "node:fs";

import { describe, expect, test } from "vite-plus/test";

import {
  type Axial,
  DIRECTION_IDS,
  DIRECTIONS,
  hexCentre,
  hexCorners,
  hexDistance,
  hexKey,
  neighbour,
  pixelToHex,
  sideCorners,
} from "../src/hex.ts";

// Written by services/mmo-world/render/hexcentre_fixture_test.go from
// render.hexCentre, hexPoly and HexMap's inverse.
interface Fixture {
  directions: Axial[];
  centres: { q: number; r: number; size: number; x: number; y: number }[];
  corners: { size: number; x: number; y: number; corners: { x: number; y: number }[] }[];
  pixels: { x: number; y: number; size: number; q: number; r: number }[];
}

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/hex.json", import.meta.url), "utf8"),
) as Fixture;

describe("parity with Go's render", () => {
  test("directions are sim/hex's, in order", () => {
    expect(DIRECTIONS).toEqual(fixture.directions);
    expect(DIRECTION_IDS).toEqual(["e", "ne", "nw", "w", "sw", "se"]);
  });

  test("hexCentre", () => {
    expect(fixture.centres.length).toBeGreaterThan(100);
    for (const c of fixture.centres) {
      const p = hexCentre(c, c.size);
      expect(p.x).toBeCloseTo(c.x, 9);
      expect(p.y).toBeCloseTo(c.y, 9);
    }
  });

  test("hexCorners", () => {
    for (const c of fixture.corners) {
      const got = hexCorners({ x: c.x, y: c.y }, c.size);
      expect(got).toHaveLength(6);
      got.forEach((p, i) => {
        expect(p.x).toBeCloseTo(c.corners[i].x, 9);
        expect(p.y).toBeCloseTo(c.corners[i].y, 9);
      });
    }
  });

  test("pixelToHex picks the tile Go draws under a pixel", () => {
    expect(fixture.pixels.length).toBeGreaterThan(100);
    for (const p of fixture.pixels) {
      expect(pixelToHex(p.x, p.y, p.size)).toEqual({ q: p.q, r: p.r });
    }
  });
});

describe("hex maths", () => {
  test("a hex's centre maps back to it", () => {
    for (let q = -5; q <= 5; q++) {
      for (let r = -5; r <= 5; r++) {
        for (const size of [1, 3.7, 26]) {
          const c = hexCentre({ q, r }, size);
          expect(pixelToHex(c.x, c.y, size)).toEqual({ q, r });
        }
      }
    }
  });

  test("distance", () => {
    expect(hexDistance({ q: 0, r: 0 }, { q: 0, r: 0 })).toBe(0);
    expect(hexDistance({ q: 0, r: 0 }, { q: 3, r: -3 })).toBe(3);
    expect(hexDistance({ q: -2, r: 1 }, { q: 2, r: 1 })).toBe(4);
    expect(hexDistance({ q: 1, r: 1 }, { q: -1, r: -1 })).toBe(4);
    for (let d = 0; d < 6; d++)
      expect(hexDistance({ q: 4, r: -2 }, neighbour({ q: 4, r: -2 }, d))).toBe(1);
  });

  test("the side facing direction d sits halfway to that neighbour", () => {
    const c = hexCentre({ q: 0, r: 0 }, 1);
    const corners = hexCorners(c, 1);
    for (let d = 0; d < 6; d++) {
      const [i, j] = sideCorners(d);
      const mid = { x: (corners[i].x + corners[j].x) / 2, y: (corners[i].y + corners[j].y) / 2 };
      const n = hexCentre(DIRECTIONS[d], 1);
      expect(mid.x).toBeCloseTo(n.x / 2, 9);
      expect(mid.y).toBeCloseTo(n.y / 2, 9);
    }
  });

  test("keys", () => {
    expect(hexKey({ q: 3, r: -2 })).toBe("3,-2");
  });
});
