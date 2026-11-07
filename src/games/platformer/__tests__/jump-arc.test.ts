// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import { computeJumpArc } from "../debug";

const G = 1200;

describe("computeJumpArc", () => {
  it("returns points starting at the given position", () => {
    const points = computeJumpArc(100, 960, 0, G);

    expect(points.length).toBeGreaterThan(2);
    expect(points[0]).toEqual({ x: 100, y: 960 });
  });

  it("standing jump has no horizontal displacement", () => {
    const points = computeJumpArc(200, 960, 0, G);

    // All x values should be approximately 200
    for (const p of points) {
      expect(p.x).toBeCloseTo(200, 0);
    }
  });

  it("right jump has positive horizontal displacement", () => {
    const points = computeJumpArc(100, 960, 300, G);
    const lastPoint = points[points.length - 1];

    expect(lastPoint.x).toBeGreaterThan(100);
  });

  it("left jump has negative horizontal displacement", () => {
    const points = computeJumpArc(100, 960, -300, G);
    const lastPoint = points[points.length - 1];

    expect(lastPoint.x).toBeLessThan(100);
  });

  it("arc goes above the start position (negative y direction)", () => {
    const points = computeJumpArc(100, 960, 0, G);
    const minY = Math.min(...points.map((p) => p.y));

    expect(minY).toBeLessThan(960);
  });

  it("arc ends at or below the floor", () => {
    const points = computeJumpArc(100, 960, 300, G);
    const lastPoint = points[points.length - 1];

    // FLOOR_Y - PLAYER_HEIGHT = 1020 - 60 = 960
    expect(lastPoint.y).toBeCloseTo(960, 0);
  });

  it("follows the world's gravity", () => {
    const apex = (g: number) => Math.min(...computeJumpArc(100, 960, 0, g).map((p) => p.y));
    expect(apex(600)).toBeLessThan(apex(1200));
  });
});
