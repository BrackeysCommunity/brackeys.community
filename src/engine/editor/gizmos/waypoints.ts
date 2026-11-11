import { translateShape } from "../../scene/shape-geometry";
import type { Pt } from "../../scene/types";
import { roundPt } from "../snap";
import { pathBatch } from "./batch";
import { snapDraggedPoint, type DragOptions, type GizmoEdit } from "./edit";
import { readDelta, readPoint } from "./readout";
import type { GizmoTarget } from "./target";

/** The fewest waypoints a path keeps. */
export const MIN_WAYPOINTS = 2;

function pathEdit(
  t: GizmoTarget,
  pts: Pt[],
  pxPerMetre: number,
  label: string,
  readout: string,
): GizmoEdit {
  const next = pts.map((p) => roundPt(p, pxPerMetre));
  const first = next[0]!;
  return {
    batch: pathBatch(t, next, pxPerMetre, label),
    readout,
    pts: next,
    // The shape rides the first waypoint, so it follows when that one moves.
    ...(t.local ? { shape: translateShape(t.local, first) } : {}),
  };
}

/** Dragging waypoint `index` of `t`'s path, snapped. */
export function dragWaypoint(
  t: GizmoTarget,
  index: number,
  from: Pt,
  to: Pt,
  opts: DragOptions,
): GizmoEdit | null {
  const start = t.path?.pts[index];
  if (!t.path || !start) return null;
  const { at, guides } = snapDraggedPoint(t, start, from, to, opts);
  const pts = t.path.pts.map((p, i) => (i === index ? at : p));
  const ppm = opts.pxPerMetre;
  const moved = roundPt([at[0] - start[0], at[1] - start[1]], ppm);
  return {
    ...pathEdit(t, pts, ppm, `Move ${t.ref} waypoint ${index}`, readDelta(moved, ppm)),
    guides,
  };
}

/**
 * Alt-dragging the follower itself: waypoint 0 moves and the rest of the path
 * stays, so the path starts somewhere new. A plain drag moves the whole
 * path (a `move` op).
 */
export function rebasePath(t: GizmoTarget, from: Pt, to: Pt, opts: DragOptions): GizmoEdit | null {
  return dragWaypoint(t, 0, from, to, opts);
}

/**
 * Dragging the `+` of segment `segment` (waypoint `segment` to the next; a
 * loop's last segment closes back to 0): a new waypoint from its midpoint.
 */
export function dragInsertWaypoint(
  t: GizmoTarget,
  segment: number,
  from: Pt,
  to: Pt,
  opts: DragOptions,
): GizmoEdit | null {
  const pts = t.path?.pts;
  if (!pts) return null;
  const closing = segment === pts.length - 1 && t.path!.loop;
  const a = pts[segment];
  const b = closing ? pts[0] : pts[segment + 1];
  if (!a || !b) return null;
  const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const { at, guides } = snapDraggedPoint(t, mid, from, to, opts);
  const next = [...pts];
  next.splice(segment + 1, 0, at);
  return {
    ...pathEdit(
      t,
      next,
      opts.pxPerMetre,
      `Add a waypoint to ${t.ref}`,
      readPoint(roundPt(at, opts.pxPerMetre), opts.pxPerMetre),
    ),
    guides,
  };
}

/** Deleting waypoints `indices`; `null` (refused) when fewer than 2 would be left. */
export function removeWaypoints(
  t: GizmoTarget,
  indices: readonly number[],
  pxPerMetre: number,
): GizmoEdit | null {
  const pts = t.path?.pts;
  if (!pts) return null;
  const drop = new Set(indices);
  const next = pts.filter((_, i) => !drop.has(i));
  if (next.length < MIN_WAYPOINTS || next.length === pts.length) return null;
  const n = pts.length - next.length;
  return pathEdit(
    t,
    next,
    pxPerMetre,
    `Delete ${n === 1 ? "a waypoint" : `${n} waypoints`} of ${t.ref}`,
    `${next.length} waypoints`,
  );
}
