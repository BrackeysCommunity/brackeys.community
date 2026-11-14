import {
  aabb,
  containedInRect,
  containsPoint,
  intersectsRect,
  rectsOverlap,
  regionBox,
} from "../scene/shape-geometry";
import type { Aabb, Pt, Ref, ShapeObj } from "../scene/types";
import type { IndexEntry, SpatialIndex } from "./tools";

/** Layers picking skips. */
export type PickLayers = { hidden: ReadonlySet<string>; locked: ReadonlySet<string> };

/** Screen px around a point entity that still picks it. */
export const POINT_PICK_PX = 8;

export type PickOptions = {
  /** Screen px of slack around shapes. */
  tolPx: number;
  /** Screen px per metre. */
  scale: number;
  /** Screen px around a point entity that picks it; default `POINT_PICK_PX`, never less than `tolPx`. */
  pointPx?: number;
  layers?: PickLayers;
};

const pickable = (e: IndexEntry, layers: PickLayers | undefined) =>
  !layers || (!layers.hidden.has(e.layer) && !layers.locked.has(e.layer));

const isPoint = (g: IndexEntry["geometry"]): g is Pt => Array.isArray(g);

/** Whether `p` is within `tol` of the edges of the box region `g` frames. */
function onRegionOutline(g: ShapeObj, p: Pt, tol: number): boolean {
  const b = aabb(regionBox(g));
  const dx = Math.max(b.minX - p[0], p[0] - b.maxX);
  const dy = Math.max(b.minY - p[1], p[1] - b.maxY);
  const distance = Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0);
  return Math.abs(distance) <= tol;
}

/** Whether `rect` crosses the edges of the box region `g` frames, rather than lying clear of it or wholly inside. */
function touchesRegionOutline(g: ShapeObj, rect: Aabb): boolean {
  const b = aabb(regionBox(g));
  const inside =
    rect.minX > b.minX && rect.maxX < b.maxX && rect.minY > b.minY && rect.maxY < b.maxY;
  return rectsOverlap(rect, b) && !inside;
}

/**
 * Every entry under `p` (its geometry, a camera region's outline, or the box
 * its sprite draws), topmost first, skipping hidden and locked layers. An
 * instance's own entry is never hit: what draws under it is, and names the
 * instances it sits in (`IndexEntry.instances`).
 */
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
    if (e.instance || !pickable(e, opts.layers)) return false;
    const { geometry: g, sprite } = e;
    if (sprite && containsPoint(sprite, p, tol)) return true;
    if (isPoint(g)) return Math.hypot(p[0] - g[0], p[1] - g[1]) <= radius;
    return e.region ? onRegionOutline(g, p, tol) : containsPoint(g, p, tol);
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

/** Whether a marquee over `rect` takes entry `e` on its own. */
function inMarquee(e: IndexEntry, rect: Aabb, touch: boolean): boolean {
  const { geometry: g, sprite } = e;
  if (touch && sprite && intersectsRect(sprite, rect)) return true;
  if (isPoint(g))
    return g[0] >= rect.minX && g[0] <= rect.maxX && g[1] >= rect.minY && g[1] <= rect.maxY;
  if (e.region) return touch ? touchesRegionOutline(g, rect) : containedInRect(regionBox(g), rect);
  return touch ? intersectsRect(g, rect) : containedInRect(g, rect);
}

/**
 * What a marquee over `rect` selects, topmost first: entries wholly inside
 * it, or with `touch` (Alt) any it or its sprite's box touches (a camera
 * region's outline, not its inside). A prefab child is never taken on its
 * own: its outermost instance is, in its place, once the marquee takes
 * all of it (with `touch`, any of it). Hidden and locked layers are skipped.
 */
export function marqueeSelect(
  index: SpatialIndex,
  rect: Aabb,
  opts: { touch: boolean; layers?: PickLayers },
): Ref[] {
  const out: Ref[] = [];
  const instances = new Set<Ref>();
  for (const e of index.query(rect)) {
    if (e.instance || !pickable(e, opts.layers) || !inMarquee(e, rect, opts.touch)) continue;
    const outer = e.instances?.[0];
    if (outer === undefined) out.push(e.ref);
    else if (!instances.has(outer)) {
      instances.add(outer);
      const whole = index.get(outer);
      if (opts.touch || (whole && containedInRect(whole.geometry as ShapeObj, rect)))
        out.push(outer);
    }
  }
  return out;
}
