import { CellHeap } from "../grid/path";
import { cross3, nearestOnSegment, walkPolygonIssues } from "../scene/shape-geometry";
import type { Pt } from "../scene/types";
import { funnel, type Portal } from "./funnel";
import { triangulate } from "./triangulate";

export type NavMesh = {
  triangles: readonly (readonly [Pt, Pt, Pt])[];
  /** Per triangle, the triangles sharing an edge with it, in edge order. */
  neighbors: readonly (readonly number[])[];
  /** Per triangle, the walk area's entity id. */
  areaOf: readonly string[];
};

export type NavIssue = { entityIds: string[]; message: string };

const edgeKey = (a: Pt, b: Pt): string => {
  const [p, q] = a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]) ? [a, b] : [b, a];
  return `${p[0]},${p[1]}|${q[0]},${q[1]}`;
};

const same = (a: Pt, b: Pt) => a[0] === b[0] && a[1] === b[1];

/**
 * Walk areas triangulated with their holes and stitched where they share an
 * edge's exact endpoints. Polygons that break the walk rules
 * (`walkPolygonIssues`) are reported and left out.
 */
export function buildNavMesh(
  areas: readonly { id: string; pts: readonly Pt[] }[],
  holes: readonly { id: string; pts: readonly Pt[] }[],
): { mesh: NavMesh; issues: NavIssue[] } {
  const checked = walkPolygonIssues(areas, holes);
  const triangles: (readonly [Pt, Pt, Pt])[] = [];
  const areaOf: string[] = [];
  for (const { area, holes: inside } of checked.areas) {
    for (const t of triangulate(
      area.pts,
      inside.map((h) => h.pts),
    )) {
      triangles.push(t);
      areaOf.push(area.id);
    }
  }
  const byEdge = new Map<string, number[]>();
  triangles.forEach((t, i) => {
    for (let e = 0; e < 3; e++) {
      const key = edgeKey(t[e]!, t[(e + 1) % 3]!);
      const list = byEdge.get(key);
      if (list) list.push(i);
      else byEdge.set(key, [i]);
    }
  });
  const neighbors = triangles.map((t, i) => {
    const out: number[] = [];
    for (let e = 0; e < 3; e++) {
      const other = byEdge.get(edgeKey(t[e]!, t[(e + 1) % 3]!))!.find((j) => j !== i);
      if (other !== undefined && !out.includes(other)) out.push(other);
    }
    return out;
  });
  return { mesh: { triangles, neighbors, areaOf }, issues: checked.issues };
}

const dist = (a: Pt, b: Pt) => {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return Math.sqrt(dx * dx + dy * dy);
};

const inTriangle = (p: Pt, [a, b, c]: readonly [Pt, Pt, Pt]) =>
  cross3(a, b, p) >= 0 && cross3(b, c, p) >= 0 && cross3(c, a, p) >= 0;

/** Points this close to the mesh count as on it, so `navNearest`'s rounded answers still path. */
const ON_MESH_D2 = 1e-16;

function nearestOnMesh(mesh: NavMesh, p: Pt): { at: Pt; d2: number; tri: number } {
  let best = { at: [p[0], p[1]] as Pt, d2: Infinity, tri: -1 };
  mesh.triangles.forEach((t, i) => {
    for (let e = 0; e < 3; e++) {
      const at = nearestOnSegment(p, t[e]!, t[(e + 1) % 3]!);
      const dx = at[0] - p[0];
      const dy = at[1] - p[1];
      const d2 = dx * dx + dy * dy;
      if (d2 < best.d2) best = { at, d2, tri: i };
    }
  });
  return best;
}

/** The first triangle holding `p`, or -1 when it's off the mesh. */
function locate(mesh: NavMesh, p: Pt): number {
  const i = mesh.triangles.findIndex((t) => inTriangle(p, t));
  if (i >= 0) return i;
  const near = nearestOnMesh(mesh, p);
  return near.d2 <= ON_MESH_D2 ? near.tri : -1;
}

/** Which edge of triangle `t` it shares with `u` (its corners `e` and `e + 1`), or -1. */
function sharedEdge(mesh: NavMesh, t: number, u: number): number {
  const a = mesh.triangles[t]!;
  const b = mesh.triangles[u]!;
  for (let e = 0; e < 3; e++) {
    const p = a[e]!;
    const q = a[(e + 1) % 3]!;
    if (b.some((v) => same(v, p)) && b.some((v) => same(v, q))) return e;
  }
  return -1;
}

/** The edge `t` shares with `u`, as the portal walking from `t` into `u`. */
function portalBetween(mesh: NavMesh, t: number, u: number): Portal {
  const tri = mesh.triangles[t]!;
  const e = sharedEdge(mesh, t, u);
  if (e < 0) throw new Error(`navmesh: triangles ${t} and ${u} share no edge`);
  return { left: tri[(e + 1) % 3]!, right: tri[e]! };
}

const midpoint = ({ left, right }: Portal): Pt => [
  (left[0] + right[0]) / 2,
  (left[1] + right[1]) / 2,
];

/**
 * A*: triangles by shared-edge midpoints, then the funnel; null when the
 * points aren't connected. A search state is a triangle and the edge it was
 * entered by (state `3 · triangle + edge`), so a triangle reached first
 * through a poor edge can still be reached through a better one.
 */
export function navPath(mesh: NavMesh, from: Pt, to: Pt): Pt[] | null {
  const start = locate(mesh, from);
  const goal = locate(mesh, to);
  if (start < 0 || goal < 0) return null;
  if (start === goal) {
    return [
      [from[0], from[1]],
      [to[0], to[1]],
    ];
  }
  const origin = 3 * mesh.triangles.length;
  const states = origin + 1;
  const cost = Array.from({ length: states }, () => Infinity);
  const at: (Pt | undefined)[] = Array.from({ length: states });
  const came = Array.from({ length: states }, () => -1);
  const closed = Array.from({ length: states }, () => false);
  const triOf = (s: number) => (s === origin ? start : Math.floor(s / 3));
  const heap = new CellHeap();
  cost[origin] = 0;
  at[origin] = from;
  heap.push(origin, dist(from, to), 0);
  let reached = -1;
  while (heap.size > 0) {
    const s = heap.pop();
    if (closed[s]) continue;
    closed[s] = true;
    const t = triOf(s);
    if (t === goal) {
      reached = s;
      break;
    }
    for (const u of mesh.neighbors[t]!) {
      const next = 3 * u + sharedEdge(mesh, u, t);
      if (closed[next]) continue;
      const mid = midpoint(portalBetween(mesh, t, u));
      const g = cost[s]! + dist(at[s]!, mid);
      if (g >= cost[next]!) continue;
      cost[next] = g;
      at[next] = mid;
      came[next] = s;
      const h = dist(mid, to);
      heap.push(next, g + h, h);
    }
  }
  if (reached < 0) return null;
  const corridor: number[] = [];
  for (let s = reached; s >= 0; s = came[s]!) corridor.push(triOf(s));
  corridor.reverse();
  const portals = corridor.slice(1).map((u, k) => portalBetween(mesh, corridor[k]!, u));
  return funnel(from, to, portals);
}

/** Whether `p` lies on the mesh, edges included. */
export function navContains(mesh: NavMesh, p: Pt): boolean {
  return mesh.triangles.some((t) => inTriangle(p, t));
}

/** The closest point on the mesh (for a click outside it); `p` itself when it's on the mesh or the mesh is empty. */
export function navNearest(mesh: NavMesh, p: Pt): Pt {
  if (navContains(mesh, p)) return [p[0], p[1]];
  return nearestOnMesh(mesh, p).at;
}
