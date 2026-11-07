import type { Graphics } from "pixi.js";

import { degToRad } from "../physics";
import type { ShapeObj } from "../scene/types";

/** Trace `shape` into `g` in the shape's own coordinates; the caller fills or strokes. */
export function traceShape(g: Graphics, shape: ShapeObj): void {
  switch (shape.type) {
    case "box": {
      const corners = rotatedRect(shape.cx, shape.cy, shape.hw, shape.hh, degToRad(shape.rotDeg));
      g.poly(corners);
      break;
    }
    case "circle":
      g.circle(shape.cx, shape.cy, shape.r);
      break;
    case "capsule": {
      const rot = degToRad(shape.rotDeg);
      const dx = -Math.sin(rot) * shape.halfLen;
      const dy = Math.cos(rot) * shape.halfLen;
      g.circle(shape.cx - dx, shape.cy - dy, shape.r);
      g.circle(shape.cx + dx, shape.cy + dy, shape.r);
      g.poly(rotatedRect(shape.cx, shape.cy, shape.r, shape.halfLen, rot));
      break;
    }
    case "poly":
      g.poly(shape.pts.flat());
      break;
    case "chain": {
      const [first, ...rest] = shape.pts;
      if (!first) break;
      g.moveTo(first[0], first[1]);
      for (const [x, y] of rest) g.lineTo(x, y);
      break;
    }
  }
}

function rotatedRect(cx: number, cy: number, hw: number, hh: number, rot: number): number[] {
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const out: number[] = [];
  for (const [lx, ly] of [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ]) {
    out.push(cx + lx * cos - ly * sin, cy + lx * sin + ly * cos);
  }
  return out;
}
