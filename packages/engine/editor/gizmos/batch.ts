import type { Registry } from "../../game/types";
import { translateShape } from "../../scene/shape-geometry";
import { shapeToTuple } from "../../scene/shapes";
import type { OpBatch, Pt, Ref, SceneDefinition, SceneOp, ShapeObj } from "../../scene/types";
import { snapToPixel } from "../../scene/units";
import { validateScene } from "../../scene/validate";
import { pixelSize, roundPt } from "../snap";
import type { GizmoTarget } from "./target";

const deg = (v: number) => Math.round(v) + 0;

/** Degrees in [0, 360). */
export function normDeg(deg: number): number {
  return (((deg % 360) + 360) % 360) + 0;
}

/**
 * Whole world px everywhere (metres, at `pxPerMetre`), sizes at least one
 * px, whole degrees: what every commit writes.
 */
export function roundShape(s: ShapeObj, pxPerMetre: number): ShapeObj {
  const at = (v: number) => snapToPixel(v, pxPerMetre);
  const size = (v: number) => pixelSize(v, pxPerMetre);
  switch (s.type) {
    case "box":
      return {
        type: "box",
        cx: at(s.cx),
        cy: at(s.cy),
        hw: size(s.hw),
        hh: size(s.hh),
        rotDeg: deg(s.rotDeg),
      };
    case "circle":
      return { type: "circle", cx: at(s.cx), cy: at(s.cy), r: size(s.r) };
    case "capsule":
      return {
        type: "capsule",
        cx: at(s.cx),
        cy: at(s.cy),
        halfLen: size(s.halfLen),
        r: size(s.r),
        rotDeg: deg(s.rotDeg),
      };
    default:
      return { type: s.type, pts: s.pts.map((p) => roundPt(p, pxPerMetre)) };
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The `set` that gives `t` the world shape `world`, rounded, as a tuple;
 * local to the path's first point when `t` rides a path. `null` when
 * nothing would change.
 */
export function shapeSet(
  t: GizmoTarget,
  world: ShapeObj,
  pxPerMetre: number,
): Record<string, unknown> | null {
  if (!t.shapeField || !t.local) return null;
  const first = t.path?.pts[0];
  const local = first ? translateShape(world, [-first[0], -first[1]]) : world;
  const tuple = shapeToTuple(roundShape(local, pxPerMetre));
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
  pxPerMetre: number,
  label = `Edit ${t.ref}`,
): OpBatch | null {
  const set = shapeSet(t, world, pxPerMetre);
  return batchOf(label, set ? [{ op: "update", ref: t.ref, set }] : []);
}

/** One `update` moving a point entity to `at`, rounded. */
export function pointBatch(
  t: GizmoTarget,
  at: Pt,
  pxPerMetre: number,
  label = `Move ${t.ref}`,
): OpBatch | null {
  if (!t.pointField || !t.at) return null;
  const next = roundPt(at, pxPerMetre);
  return batchOf(
    label,
    same(next, t.at) ? [] : [{ op: "update", ref: t.ref, set: { [t.pointField]: next } }],
  );
}

/** One `update` replacing the waypoints of `t`'s path, rounded. */
export function pathBatch(
  t: GizmoTarget,
  pts: readonly Pt[],
  pxPerMetre: number,
  label = `Edit ${t.ref} path`,
): OpBatch | null {
  if (!t.path) return null;
  const next = pts.map((p) => roundPt(p, pxPerMetre));
  return batchOf(
    label,
    same(next, t.path.pts)
      ? []
      : [{ op: "update", ref: t.ref, set: { [`${t.path.field}.pts`]: next } }],
  );
}

/** One `move` of `refs` by `delta`, on whole world px; `null` for no movement. */
export function moveBatch(
  refs: readonly Ref[],
  delta: Pt,
  pxPerMetre: number,
  label?: string,
): OpBatch | null {
  const by = roundPt(delta, pxPerMetre);
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
