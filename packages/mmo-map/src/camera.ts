import type { MapRegions, MapViewNumbers } from "../../mmo-api/src/index.ts";
import { type Axial, hexCentre, pixelToHex, type Point } from "./hex.ts";

export type Level = "region" | "area" | "tile";

/** x and y: the view's centre in world px at size 1; size: the hex corner radius in CSS px. */
export interface Camera {
  x: number;
  y: number;
  size: number;
}

/** The view in CSS px. */
export interface View {
  width: number;
  height: number;
}

/** The world px at size 1 a view covers. */
export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function levelFor(size: number, v: MapViewNumbers): Level {
  if (size < v.zoomArea) return "region";
  if (size < v.zoomTile) return "area";
  return "tile";
}

export function clampSize(size: number, v: MapViewNumbers): number {
  return Math.min(v.zoomMax, Math.max(v.zoomMin, size));
}

export function screenToWorld(c: Camera, view: View, x: number, y: number): Point {
  return { x: c.x + (x - view.width / 2) / c.size, y: c.y + (y - view.height / 2) / c.size };
}

export function worldToScreen(c: Camera, view: View, x: number, y: number): Point {
  return { x: (x - c.x) * c.size + view.width / 2, y: (y - c.y) * c.size + view.height / 2 };
}

export function viewBounds(c: Camera, view: View): Bounds {
  const hw = view.width / 2 / c.size;
  const hh = view.height / 2 / c.size;
  return { left: c.x - hw, top: c.y - hh, right: c.x + hw, bottom: c.y + hh };
}

/** Zooms by factor, keeping the world point under `at` (CSS px in the view) where it is. */
export function zoomAt(
  c: Camera,
  factor: number,
  at: Point,
  view: View,
  v: MapViewNumbers,
): Camera {
  const size = clampSize(c.size * factor, v);
  const w = screenToWorld(c, view, at.x, at.y);
  return {
    x: w.x - (at.x - view.width / 2) / size,
    y: w.y - (at.y - view.height / 2) / size,
    size,
  };
}

/** Moves the view by a drag of dx, dy CSS px: the map follows the pointer. */
export function pan(c: Camera, dx: number, dy: number): Camera {
  return { x: c.x - dx / c.size, y: c.y - dy / c.size, size: c.size };
}

export function centreOn(h: Axial, size: number): Camera {
  const p = hexCentre(h, 1);
  return { x: p.x, y: p.y, size };
}

/** The camera that fits every discovered tile of the regions payload in the view. */
export function fitRegions(r: MapRegions, view: View, v: MapViewNumbers): Camera {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  const take = (h: Axial) => {
    const p = hexCentre(h, 1);
    left = Math.min(left, p.x);
    right = Math.max(right, p.x);
    top = Math.min(top, p.y);
    bottom = Math.max(bottom, p.y);
  };
  for (const row of r.rows) {
    let first = -1;
    let last = -1;
    row.slots.forEach((slot, i) => {
      if (slot < 0) return;
      if (first < 0) first = i;
      last = i;
    });
    if (first < 0) continue;
    take({ q: row.q + first, r: row.r });
    take({ q: row.q + last, r: row.r });
  }
  for (const p of r.places) take(p);
  if (left > right) return { x: 0, y: 0, size: clampSize(v.zoomMin, v) };
  // A pointy-top hex reaches √3/2 across and 1 up and down from its centre.
  const width = right - left + Math.sqrt(3);
  const height = bottom - top + 2;
  const size = clampSize(Math.min(view.width / width, view.height / height), v);
  return { x: (left + right) / 2, y: (top + bottom) / 2, size };
}

export function screenToHex(c: Camera, view: View, x: number, y: number): Axial {
  const w = screenToWorld(c, view, x, y);
  return pixelToHex(w.x, w.y, 1);
}
