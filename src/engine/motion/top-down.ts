import type { Vec2 } from "../types";
import type { MotionBody, MotionResult } from "./body";

export type TopDownOptions = {
  /** px/s. */
  maxSpeed: number;
  /** px/s² toward the intended velocity. */
  accel: number;
  /** px/s² back to rest when there is no intent. */
  decel: number;
};

export interface TopDownController {
  velocity(): Vec2;
  /** `intent` is a direction in the unit disc; a longer one is clamped to it. */
  step(dtMs: number, intent: Vec2): MotionResult;
}

/** `intent` scaled back onto the unit circle when it lies outside it. */
function clampToDisc(intent: Vec2): Vec2 {
  const sq = intent.x * intent.x + intent.y * intent.y;
  if (sq <= 1) return { x: intent.x, y: intent.y };
  const len = Math.sqrt(sq);
  return { x: intent.x / len, y: intent.y / len };
}

/**
 * Free movement in the plane: the velocity turns toward `intent × maxSpeed`
 * at `accel` (or eases to rest at `decel`), the body moves by it, and what
 * it hits takes away the part of the velocity heading into it.
 */
export function createTopDownController(body: MotionBody, opts: TopDownOptions): TopDownController {
  for (const key of ["maxSpeed", "accel", "decel"] as const) {
    const v = opts[key];
    if (!Number.isFinite(v) || v < 0) throw new Error(`top-down ${key} must be ≥ 0; got ${v}`);
  }
  let v: Vec2 = { x: 0, y: 0 };

  return {
    velocity: () => ({ ...v }),
    step(dtMs, rawIntent) {
      if (!(dtMs > 0)) return { moved: { x: 0, y: 0 }, hits: [], blocked: false };
      const dt = dtMs / 1000;
      const intent = clampToDisc(rawIntent);
      const idle = intent.x === 0 && intent.y === 0;
      const target = { x: intent.x * opts.maxSpeed, y: intent.y * opts.maxSpeed };
      const dx = target.x - v.x;
      const dy = target.y - v.y;
      const gap = Math.sqrt(dx * dx + dy * dy);
      const reach = (idle ? opts.decel : opts.accel) * dt;
      v = gap <= reach ? target : { x: v.x + (dx * reach) / gap, y: v.y + (dy * reach) / gap };

      const result = body.move({ x: v.x * dt, y: v.y * dt });
      for (const { normal: n } of result.hits) {
        const into = v.x * n.x + v.y * n.y;
        if (into < 0) v = { x: v.x - n.x * into, y: v.y - n.y * into };
      }
      return result;
    },
  };
}
