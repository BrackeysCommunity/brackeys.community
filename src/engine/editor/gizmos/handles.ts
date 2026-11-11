import { aabb, centroid } from "../../scene/shape-geometry";
import type { Aabb, Pt, ShapeObj } from "../../scene/types";
import type { GizmoHandle } from "../tools";
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
 * Every handle of one selected target. Normally its shape's handles (or a
 * point's move handle), with its path's waypoints drawn under them, so
 * waypoint 0 sits beneath the move handle. In sub-object mode a path's
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
  if (t.shape) return [...path, ...shapeHandles(t.shape, opts.scale)];
  return t.at ? [handle("move", "move", t.at, "move")] : [];
}

/** A multi-selection's one gizmo: move at the box's centre and a rotate stalk above it. No resize. */
export function selectionHandles(box: Aabb, scale: number): GizmoHandle[] {
  const c: Pt = [(box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2];
  return [
    handle("move", "move", c, "move"),
    handle("rotate", "rotate", [c[0], box.minY - STALK_PX / scale], "grab"),
  ];
}

/** The topmost handle within `tolPx` screen px of `p` (the last one drawn wins). */
export function hitHandle(
  handles: readonly GizmoHandle[],
  p: Pt,
  scale: number,
  tolPx = HANDLE_HIT_PX,
): GizmoHandle | undefined {
  const tol = tolPx / scale;
  for (let i = handles.length - 1; i >= 0; i--) {
    const h = handles[i]!;
    if (Math.abs(h.at[0] - p[0]) <= tol && Math.abs(h.at[1] - p[1]) <= tol) return h;
  }
  return undefined;
}
