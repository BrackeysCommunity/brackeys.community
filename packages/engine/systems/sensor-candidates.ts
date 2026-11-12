import type { Collider, Shape } from "@dimforge/rapier2d";

/** Slack on every bound, in metres: Rapier holds positions as 32-bit floats. */
const MARGIN = 0.01;
const MIN_CELL = 0.25;
/** A circle wider than this many cells is kept beside the grid instead of in it. */
const WIDE_CELLS = 4;

/**
 * Circles by index, and for a query circle the indices of every circle that
 * could touch it, ascending. Conservative: it may name a circle that
 * doesn't touch, never miss one that does. A radius of `Infinity` is a
 * circle that touches everything.
 */
export type CircleGrid = {
  near(x: number, y: number, r: number): number[];
};

/**
 * A dense grid over the circles' bounds, its cells about twice the mean
 * radius (coarser when that would make more than a few cells per circle),
 * held in flat arrays: each cell's circles in ascending order, counted then
 * filled.
 */
export function createCircleGrid(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  rs: ArrayLike<number>,
  count: number,
): CircleGrid {
  let sum = 0;
  let finite = 0;
  for (let i = 0; i < count; i++) {
    const r = rs[i]!;
    if (Number.isFinite(r)) {
      sum += r;
      finite++;
    }
  }
  let cell = Math.max(MIN_CELL, finite > 0 ? (2 * sum) / finite : MIN_CELL);
  const wide: number[] = [];
  const narrow = new Uint8Array(count);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < count; i++) {
    const r = rs[i]!;
    const x = xs[i]!;
    const y = ys[i]!;
    if (!(r <= WIDE_CELLS * cell) || !Number.isFinite(x) || !Number.isFinite(y)) {
      wide.push(i);
      continue;
    }
    narrow[i] = 1;
    minX = Math.min(minX, x - r);
    minY = Math.min(minY, y - r);
    maxX = Math.max(maxX, x + r);
    maxY = Math.max(maxY, y + r);
  }
  const limit = 4 * count + 64;
  let cols = 0;
  let rows = 0;
  if (minX <= maxX) {
    for (;;) {
      cols = Math.floor((maxX - minX) / cell) + 1;
      rows = Math.floor((maxY - minY) / cell) + 1;
      if (cols * rows <= limit) break;
      cell *= Math.max(1.25, Math.sqrt((cols * rows) / limit));
    }
  }
  const colOf = (x: number) => Math.min(cols - 1, Math.max(0, Math.floor((x - minX) / cell)));
  const rowOf = (y: number) => Math.min(rows - 1, Math.max(0, Math.floor((y - minY) / cell)));

  const start = new Int32Array(cols * rows + 1);
  let items = new Int32Array(0);
  let fill = start;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < count; i++) {
      if (!narrow[i]) continue;
      const r = rs[i]!;
      const x0 = colOf(xs[i]! - r);
      const x1 = colOf(xs[i]! + r);
      const y0 = rowOf(ys[i]! - r);
      const y1 = rowOf(ys[i]! + r);
      for (let cy = y0; cy <= y1; cy++) {
        for (let cx = x0; cx <= x1; cx++) {
          if (pass === 0) start[cy * cols + cx + 1]!++;
          else items[fill[cy * cols + cx]!++] = i;
        }
      }
    }
    if (pass === 0) {
      for (let c = 1; c < start.length; c++) start[c]! += start[c - 1]!;
      items = new Int32Array(start[start.length - 1]!);
      fill = start.slice(0, -1);
    }
  }

  const seen = new Uint32Array(count);
  let stamp = 0;

  const touches = (i: number, x: number, y: number, r: number) => {
    const reach = r + rs[i]! + MARGIN;
    if (reach === Infinity) return true;
    const dx = xs[i]! - x;
    const dy = ys[i]! - y;
    return dx * dx + dy * dy <= reach * reach;
  };

  function all(x: number, y: number, r: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < count; i++) if (touches(i, x, y, r)) out.push(i);
    return out;
  }

  return {
    near(x, y, r) {
      const reach = r + MARGIN;
      const out: number[] = [];
      if (
        cols > 0 &&
        x + reach >= minX &&
        x - reach <= maxX &&
        y + reach >= minY &&
        y - reach <= maxY
      ) {
        const x0 = colOf(x - reach);
        const x1 = colOf(x + reach);
        const y0 = rowOf(y - reach);
        const y1 = rowOf(y + reach);
        if (!((x1 - x0 + 1) * (y1 - y0 + 1) < count)) return all(x, y, r);
        stamp++;
        for (let cy = y0; cy <= y1; cy++) {
          for (let cx = x0; cx <= x1; cx++) {
            const c = cy * cols + cx;
            for (let k = start[c]!; k < start[c + 1]!; k++) {
              const i = items[k]!;
              if (seen[i] === stamp) continue;
              seen[i] = stamp;
              if (touches(i, x, y, r)) out.push(i);
            }
          }
        }
      } else if (!(reach < Infinity)) return all(x, y, r);
      for (const i of wide) if (touches(i, x, y, r)) out.push(i);
      return out.sort((a, b) => a - b);
    },
  };
}

const radii = new WeakMap<Shape, number>();

/**
 * The radius of a circle about the collider's own origin that holds its
 * shape at any rotation; `Infinity` for a shape whose size isn't read here.
 */
function boundingRadius(shape: Shape): number {
  const known = radii.get(shape);
  if (known !== undefined) return known;
  const s = shape as unknown as {
    radius?: unknown;
    halfHeight?: unknown;
    halfExtents?: { x: number; y: number };
    borderRadius?: unknown;
    vertices?: ArrayLike<number>;
  };
  const border = typeof s.borderRadius === "number" ? s.borderRadius : 0;
  let radius = Infinity;
  if (s.halfExtents) radius = Math.hypot(s.halfExtents.x, s.halfExtents.y) + border;
  else if (typeof s.radius === "number")
    radius = s.radius + (typeof s.halfHeight === "number" ? s.halfHeight : 0);
  else if (s.vertices) {
    let far = 0;
    for (let i = 0; i + 1 < s.vertices.length; i += 2) {
      far = Math.max(far, Math.hypot(s.vertices[i]!, s.vertices[i + 1]!));
    }
    radius = far + border;
  }
  if (!(radius >= 0)) radius = Infinity;
  radii.set(shape, radius);
  return radius;
}

/**
 * For the colliders where they stand now, the indices into `colliders` of
 * those each of `queriers` could be intersecting, ascending; a collider
 * that isn't a querier gets every index. A collider whose collision groups
 * can't meet any querier's is never one, so its position isn't read. The
 * test is looser than Rapier's, which needs both directions (a querier's
 * memberships in the collider's filter and the collider's in the
 * querier's): one is enough here, so no pair Rapier tests is left out.
 * Reads each position once, so it pays for itself only when many colliders
 * ask.
 */
export function colliderCandidates(
  colliders: readonly Collider[],
  queriers: readonly Collider[],
): (c: Collider) => number[] {
  let memberships = 0;
  let filters = 0;
  const asking = new Map<number, number>();
  const qx = new Float64Array(queriers.length);
  const qy = new Float64Array(queriers.length);
  const qr = new Float64Array(queriers.length);
  for (let k = 0; k < queriers.length; k++) {
    const q = queriers[k]!;
    const groups = q.collisionGroups();
    memberships |= groups >>> 16;
    filters |= groups & 0xffff;
    const t = q.translation();
    qx[k] = t.x;
    qy[k] = t.y;
    qr[k] = boundingRadius(q.shape);
    asking.set(q.handle, k);
  }
  const count = colliders.length;
  const xs = new Float64Array(count);
  const ys = new Float64Array(count);
  const rs = new Float64Array(count);
  /** Each grid circle's index into `colliders`, ascending. */
  const indices = new Int32Array(count);
  let n = 0;
  for (let i = 0; i < count; i++) {
    const collider = colliders[i]!;
    const groups = collider.collisionGroups();
    if (((groups >>> 16) & filters) === 0 && (groups & 0xffff & memberships) === 0) continue;
    const t = collider.translation();
    xs[n] = t.x;
    ys[n] = t.y;
    rs[n] = boundingRadius(collider.shape);
    indices[n++] = i;
  }
  const grid = createCircleGrid(xs, ys, rs, n);
  const everything = Array.from({ length: count }, (_, i) => i);
  return (collider) => {
    const k = asking.get(collider.handle);
    if (k === undefined) return everything;
    const near = grid.near(qx[k]!, qy[k]!, qr[k]!);
    for (let j = 0; j < near.length; j++) near[j] = indices[near[j]!]!;
    return near;
  };
}
