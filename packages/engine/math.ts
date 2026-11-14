import type { Vec2 } from "./types";

export {
  applyPt,
  applyVec,
  compose,
  composeDihedral,
  dihedral,
  dihedralOf,
  flipWorld,
  IDENTITY_2D,
  invert,
  inverseTurn,
  isIdentityTurn,
  translation,
  turnOf,
  type Dihedral,
  type Transform2D,
} from "./scene/transform";
export { cssHex } from "./game/color";
export { lerpAngle } from "./runtime/poses";

/** Linearly interpolate between two numbers */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Linearly interpolate between two Vec2s */
export function lerpVec2(a: Vec2, b: Vec2, t: number): Vec2 {
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
  };
}

/** Each 8-bit channel of 0xRRGGBB colours `a` to `b` by `t`, rounded and kept in 0–255. */
export function lerpRgb(a: number, b: number, t: number): number {
  let out = 0;
  for (const shift of [16, 8, 0]) {
    const from = (a >> shift) & 0xff;
    const to = (b >> shift) & 0xff;
    out = out * 256 + clamp(Math.round(from + (to - from) * t), 0, 0xff);
  }
  return out;
}

/** Clamp a number between min and max */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Hermite smoothstep of `t` in 0–1: eases in and out with zero slope at both ends. */
export const smoothstep = (t: number): number => t * t * (3 - 2 * t);

/** Clamp a Vec2 component-wise between min and max Vec2s */
export function clampVec2(v: Vec2, min: Vec2, max: Vec2): Vec2 {
  return {
    x: clamp(v.x, min.x, max.x),
    y: clamp(v.y, min.y, max.y),
  };
}

/** Distance between two Vec2s */
export function distanceVec2(a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Add two Vec2s */
export function addVec2(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

/** Scale a Vec2 by a scalar */
export function scaleVec2(v: Vec2, s: number): Vec2 {
  return { x: v.x * s, y: v.y * s };
}
