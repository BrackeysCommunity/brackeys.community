import type { Graphics } from "pixi.js";

import type { Style } from "../game/types";
import { shapeIsClosed, shapeOutline } from "../scene/shape-outline";
import type { ShapeObj } from "../scene/types";

/** Trace `shape` into `g` in the shape's own coordinates; the caller fills or strokes. */
export function traceShape(g: Graphics, shape: ShapeObj): void {
  for (const c of shapeOutline(shape)) {
    switch (c.op) {
      case "moveTo":
        g.moveTo(c.x, c.y);
        break;
      case "lineTo":
        g.lineTo(c.x, c.y);
        break;
      case "arc":
        g.arc(c.cx, c.cy, c.r, c.start, c.end);
        break;
      case "close":
        g.closePath();
        break;
    }
  }
}

/**
 * Trace `shape` into `g`, fill it with `style.fill` and stroke it with
 * `style.stroke` at `style.strokeAlpha ?? style.alpha`. An open shape has no
 * fill, so it strokes in its fill color when the style has no stroke.
 */
export function drawShape(g: Graphics, shape: ShapeObj, style: Style): void {
  const closed = shapeIsClosed(shape);
  const fill = closed ? style.fill : undefined;
  const stroke = closed ? style.stroke : (style.stroke ?? style.fill);
  if (fill === undefined && stroke === undefined) return;
  const alpha = style.alpha ?? 1;
  traceShape(g, shape);
  if (fill !== undefined) g.fill({ color: fill, alpha });
  if (stroke !== undefined) {
    g.stroke({ color: stroke, alpha: style.strokeAlpha ?? alpha, width: style.strokeWidth ?? 1 });
  }
}
