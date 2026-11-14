/** Frame shapes in world space, and the overlap test fighting games call on them. */
import type { EngineContext } from "../game/types";
import { normDeg, shapeAtPose, shapesIntersect } from "../scene/shape-geometry";
import type { Pt, ShapeObj } from "../scene/types";

/** `s` mirrored across its local y axis; a polygon's or chain's points reversed to keep its winding. */
function mirrorX(s: ShapeObj): ShapeObj {
  switch (s.type) {
    case "poly":
    case "chain":
      return { type: s.type, pts: s.pts.map(([x, y]): Pt => [0 - x, y]).reverse() };
    case "circle":
      return { ...s, cx: 0 - s.cx };
    default:
      return { ...s, cx: 0 - s.cx, rotDeg: normDeg(0 - s.rotDeg) };
  }
}

/**
 * A frame's shapes, written in the entity's local metres, placed in the
 * world: mirrored first when `flipX`, then turned and moved by the pose
 * through `shapeAtPose`'s exact quarter-turn tables.
 */
export function frameShapesAt(
  local: readonly ShapeObj[],
  pose: { x: number; y: number; rot: number },
  flipX: boolean,
): ShapeObj[] {
  return local.map((s) => shapeAtPose(flipX ? mirrorX(s) : s, pose));
}

/** True when any shape of `a`'s set `setA` touches any of `b`'s set `setB`, in world space. */
export function overlapFrameShapes(
  ctx: Pick<EngineContext, "anim">,
  a: string,
  setA: string,
  b: string,
  setB: string,
): boolean {
  const left = ctx.anim.shapes(a, setA);
  if (left.length === 0) return false;
  const right = ctx.anim.shapes(b, setB);
  return left.some((p) => right.some((q) => shapesIntersect(p, q)));
}
