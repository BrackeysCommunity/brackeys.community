import type { Aabb, Pt, ShapeObj } from "./types";

const DEG = Math.PI / 180;

/** An angle in degrees in [0, 360), never `-0`. */
export const normDeg = (deg: number) => {
  const r = deg % 360;
  return r < 0 ? r + 360 : r + 0;
};

/** `[x, y]` turned `deg` degrees clockwise on screen; quarter turns are exact. */
function rotate([x, y]: Pt, deg: number): Pt {
  switch (normDeg(deg)) {
    case 0:
      return [x, y];
    case 90:
      return [0 - y, x + 0];
    case 180:
      return [0 - x, 0 - y];
    case 270:
      return [y + 0, 0 - x];
  }
  const rad = (deg % 360) * DEG;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [x * c - y * s, x * s + y * c];
}

function boundsOf(pts: readonly Pt[], pad = 0): Aabb {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

function capsuleEnds(s: Extract<ShapeObj, { type: "capsule" }>): [Pt, Pt] {
  const [dx, dy] = rotate([0, s.halfLen], s.rotDeg);
  return [
    [s.cx - dx, s.cy - dy],
    [s.cx + dx, s.cy + dy],
  ];
}

export function boxCorners(s: Extract<ShapeObj, { type: "box" }>): Pt[] {
  const local: Pt[] = [
    [-s.hw, -s.hh],
    [s.hw, -s.hh],
    [s.hw, s.hh],
    [-s.hw, s.hh],
  ];
  return local.map((p) => {
    const [x, y] = rotate(p, s.rotDeg);
    return [s.cx + x, s.cy + y] as Pt;
  });
}

/** World-space bounding box. Rotation is degrees here, as in the document. */
export function aabb(s: ShapeObj): Aabb {
  switch (s.type) {
    case "box":
      if (s.rotDeg % 360 === 0)
        return { minX: s.cx - s.hw, minY: s.cy - s.hh, maxX: s.cx + s.hw, maxY: s.cy + s.hh };
      return boundsOf(boxCorners(s));
    case "circle":
      return { minX: s.cx - s.r, minY: s.cy - s.r, maxX: s.cx + s.r, maxY: s.cy + s.r };
    case "capsule":
      return boundsOf(capsuleEnds(s), s.r);
    case "poly":
    case "chain":
      return boundsOf(s.pts);
  }
}

/** `b` as an unturned box shape. */
export const aabbBox = (b: Aabb): ShapeObj => ({
  type: "box",
  cx: (b.minX + b.maxX) / 2,
  cy: (b.minY + b.maxY) / 2,
  hw: (b.maxX - b.minX) / 2,
  hh: (b.maxY - b.minY) / 2,
  rotDeg: 0,
});

/**
 * The box a camera region with `shape` frames, which every view draws and
 * the editor picks by: `shape` itself when it's an unturned box, else its
 * axis-aligned bounds.
 */
export const regionBox = (shape: ShapeObj): ShapeObj =>
  shape.type === "box" && shape.rotDeg % 360 === 0 ? shape : aabbBox(aabb(shape));

export function aabbUnion(a: Aabb, b: Aabb): Aabb {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

/** An angle in degrees seen in a mirror: a flip turns it the other way. */
export const mirrorDeg = (deg: number) => 0 - deg;

/**
 * `s` mirrored across its local y axis: x negated, a box's or capsule's
 * `rotDeg` mirrored (kept in [0, 360)), and a polygon's or chain's points
 * reversed to keep their winding, as a flipping scene transform does.
 */
export function flipShapeX(s: ShapeObj): ShapeObj {
  switch (s.type) {
    case "poly":
    case "chain":
      return { type: s.type, pts: s.pts.map(([x, y]): Pt => [0 - x, y]).reverse() };
    case "circle":
      return { ...s, cx: 0 - s.cx };
    default:
      return { ...s, cx: 0 - s.cx, rotDeg: normDeg(mirrorDeg(s.rotDeg)) };
  }
}

export function translateShape(s: ShapeObj, [dx, dy]: Pt): ShapeObj {
  switch (s.type) {
    case "poly":
    case "chain":
      return { type: s.type, pts: s.pts.map(([x, y]) => [x + dx, y + dy] as Pt) };
    default:
      return { ...s, cx: s.cx + dx, cy: s.cy + dy };
  }
}

/** Positive when the points run counter-clockwise in a y-up frame (clockwise on screen). */
export function signedArea(pts: readonly Pt[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i]!;
    const [x1, y1] = pts[(i + 1) % pts.length]!;
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

/** Area centroid of a polygon; the mean of the points when the area is zero. */
export function centroid(pts: readonly Pt[]): Pt {
  if (pts.length === 0) return [0, 0];
  const area = signedArea(pts);
  if (pts.length < 3 || Math.abs(area) < 1e-9) {
    const [sx, sy] = pts.reduce<Pt>(([ax, ay], [x, y]) => [ax + x, ay + y], [0, 0]);
    return [sx / pts.length, sy / pts.length];
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i]!;
    const [x1, y1] = pts[(i + 1) % pts.length]!;
    const f = x0 * y1 - x1 * y0;
    cx += (x0 + x1) * f;
    cy += (y0 + y1) * f;
  }
  return [cx / (6 * area), cy / (6 * area)];
}

const QUARTER = Math.PI / 2;

/** How many quarter turns (0–3) `rad` is, within float error; null for any other angle. */
export function quarterTurns(rad: number): 0 | 1 | 2 | 3 | null {
  if (rad === 0) return 0;
  const q = Math.round(rad / QUARTER);
  return Math.abs(rad - q * QUARTER) < 1e-12 ? ((((q % 4) + 4) % 4) as 0 | 1 | 2 | 3) : null;
}

/** `[x, y]` turned `rad` radians clockwise on screen; within float error of a quarter turn, exact. */
export function turnBy([x, y]: Pt, rad: number): Pt {
  switch (quarterTurns(rad)) {
    case 0:
      return [x, y];
    case 1:
      return [0 - y, x + 0];
    case 2:
      return [0 - x, 0 - y];
    case 3:
      return [y + 0, 0 - x];
  }
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [x * c - y * s, x * s + y * c];
}

/** Where geometry places an entity. */
export type GeometryPose = {
  at: Pt;
  /** A box's or capsule's `rotDeg`; absent, the angle is the entity's quarter turns. */
  rotDeg?: number;
};

/** A shape's centre and the angle it fixes: a box's or capsule's `rotDeg`; a circle, polygon or chain takes its entity's turns. */
export function shapeCentre(shape: ShapeObj): GeometryPose {
  switch (shape.type) {
    case "box":
    case "capsule":
      return { at: [shape.cx, shape.cy], rotDeg: shape.rotDeg };
    case "circle":
      return { at: [shape.cx, shape.cy] };
    case "poly":
      return { at: centroid(shape.pts) };
    case "chain": {
      const b = aabb(shape);
      return { at: [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2] };
    }
  }
}

/**
 * Where an entity spawns from its geometry: its shape's centre (a path
 * rider's shape placed at the path's first point), else its point, else its
 * path's first point; null with none of them.
 */
export function geometryPose(g: {
  shape?: ShapeObj;
  at?: Pt;
  path?: { pts: readonly Pt[] };
}): GeometryPose | null {
  const origin = g.path?.pts[0];
  if (g.shape) {
    const local = shapeCentre(g.shape);
    if (!origin) return local;
    return { ...local, at: [origin[0] + local.at[0], origin[1] + local.at[1]] };
  }
  const p = g.at ?? origin;
  return p ? { at: [p[0], p[1]] } : null;
}

/**
 * True for a simple convex polygon in either winding: non-zero area, every
 * turn the same way (collinear points allowed), and one full revolution, so
 * a star or bow-tie whose turns agree still fails.
 */
export function isConvex(pts: readonly Pt[]): boolean {
  const n = pts.length;
  if (n < 3 || Math.abs(signedArea(pts)) < 1e-9) return false;
  let sign = 0;
  let turning = 0;
  for (let i = 0; i < n; i++) {
    const [ax, ay] = pts[i]!;
    const [bx, by] = pts[(i + 1) % n]!;
    const [cx, cy] = pts[(i + 2) % n]!;
    const e1x = bx - ax;
    const e1y = by - ay;
    const e2x = cx - bx;
    const e2y = cy - by;
    if ((e1x === 0 && e1y === 0) || (e2x === 0 && e2y === 0)) return false;
    const cross = e1x * e2y - e1y * e2x;
    if (cross !== 0) {
      const s = Math.sign(cross);
      if (sign === 0) sign = s;
      else if (s !== sign) return false;
    }
    turning += Math.atan2(cross, e1x * e2x + e1y * e2y);
  }
  return Math.abs(Math.abs(turning) - 2 * Math.PI) < 1e-6;
}

/**
 * The convex hull of `pts` (Andrew's monotone chain) without collinear or
 * repeated points, wound the same way as `pts`; fewer than 3 points when
 * they all lie on one line.
 */
export function convexHull(pts: readonly Pt[]): Pt[] {
  const sorted = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Pt, a: Pt, b: Pt) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: Pt[]): Pt[] => {
    const out: Pt[] = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2]!, out[out.length - 1]!, p) <= 0)
        out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  const hull = [...half(sorted), ...half([...sorted].reverse())];
  if (hull.length < 3) return hull;
  return signedArea(pts) < 0 === signedArea(hull) < 0 ? hull : hull.reverse();
}

/** The point of segment `a`→`b` nearest `p`, how far along it is (0 at `a`, 1 at `b`) and its distance. */
export function closestOnSegment(
  [px, py]: Pt,
  [ax, ay]: Pt,
  [bx, by]: Pt,
): { at: Pt; t: number; dist: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  const at: Pt = [ax + t * dx, ay + t * dy];
  return { at, t, dist: Math.hypot(px - at[0], py - at[1]) };
}

const distToSegment = (p: Pt, a: Pt, b: Pt): number => closestOnSegment(p, a, b).dist;

function insidePolygon([px, py]: Pt, pts: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]!;
    const [xj, yj] = pts[j]!;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Whether `p` is inside `s`, or within `tol` px of it. A chain has no inside. */
export function containsPoint(s: ShapeObj, p: Pt, tol = 0): boolean {
  switch (s.type) {
    case "box": {
      const [lx, ly] = rotate([p[0] - s.cx, p[1] - s.cy], 0 - s.rotDeg);
      return Math.abs(lx) <= s.hw + tol && Math.abs(ly) <= s.hh + tol;
    }
    case "circle":
      return Math.hypot(p[0] - s.cx, p[1] - s.cy) <= s.r + tol;
    case "capsule": {
      const [a, b] = capsuleEnds(s);
      return distToSegment(p, a, b) <= s.r + tol;
    }
    case "poly":
      if (insidePolygon(p, s.pts)) return true;
      return (
        tol > 0 && s.pts.some((a, i) => distToSegment(p, a, s.pts[(i + 1) % s.pts.length]!) <= tol)
      );
    case "chain":
      return s.pts.slice(1).some((b, i) => distToSegment(p, s.pts[i]!, b) <= tol);
  }
}

/** The least squared distance from `p` to the segments joining `pts` in turn, closing the loop with `closed`. */
function segmentsDist2(p: Pt, pts: readonly Pt[], closed: boolean): number {
  if (pts.length === 1) return dist2(p, pts[0]!);
  let best = Infinity;
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const d2 = dist2(p, nearestOnSegment(p, pts[i]!, pts[(i + 1) % pts.length]!));
    if (d2 < best) best = d2;
  }
  return best;
}

/**
 * How far `p` is from `s`: 0 inside it or on its edge (a polygon's holes
 * by its outline, concave or not; a chain has no inside). Square roots
 * only, so every platform gives the same answer.
 */
export function distanceToShape(s: ShapeObj, p: Pt): number {
  switch (s.type) {
    case "box": {
      const [lx, ly] = rotate([p[0] - s.cx, p[1] - s.cy], 0 - s.rotDeg);
      const dx = Math.max(Math.abs(lx) - s.hw, 0);
      const dy = Math.max(Math.abs(ly) - s.hh, 0);
      return Math.sqrt(dx * dx + dy * dy);
    }
    case "circle": {
      const d2 = dist2(p, [s.cx, s.cy]);
      return d2 <= s.r * s.r ? 0 : Math.max(Math.sqrt(d2) - s.r, 0);
    }
    case "capsule": {
      const [a, b] = capsuleEnds(s);
      const d2 = dist2(p, nearestOnSegment(p, a, b));
      return d2 <= s.r * s.r ? 0 : Math.max(Math.sqrt(d2) - s.r, 0);
    }
    case "poly":
      return insidePolygon(p, s.pts) ? 0 : Math.sqrt(segmentsDist2(p, s.pts, true));
    case "chain":
      return Math.sqrt(segmentsDist2(p, s.pts, false));
  }
}

/** Whether two boxes share a point; touching counts. */
export const rectsOverlap = (a: Aabb, b: Aabb) =>
  a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;

/** Whether segment `a`→`b` touches `r` (Liang–Barsky clipping). */
function segmentHitsRect(a: Pt, b: Pt, r: Aabb): boolean {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  let t0 = 0;
  let t1 = 1;
  const clips: [p: number, q: number][] = [
    [-dx, a[0] - r.minX],
    [dx, r.maxX - a[0]],
    [-dy, a[1] - r.minY],
    [dy, r.maxY - a[1]],
  ];
  for (const [p, q] of clips) {
    if (p === 0) {
      if (q < 0) return false;
    } else if (p < 0) {
      t0 = Math.max(t0, q / p);
    } else {
      t1 = Math.min(t1, q / p);
    }
    if (t0 > t1) return false;
  }
  return true;
}

function distToRect([px, py]: Pt, r: Aabb): number {
  const dx = Math.max(r.minX - px, 0, px - r.maxX);
  const dy = Math.max(r.minY - py, 0, py - r.maxY);
  return Math.hypot(dx, dy);
}

const rectCorners = (r: Aabb): Pt[] => [
  [r.minX, r.minY],
  [r.maxX, r.minY],
  [r.maxX, r.maxY],
  [r.minX, r.maxY],
];

/** A closed outline (any winding, convex or not) against a rectangle: an edge touches it, or it holds the rectangle. */
function polygonHitsRect(pts: readonly Pt[], r: Aabb): boolean {
  if (!rectsOverlap(boundsOf(pts), r)) return false;
  for (let i = 0; i < pts.length; i++) {
    if (segmentHitsRect(pts[i]!, pts[(i + 1) % pts.length]!, r)) return true;
  }
  return insidePolygon([(r.minX + r.maxX) / 2, (r.minY + r.maxY) / 2], pts);
}

/** Whether `s` touches the world rectangle `rect` at all; edges count. */
export function intersectsRect(s: ShapeObj, rect: Aabb): boolean {
  switch (s.type) {
    case "box":
      return s.rotDeg % 360 === 0
        ? rectsOverlap(aabb(s), rect)
        : polygonHitsRect(boxCorners(s), rect);
    case "circle":
      return distToRect([s.cx, s.cy], rect) <= s.r;
    case "capsule": {
      const [a, b] = capsuleEnds(s);
      if (segmentHitsRect(a, b, rect)) return true;
      const gap = Math.min(
        distToRect(a, rect),
        distToRect(b, rect),
        ...rectCorners(rect).map((c) => distToSegment(c, a, b)),
      );
      return gap <= s.r;
    }
    case "poly":
      return polygonHitsRect(s.pts, rect);
    case "chain":
      return s.pts.slice(1).some((b, i) => segmentHitsRect(s.pts[i]!, b, rect));
  }
}

/** Whether all of `s` lies inside `rect`; edges count, give or take rotation's rounding noise. */
export function containedInRect(s: ShapeObj, rect: Aabb): boolean {
  const b = aabb(s);
  const e = 1e-9;
  return (
    b.minX >= rect.minX - e &&
    b.maxX <= rect.maxX + e &&
    b.minY >= rect.minY - e &&
    b.maxY <= rect.maxY + e
  );
}

/** The corners a shape has: a box's four, a poly's or chain's points; none for circles and capsules. */
export function shapeVertices(s: ShapeObj): Pt[] {
  switch (s.type) {
    case "box":
      return boxCorners(s);
    case "poly":
    case "chain":
      return s.pts.map(([x, y]) => [x, y] as Pt);
    default:
      return [];
  }
}

/** The poly or chain point nearest `p`; `null` for the other shapes. */
export function nearestVertex(s: ShapeObj, p: Pt): { index: number; at: Pt; dist: number } | null {
  if (s.type !== "poly" && s.type !== "chain") return null;
  let best: { index: number; at: Pt; dist: number } | null = null;
  for (const [index, [x, y]] of s.pts.entries()) {
    const dist = Math.hypot(p[0] - x, p[1] - y);
    if (!best || dist < best.dist) best = { index, at: [x, y], dist };
  }
  return best;
}

/**
 * The poly or chain segment nearest `p`: segment `index` runs from point
 * `index` to the next, and a poly's last segment closes back to point 0.
 * `null` for the other shapes.
 */
export function nearestSegment(
  s: ShapeObj,
  p: Pt,
): { index: number; at: Pt; t: number; dist: number } | null {
  if (s.type !== "poly" && s.type !== "chain") return null;
  const n = s.type === "poly" ? s.pts.length : s.pts.length - 1;
  let best: { index: number; at: Pt; t: number; dist: number } | null = null;
  for (let index = 0; index < n; index++) {
    const hit = closestOnSegment(p, s.pts[index]!, s.pts[(index + 1) % s.pts.length]!);
    if (!best || hit.dist < best.dist) best = { index, ...hit };
  }
  return best;
}

/**
 * `s` turned `deg` degrees clockwise on screen about `about`, its `rotDeg`
 * kept in [0, 360). Quarter turns are exact; other angles leave fractions
 * for the caller to round.
 */
export function rotateShape(s: ShapeObj, about: Pt, deg: number): ShapeObj {
  const turn = ([x, y]: Pt): Pt => {
    const [rx, ry] = rotate([x - about[0], y - about[1]], deg);
    return [about[0] + rx, about[1] + ry];
  };
  switch (s.type) {
    case "poly":
    case "chain":
      return { type: s.type, pts: s.pts.map(turn) };
    case "circle": {
      const [cx, cy] = turn([s.cx, s.cy]);
      return { ...s, cx, cy };
    }
    default: {
      const [cx, cy] = turn([s.cx, s.cy]);
      return { ...s, cx, cy, rotDeg: normDeg(s.rotDeg + deg) };
    }
  }
}

/** The standable top of a shape as `[x0, x1, y]`, from its bounding box. */
export function topSpan(s: ShapeObj): [x0: number, x1: number, y: number] {
  const b = aabb(s);
  return [b.minX, b.maxX, b.minY];
}

// ─── Exact queries ───────────────────────────────────────
// Only + − × ÷ and Math.sqrt from here on, so every JS engine gives the same
// bits; the one exception is a turn that isn't a quarter turn (shapeAtPose,
// or a box's or capsule's own rotDeg), which needs cos and sin.

/** A convex piece of a shape: a point, a segment or a convex polygon, grown by `r`. */
type Core = { pts: Pt[]; r: number };

const samePt = (a: Pt, b: Pt) => a[0] === b[0] && a[1] === b[1];
const dist2 = (a: Pt, b: Pt) => (a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]);

/** `pts` without repeated points, consecutive or closing. */
function distinct(pts: readonly Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) if (out.length === 0 || !samePt(out[out.length - 1]!, p)) out.push(p);
  while (out.length > 1 && samePt(out[0]!, out[out.length - 1]!)) out.pop();
  return out;
}

function coresOf(s: ShapeObj): Core[] {
  switch (s.type) {
    case "box":
      return [{ pts: distinct(convexHull(boxCorners(s))), r: 0 }];
    case "circle":
      return [{ pts: [[s.cx, s.cy]], r: s.r }];
    case "capsule":
      return [{ pts: distinct(capsuleEnds(s)), r: s.r }];
    case "poly": {
      const hull = distinct(convexHull(s.pts));
      return hull.length > 0 ? [{ pts: hull, r: 0 }] : [];
    }
    case "chain":
      if (s.pts.length === 1) return [{ pts: [s.pts[0]!], r: 0 }];
      return s.pts.slice(1).map((b, i) => ({ pts: distinct([s.pts[i]!, b]), r: 0 }));
  }
}

/** A core's outline as segments: a point is one zero-length segment. */
function edgesOf(pts: readonly Pt[]): [Pt, Pt][] {
  if (pts.length === 1) return [[pts[0]!, pts[0]!]];
  if (pts.length === 2) return [[pts[0]!, pts[1]!]];
  return pts.map((a, i) => [a, pts[(i + 1) % pts.length]!]);
}

/** Candidate separating axes: edge normals, and a segment's own direction for collinear pairs. */
function axesOf(pts: readonly Pt[]): Pt[] {
  if (pts.length < 2) return [];
  if (pts.length === 2) {
    const dx = pts[1]![0] - pts[0]![0];
    const dy = pts[1]![1] - pts[0]![1];
    return [
      [0 - dy, dx],
      [dx, dy],
    ];
  }
  return edgesOf(pts).map(([a, b]): Pt => [a[1] - b[1], b[0] - a[0]]);
}

function spanOn(pts: readonly Pt[], [ax, ay]: Pt): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const [x, y] of pts) {
    const d = x * ax + y * ay;
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return [min, max];
}

/** Whether two cores' convex hulls share a point (radii aside); touching counts. */
function coresOverlap(a: readonly Pt[], b: readonly Pt[]): boolean {
  const axes = [...axesOf(a), ...axesOf(b)];
  if (axes.length === 0) return samePt(a[0]!, b[0]!);
  for (const axis of axes) {
    const [minA, maxA] = spanOn(a, axis);
    const [minB, maxB] = spanOn(b, axis);
    if (maxA < minB || maxB < minA) return false;
  }
  return true;
}

/** The point of segment `a`→`b` nearest `p`, and whether it lies strictly between the ends. */
function onSegment(p: Pt, a: Pt, b: Pt): { at: Pt; inner: boolean } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return { at: [a[0], a[1]], inner: false };
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  if (t <= 0) return { at: [a[0], a[1]], inner: false };
  if (t >= 1) return { at: [b[0], b[1]], inner: false };
  return { at: [a[0] + t * dx, a[1] + t * dy], inner: true };
}

/** The point of segment `a`→`b` nearest `p`, with no square root. */
export const nearestOnSegment = (p: Pt, a: Pt, b: Pt): Pt => onSegment(p, a, b).at;

type Pair = {
  d2: number;
  /** On `a`. */
  pa: Pt;
  /** On `b`. */
  pb: Pt;
  /** The edge's perpendicular when the nearest point is inside an edge, so a flat face gives an exact normal. */
  across?: Pt;
};

/** The nearest points of two disjoint cores' outlines. */
function nearestPair(a: readonly Pt[], b: readonly Pt[]): Pair {
  let best: Pair = { d2: Infinity, pa: a[0]!, pb: b[0]! };
  const visit = (p: Pt, edges: [Pt, Pt][], pOnA: boolean) => {
    for (const [u, v] of edges) {
      const { at, inner } = onSegment(p, u, v);
      const d2 = dist2(p, at);
      if (d2 >= best.d2) continue;
      best = pOnA ? { d2, pa: p, pb: at } : { d2, pa: at, pb: p };
      if (inner) best.across = [u[1] - v[1], v[0] - u[0]];
    }
  };
  for (const p of a) visit(p, edgesOf(b), true);
  for (const p of b) visit(p, edgesOf(a), false);
  return best;
}

function coresTouch(a: Core, b: Core): boolean {
  if (coresOverlap(a.pts, b.pts)) return true;
  const r = a.r + b.r;
  return r > 0 && nearestPair(a.pts, b.pts).d2 <= r * r;
}

/** Exact overlap test (SAT for box, poly, capsule, circle; chains as segments); touching counts. */
export function shapesIntersect(a: ShapeObj, b: ShapeObj): boolean {
  if (!rectsOverlap(aabb(a), aabb(b))) return false;
  const coresB = coresOf(b);
  return coresOf(a).some((ca) => coresB.some((cb) => coresTouch(ca, cb)));
}

const RAD_TO_DEG = 180 / Math.PI;

/** `local` moved to a pose: translated by (x, y) and turned by `rot` radians about it. */
export function shapeAtPose(
  local: ShapeObj,
  pose: { x: number; y: number; rot: number },
): ShapeObj {
  const { x, y, rot } = pose;
  const move = (p: Pt): Pt => {
    const [px, py] = turnBy(p, rot);
    return [px + x, py + y];
  };
  switch (local.type) {
    case "poly":
    case "chain":
      return { type: local.type, pts: local.pts.map(move) };
    case "circle": {
      const [cx, cy] = move([local.cx, local.cy]);
      return { ...local, cx, cy };
    }
    default: {
      const [cx, cy] = move([local.cx, local.cy]);
      const q = quarterTurns(rot);
      const turn = q === null ? rot * RAD_TO_DEG : q * 90;
      return { ...local, cx, cy, rotDeg: normDeg(local.rotDeg + turn) };
    }
  }
}

type RayHit = { t: number; normal: Pt };

const NO_NORMAL: Pt = [0, 0];

function unit([x, y]: Pt): Pt {
  const len = Math.sqrt(x * x + y * y);
  return len === 0 ? [0, 0] : [x / len + 0, y / len + 0];
}

/** A ray from `from` along the unit `d` into a convex polygon (Cyrus–Beck); inside is a hit at 0 with no normal. */
function rayPolygon(pts: readonly Pt[], from: Pt, d: Pt): RayHit | null {
  const sign = signedArea(pts) > 0 ? 1 : -1;
  let tIn = -Infinity;
  let tOut = Infinity;
  let nIn: Pt | null = null;
  for (const [a, b] of edgesOf(pts)) {
    const n: Pt = [sign * (b[1] - a[1]), sign * (a[0] - b[0])];
    const num = (a[0] - from[0]) * n[0] + (a[1] - from[1]) * n[1];
    const den = d[0] * n[0] + d[1] * n[1];
    if (den === 0) {
      if (num < 0) return null;
    } else if (den < 0) {
      const t = num / den;
      if (t > tIn) {
        tIn = t;
        nIn = n;
      }
    } else {
      const t = num / den;
      if (t < tOut) tOut = t;
    }
    if (tIn > tOut) return null;
  }
  if (tOut < 0) return null;
  if (tIn < 0 || !nIn) return { t: 0, normal: NO_NORMAL };
  return { t: tIn, normal: unit(nIn) };
}

/** A ray against a segment, either side; the normal faces the ray. */
function raySegment(a: Pt, b: Pt, from: Pt, d: Pt): RayHit | null {
  const ex = b[0] - a[0];
  const ey = b[1] - a[1];
  const den = d[0] * ey - d[1] * ex;
  if (den === 0) return null;
  const wx = a[0] - from[0];
  const wy = a[1] - from[1];
  const t = (wx * ey - wy * ex) / den;
  const u = (wx * d[1] - wy * d[0]) / den;
  if (t < 0 || u < 0 || u > 1) return null;
  const n = unit([ey, 0 - ex]);
  const facing = n[0] * d[0] + n[1] * d[1] > 0 ? ([0 - n[0], 0 - n[1]] as Pt) : n;
  return { t, normal: facing };
}

function rayCircle(c: Pt, r: number, from: Pt, d: Pt): RayHit | null {
  const mx = from[0] - c[0];
  const my = from[1] - c[1];
  const b = mx * d[0] + my * d[1];
  const cc = mx * mx + my * my - r * r;
  if (cc < 0) return { t: 0, normal: NO_NORMAL };
  const disc = b * b - cc;
  if (disc < 0) return null;
  const t = 0 - b - Math.sqrt(disc);
  if (t < 0) return null;
  return { t, normal: [(mx + t * d[0]) / r + 0, (my + t * d[1]) / r + 0] };
}

function rayCapsule(a: Pt, b: Pt, r: number, from: Pt, d: Pt): RayHit | null {
  if (dist2(from, nearestOnSegment(from, a, b)) < r * r) return { t: 0, normal: NO_NORMAL };
  const [nx, ny] = unit([a[1] - b[1], b[0] - a[0]]);
  const ox = nx * r;
  const oy = ny * r;
  const side: Pt[] = [
    [a[0] + ox, a[1] + oy],
    [b[0] + ox, b[1] + oy],
    [b[0] - ox, b[1] - oy],
    [a[0] - ox, a[1] - oy],
  ];
  return nearest([rayCircle(a, r, from, d), rayCircle(b, r, from, d), rayPolygon(side, from, d)]);
}

function nearest(hits: readonly (RayHit | null)[]): RayHit | null {
  let best: RayHit | null = null;
  for (const h of hits) if (h && (!best || h.t < best.t)) best = h;
  return best;
}

function rayCore({ pts, r }: Core, from: Pt, d: Pt): RayHit | null {
  if (pts.length >= 3) return rayPolygon(pts, from, d);
  if (pts.length === 2)
    return r > 0 ? rayCapsule(pts[0]!, pts[1]!, r, from, d) : raySegment(pts[0]!, pts[1]!, from, d);
  return r > 0 ? rayCircle(pts[0]!, r, from, d) : null;
}

/**
 * The first hit of a ray on a shape: time of impact as a fraction of `maxDist`, and the surface normal.
 * `dir` needn't be a unit vector; a ray starting inside a solid shape hits at 0 with normal [0, 0].
 */
export function raycastShape(
  s: ShapeObj,
  from: Pt,
  dir: Pt,
  maxDist: number,
): { toi: number; normal: Pt } | null {
  if (!(maxDist >= 0)) return null;
  const d = unit(dir);
  if (d[0] === 0 && d[1] === 0) return null;
  const hit = nearest(coresOf(s).map((core) => rayCore(core, from, d)));
  if (!hit || hit.t > maxDist) return null;
  return { toi: maxDist === 0 ? 0 : hit.t / maxDist, normal: hit.normal };
}

/** The point of `s` nearest `p`: `p` itself when inside (a chain has no inside). */
export function nearestPointOnShape(s: ShapeObj, p: Pt): Pt {
  let best: { gap: number; at: Pt } | null = null;
  for (const core of coresOf(s)) {
    if (core.pts.length >= 3 && coresOverlap(core.pts, [p])) return [p[0], p[1]];
    let q: Pt = core.pts[0]!;
    let d2 = Infinity;
    for (const [u, v] of edgesOf(core.pts)) {
      const c = nearestOnSegment(p, u, v);
      const e = dist2(p, c);
      if (e < d2) {
        d2 = e;
        q = c;
      }
    }
    const dist = Math.sqrt(d2);
    if (dist <= core.r) return [p[0], p[1]];
    const gap = dist - core.r;
    if (best && gap >= best.gap) continue;
    const k = core.r / dist;
    best = { gap, at: [q[0] + (p[0] - q[0]) * k, q[1] + (p[1] - q[1]) * k] };
  }
  return best ? best.at : [p[0], p[1]];
}

/**
 * For cores whose hulls overlap: the axis of least penetration, as a unit
 * normal pointing from `b` toward `a`, and how deep they overlap along it.
 */
function leastPenetration(a: Core, b: Core): { depth: number; normal: Pt } {
  const mean = (pts: readonly Pt[]): Pt => {
    let x = 0;
    let y = 0;
    for (const p of pts) {
      x += p[0];
      y += p[1];
    }
    return [x / pts.length, y / pts.length];
  };
  const ca = mean(a.pts);
  const cb = mean(b.pts);
  const axes = [...axesOf(a.pts), ...axesOf(b.pts), [ca[0] - cb[0], ca[1] - cb[1]] as Pt];
  let best: { depth: number; normal: Pt } | null = null;
  for (const raw of axes) {
    const axis = unit(raw);
    if (axis[0] === 0 && axis[1] === 0) continue;
    const [minA, maxA] = spanOn(a.pts, axis);
    const [minB, maxB] = spanOn(b.pts, axis);
    const below = maxA + a.r - (minB - b.r);
    const above = maxB + b.r - (minA - a.r);
    const depth = below < above ? below : above;
    if (best && depth >= best.depth) continue;
    best = { depth, normal: below < above ? [0 - axis[0], 0 - axis[1]] : axis };
  }
  return best ?? { depth: 0, normal: [0, 0] };
}

/** The point of `core` furthest against `normal`: how deep it reaches into what `normal` faces out of. */
function support(core: Core, normal: Pt): Pt {
  let at = core.pts[0]!;
  let least = Infinity;
  for (const p of core.pts) {
    const d = p[0] * normal[0] + p[1] * normal[1];
    if (d < least) {
      least = d;
      at = p;
    }
  }
  return [at[0] - normal[0] * core.r, at[1] - normal[1] * core.r];
}

/** Bisection steps for a sweep: the time of impact is found to 1/1024 of the motion. */
const SWEEP_STEPS = 10;

function sweptCore(core: Core, dx: number, dy: number): Core {
  const moved = core.pts.map(([x, y]): Pt => [x + dx, y + dy]);
  return { pts: distinct(convexHull([...core.pts, ...moved])), r: core.r };
}

/**
 * When `shape`, moved by `by`, first touches `target`: `toi` the fraction of
 * `by` it travels free, found by bisection to 1/1024 (0 when it touches at
 * the start); `normal` the unit normal at `target` facing it there, along
 * the axis separating them (the axis of least penetration when they
 * already overlap); `at`
 * the nearest point of `target`, to the deepest point of `shape` when
 * they overlap. Null when it never touches or `by` is zero.
 */
export function sweepShape(
  shape: ShapeObj,
  by: Pt,
  target: ShapeObj,
): { toi: number; normal: Pt; at: Pt } | null {
  if (by[0] === 0 && by[1] === 0) return null;
  const end = translateShape(shape, by);
  if (!rectsOverlap(aabbUnion(aabb(shape), aabb(end)), aabb(target))) return null;
  const moving = coresOf(shape);
  const targets = coresOf(target);
  const touchesWithin = (t: number) =>
    moving.some((core) => {
      const swept = sweptCore(core, by[0] * t, by[1] * t);
      return targets.some((c) => coresTouch(swept, c));
    });
  if (!touchesWithin(1)) return null;
  let toi = 0;
  if (!touchesWithin(0)) {
    let hi = 1;
    for (let i = 0; i < SWEEP_STEPS; i++) {
      const mid = (toi + hi) / 2;
      if (touchesWithin(mid)) hi = mid;
      else toi = mid;
    }
  }
  const dx = by[0] * toi;
  const dy = by[1] * toi;
  let best: (Pair & { gap: number; rb: number }) | null = null;
  let deepest: { depth: number; normal: Pt; core: Core } | null = null;
  for (const core of moving) {
    const pts = core.pts.map(([x, y]): Pt => [x + dx, y + dy]);
    for (const c of targets) {
      if (coresOverlap(pts, c.pts)) {
        const pen = leastPenetration({ pts, r: core.r }, c);
        if (!deepest || pen.depth > deepest.depth) deepest = { ...pen, core: { pts, r: core.r } };
        continue;
      }
      const pair = nearestPair(pts, c.pts);
      const gap = Math.sqrt(pair.d2) - core.r - c.r;
      if (!best || gap < best.gap) best = { ...pair, gap, rb: c.r };
    }
  }
  if (deepest && (deepest.normal[0] !== 0 || deepest.normal[1] !== 0)) {
    const deep = support(deepest.core, deepest.normal);
    return { toi, normal: deepest.normal, at: nearestPointOnShape(target, deep) };
  }
  if (deepest || !best || samePt(best.pa, best.pb)) {
    const centre = shapeCentre(translateShape(shape, [dx, dy])).at;
    const [ux, uy] = unit(by);
    return { toi, normal: [0 - ux, 0 - uy], at: nearestPointOnShape(target, centre) };
  }
  const away: Pt = [best.pa[0] - best.pb[0], best.pa[1] - best.pb[1]];
  let normal = unit(away);
  if (best.across) {
    const n = unit(best.across);
    normal = n[0] * away[0] + n[1] * away[1] < 0 ? [0 - n[0], 0 - n[1]] : n;
  }
  return {
    toi,
    normal,
    at: [best.pb[0] + normal[0] * best.rb, best.pb[1] + normal[1] * best.rb],
  };
}

// Polygon predicates for walk areas and holes. Every test is a sign of a cross
// product, so integer points give exact answers.

/** Twice the signed area of triangle `o`, `a`, `b`: positive when `b` is left of `o`→`a` (y-up). */
export const cross3 = (o: Pt, a: Pt, b: Pt): number =>
  (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** Whether `p`, already collinear with `a`→`b`, lies on the closed segment. */
const withinSegment = (p: Pt, a: Pt, b: Pt): boolean =>
  Math.min(a[0], b[0]) <= p[0] &&
  p[0] <= Math.max(a[0], b[0]) &&
  Math.min(a[1], b[1]) <= p[1] &&
  p[1] <= Math.max(a[1], b[1]);

/** Whether closed segments `a`→`b` and `c`→`d` share a point; touching counts. */
export function segmentsMeet(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const d1 = Math.sign(cross3(a, b, c));
  const d2 = Math.sign(cross3(a, b, d));
  const d3 = Math.sign(cross3(c, d, a));
  const d4 = Math.sign(cross3(c, d, b));
  if (d1 * d2 < 0 && d3 * d4 < 0) return true;
  return (
    (d1 === 0 && withinSegment(c, a, b)) ||
    (d2 === 0 && withinSegment(d, a, b)) ||
    (d3 === 0 && withinSegment(a, c, d)) ||
    (d4 === 0 && withinSegment(b, c, d))
  );
}

/** Where `p` lies against a closed polygon (winding number): 1 inside, 0 on its outline, -1 outside. */
export function polygonSide(p: Pt, pts: readonly Pt[]): 1 | 0 | -1 {
  let winding = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    const c = cross3(a, b, p);
    if (c === 0 && withinSegment(p, a, b)) return 0;
    if (a[1] <= p[1]) {
      if (b[1] > p[1] && c > 0) winding++;
    } else if (b[1] <= p[1] && c < 0) winding--;
  }
  return winding === 0 ? -1 : 1;
}

/**
 * True for a simple polygon, concave allowed: three or more finite points,
 * non-zero area, no repeated point and no two edges meeting except
 * neighbours at their shared corner. Collinear corners are allowed.
 */
export function isSimplePolygon(pts: readonly Pt[]): boolean {
  const n = pts.length;
  if (n < 3 || pts.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y))) return false;
  if (signedArea(pts) === 0) return false;
  for (let i = 0; i < n; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    const c = pts[(i + 2) % n]!;
    if (samePt(a, b)) return false;
    // Neighbouring edges that double back over each other.
    if (cross3(a, b, c) === 0 && (a[0] - b[0]) * (c[0] - b[0]) + (a[1] - b[1]) * (c[1] - b[1]) > 0)
      return false;
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segmentsMeet(pts[i]!, pts[i + 1]!, pts[j]!, pts[(j + 1) % n]!)) return false;
    }
  }
  return true;
}

function outlinesMeet(a: readonly Pt[], b: readonly Pt[]): boolean {
  for (let i = 0; i < a.length; i++) {
    const a0 = a[i]!;
    const a1 = a[(i + 1) % a.length]!;
    for (let j = 0; j < b.length; j++) {
      if (segmentsMeet(a0, a1, b[j]!, b[(j + 1) % b.length]!)) return true;
    }
  }
  return false;
}

/** Whether simple polygon `inner` lies strictly inside simple polygon `outer`, outlines not touching. */
export function polygonInside(inner: readonly Pt[], outer: readonly Pt[]): boolean {
  if (inner.length === 0 || outer.length === 0 || outlinesMeet(inner, outer)) return false;
  return polygonSide(inner[0]!, outer) === 1;
}

/** Whether two simple polygons share no point at all: outlines apart and neither inside the other. */
export function polygonsDisjoint(a: readonly Pt[], b: readonly Pt[]): boolean {
  if (a.length === 0 || b.length === 0) return true;
  if (outlinesMeet(a, b)) return false;
  return polygonSide(a[0]!, b) === -1 && polygonSide(b[0]!, a) === -1;
}

/**
 * How `a`'s outline sits against `b`: whether some stretch of it runs
 * strictly inside `b`, and whether all of it lies on `b`'s outline. Each edge
 * is cut where it meets `b`, and each piece is judged by its midpoint.
 */
function outlineAgainst(a: readonly Pt[], b: readonly Pt[]): { inside: boolean; allOn: boolean } {
  let allOn = true;
  for (let i = 0; i < a.length; i++) {
    const a0 = a[i]!;
    const a1 = a[(i + 1) % a.length]!;
    const dx = a1[0] - a0[0];
    const dy = a1[1] - a0[1];
    const len2 = dx * dx + dy * dy;
    const cuts: { t: number; at: Pt }[] = [
      { t: 0, at: a0 },
      { t: 1, at: a1 },
    ];
    for (let j = 0; j < b.length; j++) {
      const b0 = b[j]!;
      const b1 = b[(j + 1) % b.length]!;
      const s0 = cross3(a0, a1, b0);
      if (s0 === 0 && withinSegment(b0, a0, a1)) {
        cuts.push({ t: ((b0[0] - a0[0]) * dx + (b0[1] - a0[1]) * dy) / len2, at: b0 });
      }
      const s1 = cross3(a0, a1, b1);
      const r0 = cross3(b0, b1, a0);
      const r1 = cross3(b0, b1, a1);
      if (s0 * s1 < 0 && r0 * r1 < 0) {
        const t = r0 / (r0 - r1);
        cuts.push({ t, at: [a0[0] + t * dx, a0[1] + t * dy] });
      }
    }
    cuts.sort((p, q) => p.t - q.t);
    for (let k = 1; k < cuts.length; k++) {
      const p = cuts[k - 1]!.at;
      const q = cuts[k]!.at;
      if (samePt(p, q)) continue;
      const side = polygonSide([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], b);
      if (side === 1) return { inside: true, allOn: false };
      if (side === -1) allOn = false;
    }
  }
  return { inside: false, allOn };
}

/**
 * Whether two simple polygons' interiors overlap. Sharing an edge or a corner
 * doesn't count; one inside the other, or the same region twice, does.
 */
export function polygonsOverlap(a: readonly Pt[], b: readonly Pt[]): boolean {
  if (a.length < 3 || b.length < 3) return false;
  const ba = boundsOf(a);
  const bb = boundsOf(b);
  if (ba.maxX <= bb.minX || bb.maxX <= ba.minX || ba.maxY <= bb.minY || bb.maxY <= ba.minY)
    return false;
  const ab = outlineAgainst(a, b);
  if (ab.inside) return true;
  const ba2 = outlineAgainst(b, a);
  if (ba2.inside) return true;
  // Neither outline enters the other: the interiors meet only when the outlines coincide.
  return ab.allOn && ba2.allOn;
}

export type WalkPolygon = { id: string; pts: readonly Pt[] };

/** Something wrong with a set of walk areas and holes, naming the entities involved. */
export type WalkPolygonIssue = { entityIds: string[]; message: string };

/**
 * The rules walk areas and holes must keep, and which of them survive:
 * every polygon simple, no two walk areas' interiors overlapping, every hole
 * strictly inside exactly one walk area, and holes in an area apart from one
 * another. A polygon that breaks a rule is reported and dropped (of an
 * overlapping pair, the later one), so `areas` with their `holes` can be
 * triangulated as they stand.
 */
export function walkPolygonIssues(
  areas: readonly WalkPolygon[],
  holes: readonly WalkPolygon[],
): {
  issues: WalkPolygonIssue[];
  areas: { area: WalkPolygon; holes: WalkPolygon[] }[];
} {
  const issues: WalkPolygonIssue[] = [];
  const kept: { area: WalkPolygon; holes: WalkPolygon[] }[] = [];
  for (const area of areas) {
    if (!isSimplePolygon(area.pts)) {
      issues.push({
        entityIds: [area.id],
        message: `walk area "${area.id}" is not a simple polygon (it crosses itself, repeats a point or has no area)`,
      });
      continue;
    }
    const other = kept.find((k) => polygonsOverlap(k.area.pts, area.pts));
    if (other) {
      issues.push({
        entityIds: [other.area.id, area.id],
        message: `walk areas "${other.area.id}" and "${area.id}" overlap; inset one so they only share edges`,
      });
      continue;
    }
    kept.push({ area, holes: [] });
  }
  for (const hole of holes) {
    if (!isSimplePolygon(hole.pts)) {
      issues.push({
        entityIds: [hole.id],
        message: `hole "${hole.id}" is not a simple polygon (it crosses itself, repeats a point or has no area)`,
      });
      continue;
    }
    const within = kept.filter((k) => polygonInside(hole.pts, k.area.pts));
    if (within.length !== 1) {
      issues.push({
        entityIds: [hole.id],
        message:
          within.length === 0
            ? `hole "${hole.id}" is not strictly inside a walk area`
            : `hole "${hole.id}" is inside more than one walk area`,
      });
      continue;
    }
    const home = within[0]!;
    const clash = home.holes.find((h) => !polygonsDisjoint(h.pts, hole.pts));
    if (clash) {
      issues.push({
        entityIds: [clash.id, hole.id],
        message: `holes "${clash.id}" and "${hole.id}" touch or overlap; merge them into one polygon`,
      });
      continue;
    }
    home.holes.push(hole);
  }
  return { issues, areas: kept };
}
