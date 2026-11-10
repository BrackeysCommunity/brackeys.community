import { containedInRect, containsPoint, intersectsRect } from "../scene/shape-geometry";
import type { Aabb, Pt, Ref } from "../scene/types";
import type { IndexEntry, SpatialIndex } from "./tools";

/** Layers picking skips. */
export type PickLayers = { hidden: ReadonlySet<string>; locked: ReadonlySet<string> };

/** Screen px around a point entity that still picks it. */
export const POINT_PICK_PX = 8;

export type PickOptions = {
  /** Screen px of slack around shapes. */
  tolPx: number;
  /** Screen px per world px. */
  scale: number;
  /** Screen px around a point entity that picks it; default `POINT_PICK_PX`, never less than `tolPx`. */
  pointPx?: number;
  layers?: PickLayers;
};

const pickable = (e: IndexEntry, layers: PickLayers | undefined) =>
  !layers || (!layers.hidden.has(e.layer) && !layers.locked.has(e.layer));

const isPoint = (g: IndexEntry["geometry"]): g is Pt => Array.isArray(g);

/** Every entry under `p` (its geometry, or the box its sprite draws), topmost first, skipping hidden and locked layers. */
export function pickAt(index: SpatialIndex, p: Pt, opts: PickOptions): IndexEntry[] {
  const tol = opts.tolPx / opts.scale;
  const radius = Math.max(opts.pointPx ?? POINT_PICK_PX, opts.tolPx) / opts.scale;
  const reach = Math.max(tol, radius);
  const near = index.query({
    minX: p[0] - reach,
    minY: p[1] - reach,
    maxX: p[0] + reach,
    maxY: p[1] + reach,
  });
  return near.filter((e) => {
    if (!pickable(e, opts.layers)) return false;
    const { geometry: g, sprite } = e;
    if (sprite && containsPoint(sprite, p, tol)) return true;
    return isPoint(g) ? Math.hypot(p[0] - g[0], p[1] - g[1]) <= radius : containsPoint(g, p, tol);
  });
}

/**
 * What Alt-click selects: the hit after `current` among `hits` (topmost
 * first, wrapping), or the topmost when `current` isn't under the pointer.
 */
export function cycleHit(hits: readonly IndexEntry[], current?: Ref): Ref | undefined {
  const at = current === undefined ? -1 : hits.findIndex((h) => h.ref === current);
  return hits[at < 0 ? 0 : (at + 1) % hits.length]?.ref;
}

/**
 * What a marquee over `rect` selects, topmost first: entries wholly inside
 * it, or with `touch` (Alt) any it or its sprite's box touches. Hidden and
 * locked layers are skipped.
 */
export function marqueeSelect(
  index: SpatialIndex,
  rect: Aabb,
  opts: { touch: boolean; layers?: PickLayers },
): Ref[] {
  return index
    .query(rect)
    .filter((e) => {
      if (!pickable(e, opts.layers)) return false;
      const { geometry: g, sprite } = e;
      if (opts.touch && sprite && intersectsRect(sprite, rect)) return true;
      if (isPoint(g))
        return g[0] >= rect.minX && g[0] <= rect.maxX && g[1] >= rect.minY && g[1] <= rect.maxY;
      return opts.touch ? intersectsRect(g, rect) : containedInRect(g, rect);
    })
    .map((e) => e.ref);
}
