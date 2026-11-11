// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import { platformerGame } from "..";
import { computeJumpArc } from "../debug";
import { computeDesiredMovement } from "../entities/player";

const G = platformerGame.world!.gravity![1];
const DT = 1 / 60;

/** The original px jump tuning: -500 px/s up under 1200 px/s², stepped at 60 Hz. Its apex height, px. */
function pxApexHeight(): number {
  let vy = -500;
  let y = 0;
  let top = 0;
  for (let i = 0; i < 120 && vy < 0; i++) {
    vy += 1200 * DT;
    y += vy * DT;
    top = Math.min(top, y);
  }
  return -top;
}

describe("computeJumpArc", () => {
  it("returns points starting at the given position", () => {
    const points = computeJumpArc(1, 9.6, 0, G);

    expect(points.length).toBeGreaterThan(2);
    expect(points[0]).toEqual({ x: 1, y: 9.6 });
  });

  it("standing jump has no horizontal displacement", () => {
    const points = computeJumpArc(2, 9.6, 0, G);

    for (const p of points) {
      expect(p.x).toBeCloseTo(2, 6);
    }
  });

  it("right jump has positive horizontal displacement", () => {
    const points = computeJumpArc(1, 9.6, 3, G);
    const lastPoint = points[points.length - 1];

    expect(lastPoint.x).toBeGreaterThan(1);
  });

  it("left jump has negative horizontal displacement", () => {
    const points = computeJumpArc(1, 9.6, -3, G);
    const lastPoint = points[points.length - 1];

    expect(lastPoint.x).toBeLessThan(1);
  });

  it("arc goes above the start position (negative y direction)", () => {
    const points = computeJumpArc(1, 9.6, 0, G);
    const minY = Math.min(...points.map((p) => p.y));

    expect(minY).toBeLessThan(9.6);
  });

  it("arc ends at or below the floor", () => {
    const points = computeJumpArc(1, 9.6, 3, G);
    const lastPoint = points[points.length - 1];

    expect(lastPoint.y).toBeCloseTo(9.6, 6);
  });

  it("follows the world's gravity", () => {
    const apex = (g: number) => Math.min(...computeJumpArc(1, 9.6, 0, g).map((p) => p.y));
    expect(apex(6)).toBeLessThan(apex(12));
  });

  it("peaks at the original px tuning's apex ÷ 100", () => {
    const arc = computeJumpArc(0, 0, 0, G);
    const height = -Math.min(...arc.map((p) => p.y));
    expect(Math.abs(height - pxApexHeight() / 100)).toBeLessThan(1e-9);
  });
});

describe("the player's jump", () => {
  it("peaks at the original px tuning's apex ÷ 100", () => {
    let velocity = { x: 0, y: 0 };
    let y = 0;
    let top = 0;
    for (let i = 0; i < 120; i++) {
      const step = computeDesiredMovement(velocity, [], i === 0, i === 0, DT, G, i === 0, false);
      velocity = step.newVelocity;
      if (velocity.y >= 0) break;
      y += step.desiredDelta.y;
      top = Math.min(top, y);
    }
    expect(top).toBeLessThan(0);
    expect(Math.abs(-top - pxApexHeight() / 100)).toBeLessThan(1e-9);
  });
});
