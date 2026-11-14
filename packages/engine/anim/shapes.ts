/** Frame shapes in world space, and the overlap test fighting games call on them. */
import type { EngineContext } from "../game/types";
import { flipShapeX, shapeAtPose, shapesIntersect } from "../scene/shape-geometry";
import type { ShapeObj } from "../scene/types";

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
  return local.map((s) => shapeAtPose(flipX ? flipShapeX(s) : s, pose));
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
