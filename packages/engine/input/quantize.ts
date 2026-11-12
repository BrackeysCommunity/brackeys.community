import type { Vec2 } from "../types";

/** The radial stick deadzone when neither the input map nor the game sets one. */
export const DEFAULT_DEADZONE = 0.15;

const STEP = 1000;

/** An analog value to 1/1000, the step the simulation and recordings see; never -0. */
export function q(v: number): number {
  return Math.round(v * STEP) / STEP + 0;
}

/** A pointer coordinate to 1/10,000 of a world metre; never -0. */
export function qPointer(p: number): number {
  return Math.round(p * 10_000) / 10_000 + 0;
}

const finite = (v: number): number => (Number.isFinite(v) ? v : 0);

/** An axis value clamped to −1…1 and quantised. */
export function qAxis(v: number): number {
  return q(Math.min(1, Math.max(-1, finite(v))));
}

/**
 * A vector clamped to the unit disc and quantised, still inside the disc:
 * rounding can carry a unit-length vector just past 1, so the larger
 * component steps toward zero by 1/1000 until it fits.
 */
export function qVector(v: Vec2): Vec2 {
  let x = finite(v.x);
  let y = finite(v.y);
  const len = Math.sqrt(x * x + y * y);
  if (len > 1) {
    x /= len;
    y /= len;
  }
  let qx = Math.round(x * STEP);
  let qy = Math.round(y * STEP);
  while (qx * qx + qy * qy > STEP * STEP) {
    if (Math.abs(qx) >= Math.abs(qy)) qx -= Math.sign(qx);
    else qy -= Math.sign(qy);
  }
  return { x: qx / STEP + 0, y: qy / STEP + 0 };
}

/**
 * A stick's raw position through the radial deadzone `dz`: zero inside it,
 * and outside it the magnitude rescaled from dz…1 to 0…1 along the same
 * direction, so motion starts smoothly at the edge. Clamped to the unit disc
 * and quantised.
 */
export function radialDeadzone(stick: Vec2, dz: number): Vec2 {
  const x = finite(stick.x);
  const y = finite(stick.y);
  const zone = Math.min(1, Math.max(0, finite(dz)));
  const len = Math.sqrt(x * x + y * y);
  if (len <= zone || zone >= 1) return { x: 0, y: 0 };
  const scaled = (Math.min(len, 1) - zone) / (1 - zone);
  return qVector({ x: (x / len) * scaled, y: (y / len) * scaled });
}
