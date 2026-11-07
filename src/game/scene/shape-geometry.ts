import type { Aabb, Pt, ShapeObj } from "./types";

const DEG = Math.PI / 180;

function rotate([x, y]: Pt, rad: number): Pt {
  if (rad === 0) return [x, y];
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
  const [dx, dy] = rotate([0, s.halfLen], (s.rotDeg % 360) * DEG);
  return [
    [s.cx - dx, s.cy - dy],
    [s.cx + dx, s.cy + dy],
  ];
}

export function boxCorners(s: Extract<ShapeObj, { type: "box" }>): Pt[] {
  const rad = (s.rotDeg % 360) * DEG;
  const local: Pt[] = [
    [-s.hw, -s.hh],
    [s.hw, -s.hh],
    [s.hw, s.hh],
    [-s.hw, s.hh],
  ];
  return local.map((p) => {
    const [x, y] = rotate(p, rad);
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
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
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
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
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
    const [ax, ay] = pts[i];
    const [bx, by] = pts[(i + 1) % n];
    const [cx, cy] = pts[(i + 2) % n];
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

function distToSegment([px, py]: Pt, [ax, ay]: Pt, [bx, by]: Pt): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function insidePolygon([px, py]: Pt, pts: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Whether `p` is inside `s`, or within `tol` px of it. A chain has no inside. */
export function containsPoint(s: ShapeObj, p: Pt, tol = 0): boolean {
  switch (s.type) {
    case "box": {
      const [lx, ly] = rotate([p[0] - s.cx, p[1] - s.cy], -(s.rotDeg % 360) * DEG);
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
        tol > 0 && s.pts.some((a, i) => distToSegment(p, a, s.pts[(i + 1) % s.pts.length]) <= tol)
      );
    case "chain":
      return s.pts.slice(1).some((b, i) => distToSegment(p, s.pts[i], b) <= tol);
  }
}

/** The standable top of a shape as `[x0, x1, y]`, from its bounding box. */
export function topSpan(s: ShapeObj): [x0: number, x1: number, y: number] {
  const b = aabb(s);
  return [b.minX, b.maxX, b.minY];
}
