import { describe, expect, test } from "vite-plus/test";

import {
  centreOn,
  fitRegions,
  levelFor,
  pan,
  screenToHex,
  screenToWorld,
  worldToScreen,
  zoomAt,
} from "../src/camera.ts";
import { hexCentre } from "../src/hex.ts";
import { packStyle, syntheticWorld } from "./support.ts";

const numbers = packStyle().view;
const view = { width: 1440, height: 900 };

describe("levels", () => {
  test("follow the hex size by the pack's thresholds", () => {
    expect(numbers.zoomArea).toBe(4);
    expect(numbers.zoomTile).toBe(12);
    expect(levelFor(1, numbers)).toBe("region");
    expect(levelFor(3.99, numbers)).toBe("region");
    expect(levelFor(4, numbers)).toBe("area");
    expect(levelFor(11.99, numbers)).toBe("area");
    expect(levelFor(12, numbers)).toBe("tile");
    expect(levelFor(40, numbers)).toBe("tile");
  });
});

describe("zoom", () => {
  test("keeps the world point under the pointer where it is", () => {
    const c = { x: 12.5, y: -7, size: 8 };
    const at = { x: 300, y: 650 };
    const before = screenToWorld(c, view, at.x, at.y);
    for (const factor of [1.25, 0.8, 3, 0.4]) {
      const z = zoomAt(c, factor, at, view, numbers);
      expect(z.size).toBeCloseTo(c.size * factor, 9);
      const after = screenToWorld(z, view, at.x, at.y);
      expect(after.x).toBeCloseTo(before.x, 9);
      expect(after.y).toBeCloseTo(before.y, 9);
    }
  });

  test("clamps to zoom-min and zoom-max, still round the pointer", () => {
    const c = { x: 0, y: 0, size: 10 };
    const at = { x: 100, y: 100 };
    const before = screenToWorld(c, view, at.x, at.y);
    const big = zoomAt(c, 100, at, view, numbers);
    expect(big.size).toBe(numbers.zoomMax);
    const small = zoomAt(c, 0.001, at, view, numbers);
    expect(small.size).toBe(numbers.zoomMin);
    for (const z of [big, small]) {
      const after = screenToWorld(z, view, at.x, at.y);
      expect(after.x).toBeCloseTo(before.x, 9);
      expect(after.y).toBeCloseTo(before.y, 9);
    }
  });
});

describe("camera", () => {
  test("a pan moves the map with the pointer", () => {
    const c = { x: 3, y: 4, size: 14 };
    const w = { x: 10, y: -2 };
    const s0 = worldToScreen(c, view, w.x, w.y);
    const moved = pan(c, 40, -25);
    const s1 = worldToScreen(moved, view, w.x, w.y);
    expect(s1.x - s0.x).toBeCloseTo(40, 9);
    expect(s1.y - s0.y).toBeCloseTo(-25, 9);
    expect(moved.size).toBe(c.size);
  });

  test("centreOn puts the hex in the middle of the view", () => {
    const h = { q: 7, r: -3 };
    const c = centreOn(h, 14);
    expect(screenToHex(c, view, view.width / 2, view.height / 2)).toEqual(h);
    const p = hexCentre(h, 1);
    const s = worldToScreen(c, view, p.x, p.y);
    expect(s).toEqual({ x: view.width / 2, y: view.height / 2 });
  });

  test("screenToHex picks the hex drawn under a point", () => {
    const c = { x: 0, y: 0, size: 20 };
    const h = { q: -2, r: 3 };
    const p = hexCentre(h, 1);
    const s = worldToScreen(c, view, p.x, p.y);
    expect(screenToHex(c, view, s.x + 5, s.y - 5)).toEqual(h);
  });

  test("fitRegions holds every discovered tile in view", () => {
    const w = syntheticWorld(12, 4);
    const c = fitRegions(w.regions, view, numbers);
    expect(c.size).toBeGreaterThanOrEqual(numbers.zoomMin);
    expect(c.size).toBeLessThanOrEqual(numbers.zoomMax);
    for (const cell of w.cells.values()) {
      const p = hexCentre(cell, 1);
      const s = worldToScreen(c, view, p.x, p.y);
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThanOrEqual(view.width);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeLessThanOrEqual(view.height);
    }
    // Fitted, not merely inside: the tallest extent fills the view's height.
    expect(c.size * (3 * 12 + 2)).toBeCloseTo(view.height, 6);
  });

  test("fitRegions clamps a tiny view and an empty world", () => {
    const w = syntheticWorld(12, 4);
    expect(fitRegions(w.regions, { width: 10, height: 10 }, numbers).size).toBe(numbers.zoomMin);
    expect(fitRegions(w.regions, { width: 1e6, height: 1e6 }, numbers).size).toBe(numbers.zoomMax);
    const empty = fitRegions({ ...w.regions, rows: [], places: [] }, view, numbers);
    expect(empty).toEqual({ x: 0, y: 0, size: numbers.zoomMin });
  });
});
