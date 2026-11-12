import type { Pt, ShapeObj } from "../../scene/types";
import { roundPt } from "../snap";
import { snapDraggedPoint, shapeEdit, type DragOptions, type GizmoEdit } from "./edit";
import { readDelta, readPoint } from "./readout";
import type { GizmoTarget } from "./target";

export type PointShape = Extract<ShapeObj, { type: "poly" | "chain" }>;

/** The fewest points each outline keeps: a poly 3, a chain 2. */
export const MIN_POINTS = { poly: 3, chain: 2 } as const;

const isPointShape = (s: ShapeObj | undefined): s is PointShape =>
  s?.type === "poly" || s?.type === "chain";

/** `s` with point `index` at `at`. */
export function moveVertex(s: PointShape, index: number, at: Pt): PointShape {
  return { type: s.type, pts: s.pts.map((p, i) => (i === index ? at : p)) };
}

/** `s` with a new point `at` on segment `segment`, i.e. at index `segment + 1`. */
export function insertVertex(s: PointShape, segment: number, at: Pt): PointShape {
  const pts = [...s.pts];
  pts.splice(segment + 1, 0, at);
  return { type: s.type, pts };
}

/** `s` without the points at `indices`; `null` when that leaves fewer than `MIN_POINTS`. */
export function deleteVertices(s: PointShape, indices: readonly number[]): PointShape | null {
  const drop = new Set(indices);
  const pts = s.pts.filter((_, i) => !drop.has(i));
  return pts.length < MIN_POINTS[s.type] || pts.length === s.pts.length
    ? null
    : { type: s.type, pts };
}

/** Dragging vertex `index` of `t`'s poly or chain from `from` to `to`, snapped. */
export function dragVertex(
  t: GizmoTarget,
  index: number,
  from: Pt,
  to: Pt,
  opts: DragOptions,
): GizmoEdit | null {
  const s = t.shape;
  const start = isPointShape(s) ? s.pts[index] : undefined;
  if (!isPointShape(s) || !start) return null;
  const { at, guides } = snapDraggedPoint(t, start, from, to, opts);
  const ppm = opts.pxPerMetre;
  const moved = roundPt([at[0] - start[0], at[1] - start[1]], ppm);
  return {
    ...shapeEdit(t, moveVertex(s, index, at), ppm, `Edit ${t.ref} points`, readDelta(moved, ppm)),
    guides,
  };
}

/** Dragging the `+` of segment `segment`: a new vertex starting at the segment's midpoint. */
export function dragInsertVertex(
  t: GizmoTarget,
  segment: number,
  from: Pt,
  to: Pt,
  opts: DragOptions,
): GizmoEdit | null {
  const s = t.shape;
  if (!isPointShape(s)) return null;
  const a = s.pts[segment];
  const b = s.pts[(segment + 1) % s.pts.length];
  if (!a || !b || (s.type === "chain" && segment >= s.pts.length - 1)) return null;
  const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const { at, guides } = snapDraggedPoint(t, mid, from, to, opts);
  return {
    ...shapeEdit(
      t,
      insertVertex(s, segment, at),
      opts.pxPerMetre,
      `Add a point to ${t.ref}`,
      readPoint(roundPt(at, opts.pxPerMetre), opts.pxPerMetre),
    ),
    guides,
  };
}

/** Deleting vertices `indices`; `null` (refused) when that would leave a poly under 3 or a chain under 2. */
export function removeVertices(
  t: GizmoTarget,
  indices: readonly number[],
  pxPerMetre: number,
): GizmoEdit | null {
  const s = t.shape;
  if (!isPointShape(s)) return null;
  const next = deleteVertices(s, indices);
  if (!next) return null;
  const n = s.pts.length - next.pts.length;
  return shapeEdit(
    t,
    next,
    pxPerMetre,
    `Delete ${n === 1 ? "a point" : `${n} points`} of ${t.ref}`,
    `${next.pts.length} points`,
  );
}
