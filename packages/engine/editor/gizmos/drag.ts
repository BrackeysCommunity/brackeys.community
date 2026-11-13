import { rotateShape, translateShape } from "../../scene/shape-geometry";
import { shapeToTuple } from "../../scene/shapes";
import type { OpBatch, Pt, ShapeObj } from "../../scene/types";
import { roundLength, snapToPixel } from "../../scene/units";
import { onePixel, pixelSize, roundPt, snapAngle, snapMove, snapPoint } from "../snap";
import type { SnapSettings } from "../tools";
import { moveBatch, normDeg, roundShape } from "./batch";
import {
  FORCE_PX,
  isBehaviorHandle,
  ringHandle,
  shapeToPose,
  vectorTip,
  VELOCITY_PX,
  worldToPose,
  type BehaviorGizmo,
} from "./behavior-target";
import { shapeEdit, snapDraggedPoint, type DragOptions, type GizmoEdit } from "./edit";
import { dirSigns, RESIZE_DIRS, shapePivot, type ResizeDir } from "./handles";
import { readAngle, readDelta, readPoint, readRadius, readLength } from "./readout";
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
 * All of it in the box's own (rotated) frame. Half-extents come out on
 * whole world px and at least one, so a whole-pixel anchor stays exactly
 * where it was; an unrotated box's moving edge snaps to the grid.
 */
export function resizeBox(
  b: Box,
  dir: ResizeDir,
  to: Pt,
  opts: {
    alt: boolean;
    shift: boolean;
    pxPerMetre: number;
    snap?: SnapSettings;
    bypass?: boolean;
  },
): Box {
  const [sx, sy] = dirSigns(dir);
  const ppm = opts.pxPerMetre;
  const p =
    opts.snap && b.rotDeg % 360 === 0 ? snapPoint(to, opts.snap, ppm, { bypass: opts.bypass }) : to;
  const [lx, ly] = toLocal(p, b.cx, b.cy, b.rotDeg);
  const min = onePixel(ppm);
  const extent = (s: number, l: number, h0: number) =>
    s === 0 ? h0 : opts.alt ? Math.max(min, s * l) : Math.max(min, (s * l + h0) / 2);
  let hw = extent(sx, lx, b.hw);
  let hh = extent(sy, ly, b.hh);
  if (opts.shift) {
    const k = sx && sy ? Math.max(hw / b.hw, hh / b.hh) : sx ? hw / b.hw : hh / b.hh;
    hw = b.hw * k;
    hh = b.hh * k;
  }
  hw = pixelSize(hw, ppm);
  hh = pixelSize(hh, ppm);
  const local: Pt = [
    sx && !opts.alt ? sx * (hw - b.hw) : 0,
    sy && !opts.alt ? sy * (hh - b.hh) : 0,
  ];
  const [dx, dy] = turn(local, b.rotDeg);
  return { ...b, cx: roundLength(b.cx + dx), cy: roundLength(b.cy + dy), hw, hh };
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
export function capsuleLength(c: Capsule, to: Pt, pxPerMetre: number): Capsule {
  const [, ly] = toLocal(to, c.cx, c.cy, c.rotDeg);
  return { ...c, halfLen: pixelSize(Math.abs(ly) - c.r, pxPerMetre) };
}

/** A circle's or capsule's radius from its `radius` handle, on whole world px. */
export function radiusTo(
  s: Extract<ShapeObj, { type: "circle" | "capsule" }>,
  to: Pt,
  pxPerMetre: number,
): ShapeObj {
  if (s.type === "circle")
    return { ...s, r: pixelSize(Math.hypot(to[0] - s.cx, to[1] - s.cy), pxPerMetre) };
  const [lx] = toLocal(to, s.cx, s.cy, s.rotDeg);
  return { ...s, r: pixelSize(Math.abs(lx), pxPerMetre) };
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
    pxPerMetre: opts.pxPerMetre,
    bypass: opts.mods.mod,
  });
  const by = r.delta;
  const edit: GizmoEdit = {
    batch: moveBatch([t.ref], by, opts.pxPerMetre),
    readout: readDelta(by, opts.pxPerMetre),
    guides: r.guides,
  };
  if (t.shape) edit.shape = translateShape(roundShape(t.shape, opts.pxPerMetre), by);
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
 * `to`, both raw world metres. `insert:<i>` edits the path when `t` has one,
 * else the outline. `null` for a handle `t` doesn't have.
 */
export function dragHandle(
  t: GizmoTarget,
  handleId: string,
  from: Pt,
  to: Pt,
  opts: DragOptions,
): GizmoEdit | null {
  if (isBehaviorHandle(handleId)) return dragBehaviorHandle(t, handleId, from, to, opts);
  const [kind, arg] = splitId(handleId);
  const n = arg === undefined ? NaN : Number(arg);
  const s = t.shape;
  const ppm = opts.pxPerMetre;
  switch (kind) {
    case "move":
      return moveTarget(t, from, to, opts);
    case "resize": {
      if (s?.type !== "box" || !(RESIZE_DIRS as readonly string[]).includes(arg ?? "")) return null;
      const next = resizeBox(s, arg as ResizeDir, to, {
        alt: opts.mods.alt,
        shift: opts.mods.shift,
        pxPerMetre: ppm,
        snap: opts.snap,
        bypass: opts.mods.mod,
      });
      return shapeEdit(t, next, ppm, `Resize ${t.ref}`);
    }
    case "rotate": {
      if (!s || s.type === "circle") return null;
      const { shape, deg } = rotateByHandle(s, from, to, opts.snap, opts.mods.shift);
      return shapeEdit(t, shape, ppm, `Rotate ${t.ref}`, readAngle(deg));
    }
    case "radius": {
      if (s?.type !== "circle" && s?.type !== "capsule") return null;
      const next = radiusTo(s, to, ppm);
      return shapeEdit(t, next, ppm, `Resize ${t.ref}`, readRadius((next as { r: number }).r, ppm));
    }
    case "length": {
      if (s?.type !== "capsule") return null;
      const next = capsuleLength(s, to, ppm);
      return shapeEdit(
        t,
        next,
        ppm,
        `Resize ${t.ref}`,
        readLength(2 * (next.halfLen + next.r), ppm),
      );
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

// ─── Behavior gizmos ─────────────────────────────────────

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** One `update` setting `path` on `t` to `value`; `null` when it already holds `current`. */
function behaviorBatch(
  t: GizmoTarget,
  path: string,
  value: unknown,
  current: unknown,
  label: string,
): OpBatch | null {
  return same(value, current)
    ? null
    : { label, ops: [{ op: "update", ref: t.ref, set: { [path]: value } }] };
}

/** `v` to a multiple of `step` (1, 0.1, 0.01), with no float residue and no negative zero. */
function roundTo(v: number, step: number): number {
  const decimals = Math.max(0, Math.round(-Math.log10(step)));
  return Number((Math.round(v / step) * step).toFixed(decimals)) + 0;
}

/**
 * A vector drawn `px` screen px per unit from the pose, with its tip
 * dragged by the pointer's offset: back in the pose's frame, its angle
 * snapped like a rotation and its length to `step` (mod: free, and to
 * `fine`).
 */
function draggedVector(
  b: BehaviorGizmo,
  tip: Pt,
  from: Pt,
  to: Pt,
  px: number,
  steps: { step: number; fine: number },
  opts: DragOptions,
): Pt {
  const at: Pt = [tip[0] + to[0] - from[0], tip[1] + to[1] - from[1]];
  const [lx, ly] = worldToPose(b.pose, at);
  const len = (Math.hypot(lx, ly) * opts.scale) / px;
  const free = opts.mods.mod;
  const deg = snapAngle(Math.atan2(ly, lx) / DEG, opts.snap, free || opts.mods.shift);
  const mag = roundTo(len, free ? steps.fine : steps.step);
  return [
    roundTo(mag * Math.cos(deg * DEG), steps.fine),
    roundTo(mag * Math.sin(deg * DEG), steps.fine),
  ];
}

/** A ring's radius, metres, after its handle at `start` moved by the pointer's offset. */
function draggedRadius(b: BehaviorGizmo, start: Pt, from: Pt, to: Pt): number {
  const at: Pt = [start[0] + to[0] - from[0], start[1] + to[1] - from[1]];
  return Math.hypot(at[0] - b.pose.at[0], at[1] - b.pose.at[1]);
}

const readVector = ([x, y]: Pt, unit: string) => `${roundTo(x, 0.01)}, ${roundTo(y, 0.01)} ${unit}`;

/**
 * One drag of a behavior gizmo's handle (`behaviorHandles` names them): the
 * collider's shape handles write `behaviors.collider.shape` in the pose's
 * frame; the joint's anchors, the force area's `force` or `strength`, and
 * the spawner's `spread` and `velocity` each write their field. `null` for a
 * handle `t` doesn't have.
 */
export function dragBehaviorHandle(
  t: GizmoTarget,
  handleId: string,
  from: Pt,
  to: Pt,
  opts: DragOptions,
): GizmoEdit | null {
  const b = t.behaviors;
  if (!b) return null;
  const ppm = opts.pxPerMetre;
  const colon = handleId.indexOf(":");
  const behavior = handleId.slice(0, colon);
  const part = handleId.slice(colon + 1);
  const field = (name: string) => `behaviors.${behavior}.${name}`;

  if (behavior === "collider") {
    const c = b.collider;
    const [kind] = splitId(part);
    if (!c || !["resize", "rotate", "radius", "length"].includes(kind)) return null;
    const edit = dragHandle(
      { ref: t.ref, type: t.type, bulk: false, shape: c.world },
      part,
      from,
      to,
      opts,
    );
    if (!edit?.shape) return null;
    const local = roundShape(shapeToPose(b.pose, edit.shape), ppm);
    return {
      batch: behaviorBatch(
        t,
        field("shape"),
        shapeToTuple(local),
        shapeToTuple(c.local),
        `Edit ${t.ref} collider`,
      ),
      readout: edit.readout,
      shape: edit.shape,
    };
  }

  if (behavior === "joint" && b.joint && (part === "anchorA" || part === "anchorB")) {
    const pose = part === "anchorA" ? b.pose : b.joint.to?.pose;
    const start = part === "anchorA" ? b.joint.anchorA : b.joint.anchorB;
    if (!pose || !start) return null;
    const { at, guides } = snapDraggedPoint(t, start, from, to, opts);
    const local = roundPt(worldToPose(pose, at), ppm);
    const current = roundPt(worldToPose(pose, start), ppm);
    return {
      batch: behaviorBatch(t, field(part), local, current, `Move ${t.ref} joint anchor`),
      readout: readPoint(local, ppm),
      at,
      guides,
    };
  }

  if (behavior === "force-area" && b.force) {
    if (part === "force" && b.force.kind === "directional") {
      const tip = vectorTip(b, b.force.force, FORCE_PX, opts.scale);
      const next = draggedVector(b, tip, from, to, FORCE_PX, { step: 1, fine: 0.01 }, opts);
      return {
        batch: behaviorBatch(t, field("force"), next, b.force.force, `Set ${t.ref} force`),
        readout: readVector(next, "m/s²"),
      };
    }
    if (part === "strength" && b.force.kind === "point") {
      const start = ringHandle(b, (Math.abs(b.force.strength) * FORCE_PX) / opts.scale, opts.scale);
      const mag = (draggedRadius(b, start, from, to) * opts.scale) / FORCE_PX;
      const sign = b.force.strength < 0 ? -1 : 1;
      const next = sign * roundTo(mag, opts.mods.mod ? 0.01 : 1) + 0;
      return {
        batch: behaviorBatch(t, field("strength"), next, b.force.strength, `Set ${t.ref} strength`),
        readout: `${next} m/s²`,
      };
    }
    return null;
  }

  if (behavior === "spawner" && b.spawner) {
    if (part === "spread") {
      const r0 = b.spawner.spread;
      const start = ringHandle(b, r0, opts.scale);
      const next = snapToPixel(draggedRadius(b, start, from, to), ppm);
      return {
        batch: behaviorBatch(t, field("spread"), next, r0, `Set ${t.ref} spread`),
        readout: readRadius(next, ppm),
      };
    }
    if (part === "velocity" && b.spawner.velocity) {
      const v = b.spawner.velocity;
      const tip = vectorTip(b, v, VELOCITY_PX, opts.scale);
      const next = draggedVector(b, tip, from, to, VELOCITY_PX, { step: 0.1, fine: 0.01 }, opts);
      return {
        batch: behaviorBatch(t, field("velocity"), next, v, `Set ${t.ref} spawn velocity`),
        readout: readVector(next, "m/s"),
      };
    }
  }
  return null;
}
