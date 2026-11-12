import { shapeVertices } from "../scene/shape-geometry";
import type { Aabb, Pt, Ref } from "../scene/types";
import { snapToPixel } from "../scene/units";
import type { SnapSettings, SpatialIndex } from "./tools";

/** How close, in screen px, another entity's edge, vertex or centre must be to pull a drag onto it. */
export const SNAP_PX = 8;
/** How far, in screen px beyond the moved box, snapping looks for other entities when no `view` is given. */
export const SNAP_REACH_PX = 128;
/** How far, in screen px, a grid snap's guide runs past the moved box on each side. */
const GRID_GUIDE_PX = 16;

export type SnapTarget = "grid" | "edge" | "vertex" | "center";
export type SnapGuide = { from: Pt; to: Pt };

/** Both coordinates, in metres, on the nearest whole world px at `pxPerMetre`, without `-0`. */
export function roundPt([x, y]: Pt, pxPerMetre: number): Pt {
  return [snapToPixel(x, pxPerMetre), snapToPixel(y, pxPerMetre)];
}

/** One world px at `pxPerMetre`, in metres: the smallest size an editor edit writes. */
export function onePixel(pxPerMetre: number): number {
  return snapToPixel(1 / pxPerMetre, pxPerMetre);
}

/** A size on whole world px, at least one. */
export function pixelSize(m: number, pxPerMetre: number): number {
  return Math.max(onePixel(pxPerMetre), snapToPixel(m, pxPerMetre));
}

/** `v` on the nearest line of a grid `step` metres apart, landing on a whole world px. */
export function snapToGrid(v: number, step: number, pxPerMetre: number): number {
  return snapToPixel(Math.round(v / step) * step, pxPerMetre);
}

/** `p` on the nearest grid point; with `bypass` (Ctrl/Cmd) or snapping off, only on whole world px. */
export function snapPoint(
  p: Pt,
  settings: SnapSettings,
  pxPerMetre: number,
  opts: { bypass?: boolean } = {},
): Pt {
  if (opts.bypass || !settings.enabled || !(settings.step > 0)) return roundPt(p, pxPerMetre);
  const s = settings.step;
  return [snapToGrid(p[0], s, pxPerMetre), snapToGrid(p[1], s, pxPerMetre)];
}

/** An angle on the nearest `angleDeg` step; `free` (Shift) leaves it as it is. */
export function snapAngle(deg: number, settings: SnapSettings, free: boolean): number {
  if (free || !(settings.angleDeg > 0)) return deg;
  return Math.round(deg / settings.angleDeg) * settings.angleDeg + 0;
}

export type SnapMoveInput = {
  /** The moved selection's box before the drag. */
  aabb: Aabb;
  /** Where the drag started, metres. */
  grab: Pt;
  /** The pointer's raw offset since the drag started. */
  delta: Pt;
  settings: SnapSettings;
  /** Other entities to snap to; without it only the grid snaps. */
  index?: SpatialIndex;
  /** Refs that move with the drag and so are never targets. */
  exclude?: readonly Ref[];
  /** Screen px per metre. */
  scale: number;
  /** The game's px per metre: the result lands on whole world px. */
  pxPerMetre: number;
  /** Ctrl/Cmd: no snapping, still whole world px. */
  bypass: boolean;
  /** Where to look for targets; default the moved box plus `SNAP_REACH_PX`. */
  view?: Aabb;
};

export type SnapMoveResult = {
  /** Metres, on whole world px. */
  delta: Pt;
  /**
   * One line per snapped axis: along the target from the moved box to the
   * entity it lines up with, or for a grid snap the grid line across the
   * moved box.
   */
  guides: SnapGuide[];
  by: { x?: SnapTarget; y?: SnapTarget };
};

type Candidate = { value: number; kind: SnapTarget; rank: number; span: [number, number] };

const RANK: Record<SnapTarget, number> = { grid: 0, edge: 1, vertex: 1, center: 2 };

/**
 * A drag's offset, snapped per axis. The moved box's edge nearest the grab
 * point is what snaps, never its centre. It goes to the closest of: the
 * nearest grid line, and other entities' edges, vertices and centres
 * within `SNAP_PX` screen px; ties go to the grid, then edges and
 * vertices, then centres. Each snapped axis gives a guide. `enabled:
 * false` turns all of it off; `geometry: false` leaves only the grid.
 */
export function snapMove(input: SnapMoveInput): SnapMoveResult {
  const { aabb: box, grab, delta, settings, scale, pxPerMetre } = input;
  if (input.bypass || !settings.enabled)
    return { delta: roundPt(delta, pxPerMetre), guides: [], by: {} };

  const tol = SNAP_PX / scale;
  const moved: Aabb = {
    minX: box.minX + delta[0],
    minY: box.minY + delta[1],
    maxX: box.maxX + delta[0],
    maxY: box.maxY + delta[1],
  };
  const targets: Candidate[][] = [[], []];
  if (settings.geometry && input.index) {
    const reach = SNAP_REACH_PX / scale;
    const view = input.view ?? {
      minX: moved.minX - reach,
      minY: moved.minY - reach,
      maxX: moved.maxX + reach,
      maxY: moved.maxY + reach,
    };
    const skip = new Set(input.exclude ?? []);
    for (const e of input.index.query(view)) {
      if (skip.has(e.ref)) continue;
      const b = e.aabb;
      const verts = Array.isArray(e.geometry) ? [e.geometry] : shapeVertices(e.geometry);
      for (const axis of [0, 1] as const) {
        const [lo, hi] = axis === 0 ? [b.minX, b.maxX] : [b.minY, b.maxY];
        const across: [number, number] = axis === 0 ? [b.minY, b.maxY] : [b.minX, b.maxX];
        const list = targets[axis]!;
        if (!Array.isArray(e.geometry)) {
          list.push({ value: lo, kind: "edge", rank: RANK.edge, span: across });
          list.push({ value: hi, kind: "edge", rank: RANK.edge, span: across });
        }
        for (const v of verts) {
          const o = v[1 - axis]!;
          list.push({ value: v[axis]!, kind: "vertex", rank: RANK.vertex, span: [o, o] });
        }
        if (!Array.isArray(e.geometry)) {
          const mid = (lo + hi) / 2;
          const o = (across[0] + across[1]) / 2;
          list.push({ value: mid, kind: "center", rank: RANK.center, span: [o, o] });
        }
      }
    }
  }

  const out: Pt = [delta[0], delta[1]];
  const by: SnapMoveResult["by"] = {};
  const hits: (Candidate | undefined)[] = [undefined, undefined];
  for (const axis of [0, 1] as const) {
    const [lo, hi] = axis === 0 ? [box.minX, box.maxX] : [box.minY, box.maxY];
    const g = grab[axis]!;
    const edge = Math.abs(g - lo) <= Math.abs(g - hi) ? lo : hi;
    const v = edge + delta[axis]!;
    const near = targets[axis]!.filter((c) => Math.abs(c.value - v) <= tol);
    if (settings.step > 0) {
      const line = Math.round(v / settings.step) * settings.step;
      near.push({ value: line, kind: "grid", rank: RANK.grid, span: [0, 0] });
    }
    let best: Candidate | undefined;
    for (const c of near) {
      const d = Math.abs(c.value - v);
      const bd = best ? Math.abs(best.value - v) : Infinity;
      if (d < bd || (d === bd && best && c.rank < best.rank)) best = c;
    }
    if (best) {
      out[axis] = best.value - edge;
      by[axis === 0 ? "x" : "y"] = best.kind;
      hits[axis] = best;
    }
  }

  const final = roundPt(out, pxPerMetre);
  const guides: SnapGuide[] = [];
  const pad = GRID_GUIDE_PX / scale;
  for (const axis of [0, 1] as const) {
    const hit = hits[axis];
    if (!hit) continue;
    const [lo, hi] =
      axis === 0
        ? [box.minY + final[1], box.maxY + final[1]]
        : [box.minX + final[0], box.maxX + final[0]];
    const [a, b] =
      hit.kind === "grid"
        ? [lo - pad, hi + pad]
        : [Math.min(lo, hit.span[0]), Math.max(hi, hit.span[1])];
    guides.push(
      axis === 0
        ? { from: [hit.value, a], to: [hit.value, b] }
        : { from: [a, hit.value], to: [b, hit.value] },
    );
  }
  return { delta: final, guides, by };
}
