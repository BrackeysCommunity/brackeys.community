import type { Registry } from "../../game/types";
import { translateShape } from "../../scene/shape-geometry";
import { shapeToTuple } from "../../scene/shapes";
import type { OpBatch, Pt, Ref, SceneDefinition, SceneOp, ShapeObj } from "../../scene/types";
import { validateScene } from "../../scene/validate";
import { roundPt } from "../snap";
import type { GizmoTarget } from "./target";

const round = (v: number) => Math.round(v) + 0;
const size = (v: number) => Math.max(1, round(v));

/** Degrees in [0, 360). */
export function normDeg(deg: number): number {
  return (((deg % 360) + 360) % 360) + 0;
}

/** Whole px everywhere, sizes at least 1, whole degrees: what every commit writes. */
export function roundShape(s: ShapeObj): ShapeObj {
  switch (s.type) {
    case "box":
      return {
        type: "box",
        cx: round(s.cx),
        cy: round(s.cy),
        hw: size(s.hw),
        hh: size(s.hh),
        rotDeg: round(s.rotDeg),
      };
    case "circle":
      return { type: "circle", cx: round(s.cx), cy: round(s.cy), r: size(s.r) };
    case "capsule":
      return {
        type: "capsule",
        cx: round(s.cx),
        cy: round(s.cy),
        halfLen: size(s.halfLen),
        r: size(s.r),
        rotDeg: round(s.rotDeg),
      };
    default:
      return { type: s.type, pts: s.pts.map(roundPt) };
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The `set` that gives `t` the world shape `world`, rounded, as a tuple;
 * local to the path's first point when `t` rides a path. `null` when
 * nothing would change.
 */
export function shapeSet(t: GizmoTarget, world: ShapeObj): Record<string, unknown> | null {
  if (!t.shapeField || !t.local) return null;
  const first = t.path?.pts[0];
  const local = first ? translateShape(world, [-first[0], -first[1]]) : world;
  const tuple = shapeToTuple(roundShape(local));
  return same(tuple, shapeToTuple(t.local)) ? null : { [t.shapeField]: tuple };
}

const batchOf = (label: string, ops: SceneOp[]): OpBatch | null =>
  ops.length > 0 ? { label, ops } : null;

/**
 * One `update` giving `t` the world shape `world`; `null` when rounding
 * leaves it as it was. Batches carry no `base`: the session fills it in for
 * bulk refs.
 */
export function shapeBatch(
  t: GizmoTarget,
  world: ShapeObj,
  label = `Edit ${t.ref}`,
): OpBatch | null {
  const set = shapeSet(t, world);
  return batchOf(label, set ? [{ op: "update", ref: t.ref, set }] : []);
}

/** One `update` moving a point entity to `at`, rounded. */
export function pointBatch(t: GizmoTarget, at: Pt, label = `Move ${t.ref}`): OpBatch | null {
  if (!t.pointField || !t.at) return null;
  const next = roundPt(at);
  return batchOf(
    label,
    same(next, t.at) ? [] : [{ op: "update", ref: t.ref, set: { [t.pointField]: next } }],
  );
}

/** One `update` replacing the waypoints of `t`'s path, rounded. */
export function pathBatch(
  t: GizmoTarget,
  pts: readonly Pt[],
  label = `Edit ${t.ref} path`,
): OpBatch | null {
  if (!t.path) return null;
  const next = pts.map(roundPt);
  return batchOf(
    label,
    same(next, t.path.pts)
      ? []
      : [{ op: "update", ref: t.ref, set: { [`${t.path.field}.pts`]: next } }],
  );
}

/** One `move` of `refs` by `delta`, rounded; `null` for no movement. */
export function moveBatch(refs: readonly Ref[], delta: Pt, label?: string): OpBatch | null {
  const by = roundPt(delta);
  if ((by[0] === 0 && by[1] === 0) || refs.length === 0) return null;
  const text = label ?? `Move ${refs.length === 1 ? refs[0] : `${refs.length} entities`}`;
  return { label: text, ops: [{ op: "move", refs: [...refs], by }] };
}

/**
 * The **Convert to chain** offer after a commit left `ref`'s poly concave:
 * the fix `validateScene` attaches to its `poly-invalid` issue (a convex
 * hull where the field can't hold a chain); `undefined` when there is none.
 */
export function convertToChainFix(
  def: SceneDefinition,
  registry: Registry,
  ref: Ref,
): OpBatch | undefined {
  return validateScene(def, registry).find(
    (i) => i.code === "poly-invalid" && i.entityIds.includes(ref),
  )?.fix;
}
