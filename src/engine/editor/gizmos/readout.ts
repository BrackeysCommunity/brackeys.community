import type { Pt, ShapeObj } from "../../scene/types";
import { lengthDecimals } from "../../scene/units";

/**
 * A length in metres as the editor prints it: to the decimals that show one
 * world px at `pxPerMetre`, trailing zeros dropped (`3.25`, `4`, `0.104167`).
 */
export function formatMetres(m: number, pxPerMetre: number): string {
  return String(Number(m.toFixed(lengthDecimals(pxPerMetre))) + 0);
}

/** `Δ 0.64, 0 m` */
export const readDelta = ([dx, dy]: Pt, pxPerMetre: number): string =>
  `Δ ${formatMetres(dx, pxPerMetre)}, ${formatMetres(dy, pxPerMetre)} m`;
/** `6.4, 3.2 m`: where a new point lands. */
export const readPoint = ([x, y]: Pt, pxPerMetre: number): string =>
  `${formatMetres(x, pxPerMetre)}, ${formatMetres(y, pxPerMetre)} m`;
/** `W 1.6 H 0.16 m` */
export const readSize = (w: number, h: number, pxPerMetre: number): string =>
  `W ${formatMetres(w, pxPerMetre)} H ${formatMetres(h, pxPerMetre)} m`;
/** `37°` */
export const readAngle = (deg: number): string => `${deg}°`;
/** `R 0.2 m` */
export const readRadius = (r: number, pxPerMetre: number): string =>
  `R ${formatMetres(r, pxPerMetre)} m`;
/** `L 1.2 m`: a capsule's full length, caps included. */
export const readLength = (len: number, pxPerMetre: number): string =>
  `L ${formatMetres(len, pxPerMetre)} m`;

/** A committed shape's size, as the resize readouts print it. */
export function readShapeSize(s: ShapeObj, pxPerMetre: number): string {
  switch (s.type) {
    case "box":
      return readSize(2 * s.hw, 2 * s.hh, pxPerMetre);
    case "circle":
      return readRadius(s.r, pxPerMetre);
    case "capsule":
      return readLength(2 * (s.halfLen + s.r), pxPerMetre);
    default: {
      const xs = s.pts.map((p) => p[0]);
      const ys = s.pts.map((p) => p[1]);
      return readSize(
        Math.max(...xs) - Math.min(...xs),
        Math.max(...ys) - Math.min(...ys),
        pxPerMetre,
      );
    }
  }
}
