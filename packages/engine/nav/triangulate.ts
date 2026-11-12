import { cross3, segmentsMeet, signedArea } from "../scene/shape-geometry";
import type { Pt } from "../scene/types";

const same = (a: Pt, b: Pt) => a[0] === b[0] && a[1] === b[1];

/** Closed point-in-triangle for a triangle wound with positive area. */
const inTriangle = (p: Pt, a: Pt, b: Pt, c: Pt) =>
  cross3(a, b, p) >= 0 && cross3(b, c, p) >= 0 && cross3(c, a, p) >= 0;

/**
 * Whether direction `p`→`to` points strictly into the interior at `p`, a
 * corner between `prev` and `next` of a ring that keeps its inside on the left.
 */
function intoCorner(prev: Pt, p: Pt, next: Pt, to: Pt): boolean {
  const u: Pt = [next[0] - p[0], next[1] - p[1]];
  const w: Pt = [prev[0] - p[0], prev[1] - p[1]];
  const d: Pt = [to[0] - p[0], to[1] - p[1]];
  const cr = (a: Pt, b: Pt) => a[0] * b[1] - a[1] * b[0];
  if (cr(u, w) > 0) return cr(u, d) > 0 && cr(d, w) > 0;
  return !(cr(w, d) >= 0 && cr(d, u) >= 0);
}

const oriented = (pts: readonly Pt[], positive: boolean): Pt[] => {
  const copy = pts.map(([x, y]): Pt => [x, y]);
  return signedArea(copy) > 0 === positive ? copy : copy.reverse();
};

/** The hole's bridge corner: the greatest x, then the greatest y. */
function rightmost(pts: readonly Pt[]): number {
  let best = 0;
  for (let i = 1; i < pts.length; i++) {
    const [x, y] = pts[i]!;
    const [bx, by] = pts[best]!;
    if (x > bx || (x === bx && y > by)) best = i;
  }
  return best;
}

function edgesOf(ring: readonly Pt[]): [Pt, Pt][] {
  return ring.map((a, i) => [a, ring[(i + 1) % ring.length]!]);
}

/**
 * Splices `hole` (wound negative, starting at its bridge corner) into
 * `ring` through the nearest ring corner the bridge can reach without
 * touching any outline.
 */
function bridge(ring: Pt[], hole: Pt[], others: readonly Pt[][]): Pt[] {
  const m = hole[0]!;
  const holePrev = hole[hole.length - 1]!;
  const holeNext = hole[1]!;
  const blockers = [...edgesOf(ring), ...edgesOf(hole), ...others.flatMap(edgesOf)];
  const order = ring
    .map(([x, y], i) => ({ i, d2: (x - m[0]) * (x - m[0]) + (y - m[1]) * (y - m[1]) }))
    .sort((a, b) => a.d2 - b.d2 || a.i - b.i);
  for (const { i } of order) {
    const p = ring[i]!;
    const prev = ring[(i + ring.length - 1) % ring.length]!;
    const next = ring[(i + 1) % ring.length]!;
    if (!intoCorner(prev, p, next, m) || !intoCorner(holePrev, m, holeNext, p)) continue;
    const blocked = blockers.some(
      ([a, b]) =>
        !same(a, p) && !same(b, p) && !same(a, m) && !same(b, m) && segmentsMeet(m, p, a, b),
    );
    if (blocked) continue;
    return [...ring.slice(0, i + 1), ...hole, m, p, ...ring.slice(i + 1)];
  }
  return ring;
}

/**
 * Ear clipping of one simple ring with its holes bridged to it, so one
 * answer everywhere: holes are bridged in order of their rightmost corner
 * (greatest x, then greatest y; input order on a tie), each to the nearest
 * ring corner it can see. Triangles are wound with positive `signedArea`, and
 * every corner of the input, collinear ones included, is a triangle corner.
 * Expects a simple outer ring and holes strictly inside it and apart.
 */
export function triangulate(
  outer: readonly Pt[],
  holes: readonly (readonly Pt[])[],
): (readonly [Pt, Pt, Pt])[] {
  if (outer.length < 3) return [];
  let ring = oriented(outer, true);
  const pending = holes
    .filter((h) => h.length >= 3)
    .map((h) => {
      const pts = oriented(h, false);
      const r = rightmost(pts);
      return [...pts.slice(r), ...pts.slice(0, r)];
    })
    .map((pts, order) => ({ pts, order }))
    .sort(
      (a, b) => b.pts[0]![0] - a.pts[0]![0] || b.pts[0]![1] - a.pts[0]![1] || a.order - b.order,
    );
  for (let k = 0; k < pending.length; k++) {
    ring = bridge(
      ring,
      pending[k]!.pts,
      pending.slice(k + 1).map((h) => h.pts),
    );
  }
  return clipEars(ring);
}

function clipEars(ring: readonly Pt[]): (readonly [Pt, Pt, Pt])[] {
  const n = ring.length;
  const prev = Array.from({ length: n }, (_, i) => (i + n - 1) % n);
  const next = Array.from({ length: n }, (_, i) => (i + 1) % n);
  const alive = Array.from({ length: n }, () => true);
  const out: (readonly [Pt, Pt, Pt])[] = [];
  const unlink = (i: number) => {
    next[prev[i]!] = next[i]!;
    prev[next[i]!] = prev[i]!;
    alive[i] = false;
  };

  const isEar = (ia: number, ib: number, ic: number): boolean => {
    const a = ring[ia]!;
    const b = ring[ib]!;
    const c = ring[ic]!;
    if (cross3(a, b, c) <= 0) return false;
    if (!intoCorner(ring[prev[ia]!]!, a, b, c)) return false;
    if (!intoCorner(b, c, ring[next[ic]!]!, a)) return false;
    for (let j = next[ic]!; j !== ia; j = next[j]!) {
      const p = ring[j]!;
      if (same(p, a) || same(p, b) || same(p, c)) continue;
      if (inTriangle(p, a, b, c)) return false;
      const q = ring[next[j]!]!;
      if (!same(q, a) && !same(q, c) && !same(p, a) && !same(p, c) && segmentsMeet(a, c, p, q))
        return false;
    }
    return true;
  };

  let remaining = n;
  let cur = 0;
  let stall = 0;
  while (remaining > 3) {
    const a = prev[cur]!;
    const c = next[cur]!;
    if (isEar(a, cur, c)) {
      out.push([ring[a]!, ring[cur]!, ring[c]!]);
      unlink(cur);
      remaining--;
      cur = c;
      stall = 0;
      continue;
    }
    cur = next[cur]!;
    if (++stall < remaining) continue;
    // No ear left: drop a corner with no area (a spike or a straight run) and go on.
    let flat = -1;
    for (let i = 0; i < n; i++) {
      if (alive[i] && cross3(ring[prev[i]!]!, ring[i]!, ring[next[i]!]!) === 0) {
        flat = i;
        break;
      }
    }
    if (flat < 0) return out;
    cur = next[flat]!;
    unlink(flat);
    remaining--;
    stall = 0;
  }
  const a = ring[prev[cur]!]!;
  const b = ring[cur]!;
  const c = ring[next[cur]!]!;
  if (cross3(a, b, c) > 0) out.push([a, b, c]);
  return out;
}
