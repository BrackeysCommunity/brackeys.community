import type { MapViewNumbers } from "../../mmo-api/src/index.ts";
import { type Camera, pan, type View, zoomAt } from "./camera.ts";
import type { Point } from "./hex.ts";

// structural: how a gesture moves the camera, and the backing store's pixel-ratio limit.
export const TAP_SLOP_PX = 8;
export const WHEEL_RATE = 0.0015;
export const KEY_PAN = 0.125; // of the view
export const KEY_ZOOM = 1.25;
export const MAX_DPR = 2;

/** A press that moved past the slop is a drag, not a tap. */
export function slipped(tap: Point, p: Point): boolean {
  return Math.hypot(p.x - tap.x, p.y - tap.y) > TAP_SLOP_PX;
}

export function wheelZoom(
  c: Camera,
  deltaY: number,
  at: Point,
  view: View,
  v: MapViewNumbers,
): Camera {
  return zoomAt(c, Math.exp(-deltaY * WHEEL_RATE), at, view, v);
}

/** Two fingers: follow their midpoint, and zoom round it by how far they spread. */
export function pinch(
  c: Camera,
  was: Point,
  now: Point,
  other: Point,
  view: View,
  v: MapViewNumbers,
): Camera {
  const before = Math.hypot(was.x - other.x, was.y - other.y);
  const after = Math.hypot(now.x - other.x, now.y - other.y);
  const mid = { x: (now.x + other.x) / 2, y: (now.y + other.y) / 2 };
  const midWas = { x: (was.x + other.x) / 2, y: (was.y + other.y) / 2 };
  const next = pan(c, mid.x - midWas.x, mid.y - midWas.y);
  return before > 0 && after > 0 ? zoomAt(next, after / before, mid, view, v) : next;
}

/** Arrows pan, + and - zoom round the centre; any other key is not the map's. */
export function keyMove(c: Camera, key: string, view: View, v: MapViewNumbers): Camera | undefined {
  const centre = { x: view.width / 2, y: view.height / 2 };
  const step = { x: view.width * KEY_PAN, y: view.height * KEY_PAN };
  switch (key) {
    case "ArrowLeft":
      return pan(c, step.x, 0);
    case "ArrowRight":
      return pan(c, -step.x, 0);
    case "ArrowUp":
      return pan(c, 0, step.y);
    case "ArrowDown":
      return pan(c, 0, -step.y);
    case "+":
    case "=":
      return zoomAt(c, KEY_ZOOM, centre, view, v);
    case "-":
      return zoomAt(c, 1 / KEY_ZOOM, centre, view, v);
    default:
      return undefined;
  }
}

/** The canvas's backing store for a view in CSS px. */
export function backing(
  view: View,
  devicePixelRatio: number,
): { width: number; height: number; dpr: number } {
  const dpr = Math.min(devicePixelRatio > 0 ? devicePixelRatio : 1, MAX_DPR);
  return {
    width: Math.max(1, Math.round(view.width * dpr)),
    height: Math.max(1, Math.round(view.height * dpr)),
    dpr,
  };
}

/** The pointers down on a map, and whether the one press so far is still a tap. */
export class PointerTracker {
  private readonly pointers = new Map<number, Point>();
  private tap: { x: number; y: number; moved: boolean } | undefined;

  /** A tap starts only when this is the one pointer down. */
  down(id: number, p: Point): void {
    this.pointers.set(id, p);
    this.tap = this.pointers.size === 1 ? { ...p, moved: false } : undefined;
  }

  has(id: number): boolean {
    return this.pointers.has(id);
  }

  /** The camera a move gives: a pan for one pointer, a pinch for two. */
  move(id: number, p: Point, c: Camera, view: View, v: MapViewNumbers): Camera | undefined {
    const was = this.pointers.get(id);
    if (!was) return undefined;
    if (this.tap && slipped(this.tap, p)) this.tap.moved = true;
    if (this.pointers.size === 1) {
      this.pointers.set(id, p);
      return pan(c, p.x - was.x, p.y - was.y);
    }
    const other = [...this.pointers.entries()].find(([k]) => k !== id)?.[1];
    if (!other) return undefined;
    this.pointers.set(id, p);
    return pinch(c, was, p, other, view, v);
  }

  /** True when the lift ends a tap: unmoved, not cancelled, and the last pointer up. */
  up(id: number, cancelled = false): boolean {
    if (!this.pointers.delete(id)) return false;
    const tap = this.tap;
    this.tap = undefined;
    return !cancelled && tap !== undefined && !tap.moved && this.pointers.size === 0;
  }
}
