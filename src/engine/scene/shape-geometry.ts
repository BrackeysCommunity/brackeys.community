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
  const rad = deg * DEG;
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

export function aabbUnion(a: Aabb, b: Aabb): Aabb {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
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

const rectsOverlap = (a: Aabb, b: Aabb) =>
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
