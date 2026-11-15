import { earClip, intoCorner, samePt, segmentsMeet, signedArea } from "../scene/shape-geometry";
import type { Pt } from "../scene/types";

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
        !samePt(a, p) &&
        !samePt(b, p) &&
        !samePt(a, m) &&
        !samePt(b, m) &&
        segmentsMeet(m, p, a, b),
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
  return earClip(ring);
}
