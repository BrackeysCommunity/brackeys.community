import { rotateShape, translateShape } from "../../scene/shape-geometry";
import type { Pt, ShapeObj } from "../../scene/types";
import { snapAngle, snapMove, snapPoint } from "../snap";
import type { SnapSettings } from "../tools";
import { moveBatch, normDeg, roundShape } from "./batch";
import { shapeEdit, type DragOptions, type GizmoEdit } from "./edit";
import { dirSigns, RESIZE_DIRS, shapePivot, type ResizeDir } from "./handles";
import { readAngle, readDelta, readRadius, readLength } from "./readout";
import { targetBox, type GizmoTarget } from "./target";
import { dragInsertVertex, dragVertex } from "./vertices";
import { dragInsertWaypoint, dragWaypoint, rebasePath } from "./waypoints";

type Box = Extract<ShapeObj, { type: "box" }>;
type Capsule = Extract<ShapeObj, { type: "capsule" }>;

const DEG = Math.PI / 180;

function turn([x, y]: Pt, deg: number): Pt {
  if (deg % 360 === 0) return [x, y];
  const c = Math.cos(deg * DEG);
  const s = Math.sin(deg * DEG);
  return [x * c - y * s, x * s + y * c];
}

/** `p` in the frame of a shape centred at (cx, cy) and turned `rotDeg`. */
const toLocal = (p: Pt, cx: number, cy: number, rotDeg: number): Pt =>
  turn([p[0] - cx, p[1] - cy], -rotDeg);

/**
 * A box resized by dragging its `dir` handle to `to`: the opposite edge
 * stays put, or with `alt` the centre does; `shift` keeps the aspect ratio.
 * All of it in the box's own (rotated) frame. Half-extents come out whole
 * and at least 1, so a whole-pixel anchor stays exactly where it was; an
 * unrotated box's moving edge snaps to the grid.
 */
export function resizeBox(
  b: Box,
  dir: ResizeDir,
  to: Pt,
  opts: { alt: boolean; shift: boolean; snap?: SnapSettings; bypass?: boolean },
): Box {
  const [sx, sy] = dirSigns(dir);
  const p =
    opts.snap && b.rotDeg % 360 === 0 ? snapPoint(to, opts.snap, { bypass: opts.bypass }) : to;
  const [lx, ly] = toLocal(p, b.cx, b.cy, b.rotDeg);
  const extent = (s: number, l: number, h0: number) =>
    s === 0 ? h0 : opts.alt ? Math.max(1, s * l) : Math.max(1, (s * l + h0) / 2);
  let hw = extent(sx, lx, b.hw);
  let hh = extent(sy, ly, b.hh);
  if (opts.shift) {
    const k = sx && sy ? Math.max(hw / b.hw, hh / b.hh) : sx ? hw / b.hw : hh / b.hh;
    hw = b.hw * k;
    hh = b.hh * k;
  }
  hw = Math.max(1, Math.round(hw));
  hh = Math.max(1, Math.round(hh));
  const local: Pt = [
    sx && !opts.alt ? sx * (hw - b.hw) : 0,
    sy && !opts.alt ? sy * (hh - b.hh) : 0,
  ];
  const [dx, dy] = turn(local, b.rotDeg);
  return { ...b, cx: b.cx + dx, cy: b.cy + dy, hw, hh };
}

/** The pointer's turn about `pivot` from `from` to `to`, degrees clockwise on screen, in (-180, 180]. */
export function dragAngle(pivot: Pt, from: Pt, to: Pt): number {
  const a0 = Math.atan2(from[1] - pivot[1], from[0] - pivot[0]);
  const a1 = Math.atan2(to[1] - pivot[1], to[0] - pivot[0]);
  let d = (a1 - a0) / DEG;
  while (d <= -180) d += 360;
  while (d > 180) d -= 360;
  return d;
}

/**
 * A shape turned by the rotate handle. A box or capsule snaps its absolute
 * `rotDeg` to the step (Shift: free) and lands in [0, 360); a poly or chain
 * snaps the turn and rotates about its centroid. Circles don't rotate.
 */
export function rotateByHandle(
  s: ShapeObj,
  from: Pt,
  to: Pt,
  snap: SnapSettings,
  free: boolean,
): { shape: ShapeObj; deg: number } {
  const pivot = shapePivot(s);
  const d = dragAngle(pivot, from, to);
  if (s.type === "box" || s.type === "capsule") {
    const rotDeg = normDeg(Math.round(snapAngle(s.rotDeg + d, snap, free)));
    return { shape: { ...s, rotDeg }, deg: rotDeg };
  }
  if (s.type === "circle") return { shape: s, deg: 0 };
  const turnBy = Math.round(snapAngle(d, snap, free)) + 0;
  return { shape: rotateShape(s, pivot, turnBy), deg: turnBy };
}

/** A capsule's half-length from its `length` handle: the caps stay `r`, the centre stays put. */
export function capsuleLength(c: Capsule, to: Pt): Capsule {
  const [, ly] = toLocal(to, c.cx, c.cy, c.rotDeg);
  return { ...c, halfLen: Math.max(1, Math.round(Math.abs(ly) - c.r)) };
}

/** A circle's or capsule's radius from its `radius` handle. */
export function radiusTo(s: Extract<ShapeObj, { type: "circle" | "capsule" }>, to: Pt): ShapeObj {
  if (s.type === "circle")
    return { ...s, r: Math.max(1, Math.round(Math.hypot(to[0] - s.cx, to[1] - s.cy))) };
  const [lx] = toLocal(to, s.cx, s.cy, s.rotDeg);
  return { ...s, r: Math.max(1, Math.round(Math.abs(lx))) };
}

/**
 * Moving one target by its move handle or body: the drag snaps (the box
 * edge nearest the grab) and becomes one `move`, which carries a path with
 * it. With Alt, a target on a path re-bases waypoint 0 instead.
 */
export function moveTarget(t: GizmoTarget, from: Pt, to: Pt, opts: DragOptions): GizmoEdit {
  if (opts.mods.alt && t.path) return rebasePath(t, from, to, opts)!;
  const r = snapMove({
    aabb: targetBox(t),
    grab: from,
    delta: [to[0] - from[0], to[1] - from[1]],
    settings: opts.snap,
    index: opts.index,
    exclude: [t.ref],
    scale: opts.scale,
    bypass: opts.mods.mod,
  });
  const by = r.delta;
  const edit: GizmoEdit = {
    batch: moveBatch([t.ref], by),
    readout: readDelta(by),
    guides: r.guides,
  };
  if (t.shape) edit.shape = translateShape(roundShape(t.shape), by);
  if (t.at) edit.at = [t.at[0] + by[0], t.at[1] + by[1]];
  if (t.path) edit.pts = t.path.pts.map(([x, y]) => [x + by[0], y + by[1]] as Pt);
  return edit;
}

const splitId = (id: string): [string, string | undefined] => {
  const colon = id.indexOf(":");
  return colon < 0 ? [id, undefined] : [id.slice(0, colon), id.slice(colon + 1)];
};

/**
 * One single-target gizmo drag, from the handle `handleId` (as
 * `targetHandles` names it) at pointer-down `from` to the pointer now at
 * `to`, both raw world px. `insert:<i>` edits the path when `t` has one,
 * else the outline. `null` for a handle `t` doesn't have.
 */
export function dragHandle(
  t: GizmoTarget,
  handleId: string,
  from: Pt,
  to: Pt,
  opts: DragOptions,
): GizmoEdit | null {
  const [kind, arg] = splitId(handleId);
  const n = arg === undefined ? NaN : Number(arg);
  const s = t.shape;
  switch (kind) {
    case "move":
      return moveTarget(t, from, to, opts);
    case "resize": {
      if (s?.type !== "box" || !(RESIZE_DIRS as readonly string[]).includes(arg ?? "")) return null;
      const next = resizeBox(s, arg as ResizeDir, to, {
        alt: opts.mods.alt,
        shift: opts.mods.shift,
        snap: opts.snap,
        bypass: opts.mods.mod,
      });
      return shapeEdit(t, next, `Resize ${t.ref}`);
    }
    case "rotate": {
      if (!s || s.type === "circle") return null;
      const { shape, deg } = rotateByHandle(s, from, to, opts.snap, opts.mods.shift);
      return shapeEdit(t, shape, `Rotate ${t.ref}`, readAngle(deg));
    }
    case "radius": {
      if (s?.type !== "circle" && s?.type !== "capsule") return null;
      const next = radiusTo(s, to);
      return shapeEdit(t, next, `Resize ${t.ref}`, readRadius((next as { r: number }).r));
    }
    case "length": {
      if (s?.type !== "capsule") return null;
      const next = capsuleLength(s, to);
      return shapeEdit(t, next, `Resize ${t.ref}`, readLength(2 * (next.halfLen + next.r)));
    }
    case "vertex":
      return dragVertex(t, n, from, to, opts);
    case "insert":
      return t.path
        ? dragInsertWaypoint(t, n, from, to, opts)
        : dragInsertVertex(t, n, from, to, opts);
    case "waypoint":
      return dragWaypoint(t, n, from, to, opts);
    default:
      return null;
  }
}
