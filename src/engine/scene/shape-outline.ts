import { boxCorners } from "./shape-geometry";
import type { Pt, ShapeObj } from "./types";

/** One step of a 2D path, in the shape's coordinates. */
export type PathCommand =
  | { op: "moveTo"; x: number; y: number }
  | { op: "lineTo"; x: number; y: number }
  /** Radians, clockwise on screen (y down), from `start` to `end`. */
  | { op: "arc"; cx: number; cy: number; r: number; start: number; end: number }
  | { op: "close" };

const DEG = Math.PI / 180;

const moveTo = ([x, y]: Pt): PathCommand => ({ op: "moveTo", x, y });
const lineTo = ([x, y]: Pt): PathCommand => ({ op: "lineTo", x, y });
const mid = ([ax, ay]: Pt, [bx, by]: Pt): Pt => [(ax + bx) / 2, (ay + by) / 2];

/** False only for a chain, which has no inside to fill. */
export function shapeIsClosed(shape: ShapeObj): boolean {
  return shape.type !== "chain";
}

/**
 * The shape's outline as path commands, rotation applied. Every path starts
 * with a `moveTo`, so outlines replayed one after another never join.
 */
export function shapeOutline(shape: ShapeObj): PathCommand[] {
  switch (shape.type) {
    case "box": {
      const [a, ...rest] = boxCorners(shape);
      if (!a) return [];
      return [moveTo(a), ...rest.map(lineTo), { op: "close" }];
    }
    case "circle":
      return [
        moveTo([shape.cx + shape.r, shape.cy]),
        { op: "arc", cx: shape.cx, cy: shape.cy, r: shape.r, start: 0, end: 2 * Math.PI },
        { op: "close" },
      ];
    case "capsule": {
      // The capsule's straight sides are the long edges of its inner box;
      // each end cap is a half circle around a short edge's midpoint.
      const [tl, tr, br, bl] = boxCorners({
        type: "box",
        cx: shape.cx,
        cy: shape.cy,
        hw: shape.r,
        hh: shape.halfLen,
        rotDeg: shape.rotDeg,
      });
      if (!tl || !tr || !br || !bl) return [];
      const rot = (shape.rotDeg % 360) * DEG;
      const [ax, ay] = mid(tl, tr);
      const [bx, by] = mid(br, bl);
      return [
        moveTo(tr),
        lineTo(br),
        { op: "arc", cx: bx, cy: by, r: shape.r, start: rot, end: rot + Math.PI },
        lineTo(tl),
        { op: "arc", cx: ax, cy: ay, r: shape.r, start: rot + Math.PI, end: rot + 2 * Math.PI },
        { op: "close" },
      ];
    }
    case "poly":
    case "chain": {
      const [first, ...rest] = shape.pts;
      if (!first) return [];
      const path = [moveTo(first), ...rest.map(lineTo)];
      return shape.type === "poly" ? [...path, { op: "close" }] : path;
    }
  }
}
