import type { Pt, ShapeObj } from "../../scene/types";

/** `Δ 64, 0` */
export const readDelta = ([dx, dy]: Pt): string => `Δ ${dx}, ${dy}`;
/** `640, 320`: where a new point lands. */
export const readPoint = ([x, y]: Pt): string => `${x}, ${y}`;
/** `W 160 H 16` */
export const readSize = (w: number, h: number): string => `W ${w} H ${h}`;
/** `37°` */
export const readAngle = (deg: number): string => `${deg}°`;
/** `R 20` */
export const readRadius = (r: number): string => `R ${r}`;
/** `L 120`: a capsule's full length, caps included. */
export const readLength = (len: number): string => `L ${len}`;

/** A committed shape's size, as the resize readouts print it. */
export function readShapeSize(s: ShapeObj): string {
  switch (s.type) {
    case "box":
      return readSize(2 * s.hw, 2 * s.hh);
    case "circle":
      return readRadius(s.r);
    case "capsule":
      return readLength(2 * (s.halfLen + s.r));
    default: {
      const xs = s.pts.map((p) => p[0]);
      const ys = s.pts.map((p) => p[1]);
      return readSize(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    }
  }
}
