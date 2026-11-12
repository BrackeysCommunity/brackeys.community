import { cross3 } from "../scene/shape-geometry";
import type { Pt } from "../scene/types";

/**
 * A portal between two triangles of a corridor: its ends as seen facing
 * through it along the walk, in a y-up frame (so mirrored on screen).
 */
export type Portal = { left: Pt; right: Pt };

const same = (a: Pt, b: Pt) => a[0] === b[0] && a[1] === b[1];

/**
 * The shortest path through a corridor of portals (simple stupid funnel):
 * `from`, the portal corners it bends around, then `to`. A corner exactly on
 * the line of the funnel's other side is kept, so a path hugs corners.
 */
export function funnel(from: Pt, to: Pt, portals: readonly Portal[]): Pt[] {
  const gates: Portal[] = [...portals, { left: to, right: to }];
  const path: Pt[] = [[from[0], from[1]]];
  let apex: Pt = from;
  let left: Pt = from;
  let right: Pt = from;
  let leftAt = -1;
  let rightAt = -1;
  const restart = (corner: Pt, at: number): number => {
    if (!same(path[path.length - 1]!, corner)) path.push([corner[0], corner[1]]);
    apex = corner;
    left = corner;
    right = corner;
    leftAt = at;
    rightAt = at;
    return at;
  };
  for (let i = 0; i < gates.length; i++) {
    const { left: l, right: r } = gates[i]!;
    if (cross3(apex, right, r) >= 0) {
      if (same(apex, right) || cross3(apex, left, r) < 0) {
        right = r;
        rightAt = i;
      } else {
        i = restart(left, leftAt);
        continue;
      }
    }
    if (cross3(apex, left, l) <= 0) {
      if (same(apex, left) || cross3(apex, right, l) > 0) {
        left = l;
        leftAt = i;
      } else {
        i = restart(right, rightAt);
        continue;
      }
    }
  }
  if (!same(path[path.length - 1]!, to)) path.push([to[0], to[1]]);
  return path;
}
