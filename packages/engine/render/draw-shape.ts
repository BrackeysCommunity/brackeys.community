import type { Graphics } from "pixi.js";

import type { Style } from "../game/types";
import { shapeIsClosed, shapeOutline } from "../scene/shape-outline";
import type { ShapeObj } from "../scene/types";

/**
 * Trace `shape` into `g`, its coordinates times `scale` (the Pixi view passes
 * the game's px per metre, so the outline is built in world px and arcs keep
 * their smoothness); the caller fills or strokes.
 */
export function traceShape(g: Graphics, shape: ShapeObj, scale = 1): void {
  for (const c of shapeOutline(shape)) {
    switch (c.op) {
      case "moveTo":
        g.moveTo(c.x * scale, c.y * scale);
        break;
      case "lineTo":
        g.lineTo(c.x * scale, c.y * scale);
        break;
      case "arc":
        g.arc(c.cx * scale, c.cy * scale, c.r * scale, c.start, c.end);
        break;
      case "close":
        g.closePath();
        break;
    }
  }
}

/**
 * Trace `shape` into `g` at `scale` (as `traceShape`), fill it with
 * `style.fill` and stroke it with `style.stroke` at `style.strokeAlpha ??
 * style.alpha`, `style.strokeWidth` px wide whatever the scale. An open
 * shape has no fill, so it strokes in its fill color when the style has no
 * stroke.
 */
export function drawShape(g: Graphics, shape: ShapeObj, style: Style, scale = 1): void {
  const closed = shapeIsClosed(shape);
  const fill = closed ? style.fill : undefined;
  const stroke = closed ? style.stroke : (style.stroke ?? style.fill);
  if (fill === undefined && stroke === undefined) return;
  const alpha = style.alpha ?? 1;
  traceShape(g, shape, scale);
  if (fill !== undefined) g.fill({ color: fill, alpha });
  if (stroke !== undefined) {
    g.stroke({ color: stroke, alpha: style.strokeAlpha ?? alpha, width: style.strokeWidth ?? 1 });
  }
}
