import { aabb, centroid } from "../../scene/shape-geometry";
import type { Aabb, Pt, ShapeObj } from "../../scene/types";
import type { GizmoHandle } from "../tools";
import {
  FORCE_PX,
  ringHandle,
  vectorTip,
  VELOCITY_PX,
  type BehaviorGizmo,
} from "./behavior-target";
import type { GizmoTarget } from "./target";

/** A handle's drawn side, screen px. */
export const HANDLE_PX = 8;
/** Screen px from a handle's centre that still grabs it. */
export const HANDLE_HIT_PX = 6;
/** Screen px from the shape to the rotate handle at the end of its stalk. */
export const STALK_PX = 24;

const DEG = Math.PI / 180;

function turn([x, y]: Pt, deg: number): Pt {
  if (deg % 360 === 0) return [x, y];
  const c = Math.cos(deg * DEG);
  const s = Math.sin(deg * DEG);
  return [x * c - y * s, x * s + y * c];
}

const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

/** Resize directions, in a box's own frame: `n` is its top (local -y). */
export const RESIZE_DIRS = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
export type ResizeDir = (typeof RESIZE_DIRS)[number];

/** A direction's unit signs in the box's frame. */
export function dirSigns(dir: ResizeDir): Pt {
  return [
    dir.includes("e") ? 1 : dir.includes("w") ? -1 : 0,
    dir.includes("s") ? 1 : dir.includes("n") ? -1 : 0,
  ];
}

const RESIZE_CURSORS = ["ew-resize", "nwse-resize", "ns-resize", "nesw-resize"] as const;

/** The CSS resize cursor for dragging along world direction `v`. */
export function resizeCursor([x, y]: Pt): string {
  const deg = normalize180(Math.atan2(y, x) / DEG);
  return RESIZE_CURSORS[Math.round(deg / 45) % 4]!;
}

function normalize180(deg: number): number {
  return ((deg % 180) + 180) % 180;
}

/** What a shape turns about: a box's, circle's or capsule's centre, a poly's or chain's centroid. */
export function shapePivot(s: ShapeObj): Pt {
  return s.type === "poly" || s.type === "chain" ? centroid(s.pts) : [s.cx, s.cy];
}

const handle = (id: string, kind: GizmoHandle["kind"], at: Pt, cursor?: string): GizmoHandle =>
  cursor ? { id, kind, at, cursor } : { id, kind, at };

/**
 * A shape's handles, at a constant screen size for `scale` (screen px per
 * metre): move at the pivot; a box's eight resize handles and rotate
 * stalk; a circle's radius; a capsule's half-length, radius and rotate; a
 * poly's or chain's rotate. Later handles draw over earlier ones.
 */
export function shapeHandles(s: ShapeObj, scale: number): GizmoHandle[] {
  const stalk = STALK_PX / scale;
  const pivot = shapePivot(s);
  const out: GizmoHandle[] = [handle("move", "move", pivot, "move")];
  switch (s.type) {
    case "box": {
      for (const dir of RESIZE_DIRS) {
        const [sx, sy] = dirSigns(dir);
        const v = turn([sx * s.hw, sy * s.hh], s.rotDeg);
        out.push(
          handle(`resize:${dir}`, "resize", add(pivot, v), resizeCursor(turn([sx, sy], s.rotDeg))),
        );
      }
      out.push(handle("rotate", "rotate", add(pivot, turn([0, -s.hh - stalk], s.rotDeg)), "grab"));
      break;
    }
    case "circle":
      out.push(handle("radius", "radius", [s.cx + s.r, s.cy], "ew-resize"));
      break;
    case "capsule": {
      const top = turn([0, -s.halfLen - s.r], s.rotDeg);
      out.push(handle("length", "length", add(pivot, top), resizeCursor(top)));
      const side = turn([s.r, 0], s.rotDeg);
      out.push(handle("radius", "radius", add(pivot, side), resizeCursor(side)));
      out.push(
        handle(
          "rotate",
          "rotate",
          add(pivot, turn([0, -s.halfLen - s.r - stalk], s.rotDeg)),
          "grab",
        ),
      );
      break;
    }
    default: {
      const b = aabb(s);
      out.push(handle("rotate", "rotate", [pivot[0], b.minY - stalk], "grab"));
    }
  }
  return out;
}

/** Point editing: a square per vertex and a `+` at each segment's midpoint (a poly's closing one too). */
export function vertexHandles(s: ShapeObj): GizmoHandle[] {
  if (s.type !== "poly" && s.type !== "chain") return [];
  return pointHandles(s.pts, s.type === "poly", "vertex");
}

function pointHandles(
  pts: readonly Pt[],
  closed: boolean,
  kind: "vertex" | "waypoint",
): GizmoHandle[] {
  const n = closed ? pts.length : pts.length - 1;
  const inserts: GizmoHandle[] = [];
  for (let i = 0; i < n; i++)
    inserts.push(handle(`insert:${i}`, "insert", mid(pts[i]!, pts[(i + 1) % pts.length]!), "copy"));
  return [...inserts, ...pts.map((p, i) => handle(`${kind}:${i}`, kind, [p[0], p[1]], "move"))];
}

/**
 * A path's waypoint handles; with `inserts`, a `+` at each segment's
 * midpoint, and a loop's closing segment.
 */
export function waypointHandles(
  pts: readonly Pt[],
  opts: { inserts: boolean; loop?: boolean },
): GizmoHandle[] {
  const all = pointHandles(pts, opts.loop === true, "waypoint");
  return opts.inserts ? all : all.filter((h) => h.kind === "waypoint");
}

/**
 * A behavior gizmo's handles, ids prefixed by the behavior: the collider's
 * shape handles (no move: the entity's own moves it), the joint's anchors,
 * the force area's arrow tip or strength ring, the spawner's spread ring
 * and velocity tip. A force is drawn `FORCE_PX` screen px per m/s², a
 * velocity `VELOCITY_PX` per m/s; the spread is its radius in metres.
 */
export function behaviorHandles(b: BehaviorGizmo, scale: number): GizmoHandle[] {
  const out: GizmoHandle[] = [];
  const anchors = b.joint ? jointAnchorHandles(b) : [];
  if (b.collider) {
    const arrows = arrowTips(b, scale);
    for (const h of shapeHandles(b.collider.world, scale))
      if (h.kind !== "move" && !(isEdgeResize(h) && anchors.some((a) => covers(a.at, h.at, scale))))
        out.push({
          ...h,
          id: `collider:${h.id}`,
          ...(h.kind === "rotate" ? { at: clearOfArrows(b, h.at, arrows, scale) } : {}),
        });
  }
  if (b.spawner) {
    out.push(
      handle("spawner:spread", "radius", ringHandle(b, b.spawner.spread, scale), "ew-resize"),
    );
    if (b.spawner.velocity)
      out.push(
        handle(
          "spawner:velocity",
          "length",
          vectorTip(b, b.spawner.velocity, VELOCITY_PX, scale),
          "move",
        ),
      );
  }
  if (b.force?.kind === "directional")
    out.push(
      handle("force-area:force", "length", vectorTip(b, b.force.force, FORCE_PX, scale), "move"),
    );
  if (b.force?.kind === "point")
    out.push(
      handle(
        "force-area:strength",
        "radius",
        ringHandle(b, (Math.abs(b.force.strength) * FORCE_PX) / scale, scale),
        "ew-resize",
      ),
    );
  if (anchors.length > 0) {
    const others = [...out.map((h) => h.at), b.pose.at];
    const [a, other] = anchors;
    if (a && other && covers(other.at, a.at, scale))
      a.at = clearSpot(a.at, b.pose.at, [other.at, ...others], scale);
    out.push(...anchors);
  }
  return out;
}

/** Screen px an arrow's shaft keeps clear of the collider's rotate handle. */
const ARROW_CLEAR_PX = 2 * HANDLE_PX;

/** The tips of the arrows `b` draws from its pose: the force area's force and the spawner's velocity. */
function arrowTips(b: BehaviorGizmo, scale: number): Pt[] {
  const tips: Pt[] = [];
  if (b.force?.kind === "directional") tips.push(vectorTip(b, b.force.force, FORCE_PX, scale));
  if (b.spawner?.velocity) tips.push(vectorTip(b, b.spawner.velocity, VELOCITY_PX, scale));
  return tips;
}

/** World distance from `p` to the segment `a`–`b`. */
function segmentDistance(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t =
    len2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/**
 * The collider's rotate handle, moved off any arrow drawn through it. A box
 * or capsule takes its stalk on the other side of the pivot (its preview
 * reads the corners or the length handle). Any other shape's preview reads
 * the turn from the rotate handle's angle about the pivot, so it keeps that
 * angle and moves out past the arrow's tip.
 */
function clearOfArrows(b: BehaviorGizmo, at: Pt, tips: readonly Pt[], scale: number): Pt {
  const clear = ARROW_CLEAR_PX / scale;
  const hit = (p: Pt) => tips.some((tip) => segmentDistance(p, b.pose.at, tip) < clear);
  const shape = b.collider?.world;
  if (!shape || !hit(at)) return at;
  const pivot = shapePivot(shape);
  if (shape.type === "box" || shape.type === "capsule") {
    const flipped: Pt = [2 * pivot[0] - at[0], 2 * pivot[1] - at[1]];
    if (!hit(flipped)) return flipped;
  }
  const dx = at[0] - pivot[0];
  const dy = at[1] - pivot[1];
  const len = Math.hypot(dx, dy);
  if (len === 0) return at;
  const [ux, uy] = [dx / len, dy / len];
  let reach = len;
  for (const tip of tips)
    reach = Math.max(reach, (tip[0] - pivot[0]) * ux + (tip[1] - pivot[1]) * uy + STALK_PX / scale);
  return [pivot[0] + ux * reach, pivot[1] + uy * reach];
}

/** Screen px a stacked anchor's handle moves aside: past the hit box of the one it covered. */
const ANCHOR_ASIDE_PX = 2 * HANDLE_HIT_PX + 2;

/** A box's edge-midpoint resize handle: the corners stay, since a previewed resize reads all four. */
const isEdgeResize = (h: GizmoHandle): boolean =>
  h.kind === "resize" && h.id.length === "resize:n".length;

/** Whether a handle at `top` hides the centre of one at `under`. */
const covers = (top: Pt, under: Pt, scale: number): boolean =>
  Math.max(Math.abs(top[0] - under[0]), Math.abs(top[1] - under[1])) <= HANDLE_HIT_PX / scale;

/**
 * The joint's anchor handles at their anchors. Where they coincide (a chain
 * link or hinge pinned to its partner) the caller moves anchorA's aside so
 * both can be grabbed; a drag moves an anchor by the pointer's travel.
 */
function jointAnchorHandles(b: BehaviorGizmo): GizmoHandle[] {
  if (!b.joint) return [];
  const out = [handle("joint:anchorA", "vertex", b.joint.anchorA, "move")];
  if (b.joint.anchorB) out.push(handle("joint:anchorB", "vertex", b.joint.anchorB, "move"));
  return out;
}

/** How many `ANCHOR_ASIDE_PX` steps out a stacked anchor may move looking for a clear spot. */
const ANCHOR_ASIDE_STEPS = 3;

/**
 * The nearest spot, in `ANCHOR_ASIDE_PX` screen px steps from `at`, whose
 * hit box overlaps none of `taken`: at each step across the line from `at`
 * to `toward` first, then along it, then the diagonals. On a thin collider
 * the first step can land between two corner handles, so it steps further
 * out rather than cover them. The first candidate when none is clear.
 */
function clearSpot(at: Pt, toward: Pt, taken: readonly Pt[], scale: number): Pt {
  const dx = toward[0] - at[0];
  const dy = toward[1] - at[1];
  const len = Math.hypot(dx, dy);
  const [ux, uy] = len > 1e-9 ? [dx / len, dy / len] : [1, 0];
  const dirs: Pt[] = [
    [uy, -ux],
    [-uy, ux],
    [ux, uy],
    [-ux, -uy],
    [ux + uy, uy - ux],
    [ux - uy, uy + ux],
    [-ux + uy, -uy - ux],
    [-ux - uy, -uy + ux],
  ];
  const clear = (p: Pt) =>
    taken.every(
      (q) => Math.max(Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1])) >= (2 * HANDLE_HIT_PX) / scale,
    );
  let first: Pt | undefined;
  for (let step = 1; step <= ANCHOR_ASIDE_STEPS; step++)
    for (const [x, y] of dirs) {
      const d = (step * ANCHOR_ASIDE_PX) / scale / Math.max(Math.abs(x), Math.abs(y));
      const spot: Pt = [at[0] + x * d, at[1] + y * d];
      if (clear(spot)) return spot;
      first ??= spot;
    }
  return first!;
}

/**
 * Every handle of one selected target. Normally its shape's handles (or a
 * point's move handle), with its path's waypoints drawn under them, so
 * waypoint 0 sits beneath the move handle, and its behaviors' handles
 * under both, so the entity's own win where they meet. In sub-object mode a path's
 * waypoints and inserts, or else a poly's or chain's vertices and inserts.
 */
export function targetHandles(
  t: GizmoTarget,
  opts: { scale: number; subObject?: boolean },
): GizmoHandle[] {
  if (opts.subObject) {
    if (t.path) return waypointHandles(t.path.pts, { inserts: true, loop: t.path.loop });
    return t.shape ? vertexHandles(t.shape) : [];
  }
  const path = t.path ? waypointHandles(t.path.pts, { inserts: false }) : [];
  const behaviors = t.behaviors ? behaviorHandles(t.behaviors, opts.scale) : [];
  if (t.shape) return [...behaviors, ...path, ...shapeHandles(t.shape, opts.scale)];
  if (t.frame) return [...behaviors, ...frameHandles(t.frame, t.box, opts.scale)];
  return t.at ? [...behaviors, handle("move", "move", t.at, "move")] : behaviors;
}

/**
 * A node's or an instance's handles: move at its origin, and rotate on a
 * stalk from the origin along the frame's up (its local -y), out past the
 * box over what sits under it so the handle clears its children.
 */
export function frameHandles(
  f: { at: Pt; rot: number },
  box: Aabb | undefined,
  scale: number,
): GizmoHandle[] {
  const up = turn([0, -1], f.rot);
  let reach = 0;
  if (box)
    for (const x of [box.minX, box.maxX])
      for (const y of [box.minY, box.maxY])
        reach = Math.max(reach, (x - f.at[0]) * up[0] + (y - f.at[1]) * up[1]);
  const len = reach + STALK_PX / scale;
  const at: Pt = [f.at[0] + up[0] * len, f.at[1] + up[1] * len];
  return [
    handle("move", "move", [f.at[0], f.at[1]], "move"),
    { ...handle("rotate", "rotate", at, "grab"), stalk: [f.at[0], f.at[1]] },
  ];
}

/** A multi-selection's one gizmo: move at the box's centre and a rotate stalk above it. No resize. */
export function selectionHandles(box: Aabb, scale: number): GizmoHandle[] {
  const c: Pt = [(box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2];
  return [
    handle("move", "move", c, "move"),
    handle("rotate", "rotate", [c[0], box.minY - STALK_PX / scale], "grab"),
  ];
}

/**
 * The handle under `p`: the topmost one whose drawn square holds it, else
 * the nearest within `tolPx` screen px (the topmost on a tie). A handle
 * partly covered by a neighbour, such as a thin box's corners under a joint
 * anchor, can still be grabbed where it shows.
 */
export function hitHandle(
  handles: readonly GizmoHandle[],
  p: Pt,
  scale: number,
  tolPx = HANDLE_HIT_PX,
): GizmoHandle | undefined {
  const tol = tolPx / scale;
  const half = Math.min(HANDLE_PX / 2, tolPx) / scale;
  let best: GizmoHandle | undefined;
  let bestD = Infinity;
  for (let i = handles.length - 1; i >= 0; i--) {
    const h = handles[i]!;
    const d = Math.max(Math.abs(h.at[0] - p[0]), Math.abs(h.at[1] - p[1]));
    if (d <= half) return h;
    if (d <= tol && d < bestD) {
      best = h;
      bestD = d;
    }
  }
  return best;
}
