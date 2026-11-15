import { Container, Graphics, Text, TextStyle } from "pixi.js";

import { traceShape } from "../render/draw-shape";
import { shapeIsClosed } from "../scene/shape-outline";
import { DEBUG_DRAW_COLOR, DEBUG_TEXT_SIZE } from "../scene/svg";
import type { DebugLayerFactory } from "./index";

export { createDebugDrawSink, DEBUG_DRAW_MAX } from "./draw-sink";

/** Text draws the layer shows at once; the rest are skipped. */
const MAX_TEXTS = 256;

let textStyle: TextStyle | null = null;
const textStyleOf = () =>
  (textStyle ??= new TextStyle({
    fontFamily: "monospace",
    fontSize: DEBUG_TEXT_SIZE,
    fill: 0xffffff,
    stroke: { color: 0x000000, width: 3 },
  }));

/**
 * Game code's `ctx.debug` draws for the last tick, positions in world
 * metres and widths in screen px. Drawn in world px inside a container
 * scaled back to metres, like the physics wireframes.
 */
export const debugDrawLayer: DebugLayerFactory = {
  id: "debug-draw",
  needs: { debugDraw: true },
  create(host) {
    const k = host.pxPerMetre;
    const container = new Container();
    container.label = "debug-draw";
    container.scale.set(1 / k);
    const graphics = new Graphics();
    const labels = new Container();
    container.addChild(graphics);
    container.addChild(labels);
    host.worldContainer.addChild(container);
    const pool: Text[] = [];

    return {
      update(frame) {
        const perScreenPx = frame.scale > 0 && Number.isFinite(frame.scale) ? k / frame.scale : 1;
        graphics.clear();
        let shown = 0;
        for (const cmd of frame.draws ?? []) {
          const color = cmd.style.color ?? DEBUG_DRAW_COLOR;
          const alpha = cmd.style.alpha ?? 1;
          if (cmd.kind === "text") {
            if (shown >= MAX_TEXTS) continue;
            const label = (pool[shown] ??= labels.addChild(new Text({ style: textStyleOf() })));
            label.visible = true;
            label.text = cmd.text;
            label.tint = color;
            label.alpha = alpha;
            label.position.set(cmd.at.x * k, cmd.at.y * k);
            label.scale.set(((cmd.size ?? DEBUG_TEXT_SIZE) / DEBUG_TEXT_SIZE) * perScreenPx);
            shown++;
            continue;
          }
          let closed = true;
          switch (cmd.kind) {
            case "line":
              graphics.moveTo(cmd.a.x * k, cmd.a.y * k).lineTo(cmd.b.x * k, cmd.b.y * k);
              closed = false;
              break;
            case "box":
              graphics.rect(
                (cmd.at.x - cmd.size[0] / 2) * k,
                (cmd.at.y - cmd.size[1] / 2) * k,
                cmd.size[0] * k,
                cmd.size[1] * k,
              );
              break;
            case "circle":
              graphics.circle(cmd.at.x * k, cmd.at.y * k, cmd.r * k);
              break;
            case "shape":
              traceShape(graphics, cmd.shape, k);
              closed = shapeIsClosed(cmd.shape);
              break;
            case "path":
              if (cmd.pts.length < 2) continue;
              graphics.poly(
                cmd.pts.flatMap((p) => [p.x * k, p.y * k]),
                cmd.closed,
              );
              closed = cmd.closed;
              break;
          }
          if (closed) graphics.fill({ color, alpha: alpha * 0.12 });
          graphics.stroke({ width: (cmd.style.width ?? 1) * perScreenPx, color, alpha });
        }
        for (let i = shown; i < pool.length; i++) pool[i]!.visible = false;
      },
      setVisible(visible) {
        container.visible = visible;
      },
      destroy() {
        container.destroy({ children: true });
        pool.length = 0;
      },
    };
  },
};
