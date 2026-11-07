import { Container, Graphics } from "pixi.js";

import { layerOrder, type SceneView, type ViewLayer, type ViewLayerHandle } from "../context";
import { drawShape } from "./draw-shape";

export type PixiView = SceneView & {
  readonly container: Container;
  /** Destroys every visual and layer, and `container` with them. */
  destroy(): void;
};

/** A scene view drawing into `container`: one child per layer, one `Graphics` per id inside it. */
export function createPixiView(container: Container): PixiView {
  const layers = new Map<number, Container>();
  const visuals = new Map<string, Graphics>();
  container.sortableChildren = true;

  function layerContainer(layer: ViewLayer): Container {
    const order = layerOrder(layer);
    let c = layers.get(order);
    if (!c) {
      c = new Container();
      c.label = `layer:${order}`;
      c.zIndex = order;
      container.addChild(c);
      layers.set(order, c);
    }
    return c;
  }

  return {
    container,
    draw(id, shape, style, layer) {
      let g = visuals.get(id);
      if (g) g.clear();
      else {
        g = new Graphics();
        g.label = id;
        visuals.set(id, g);
      }
      drawShape(g, shape, style);
      const target = layerContainer(layer);
      if (g.parent !== target) target.addChild(g);
    },
    pose(id, x, y, rot = 0) {
      const g = visuals.get(id);
      if (!g) return;
      g.position.set(x, y);
      g.rotation = rot;
    },
    remove(id) {
      visuals.get(id)?.destroy();
      visuals.delete(id);
    },
    layer: (layer) => layerContainer(layer) as unknown as ViewLayerHandle,
    destroy() {
      visuals.clear();
      layers.clear();
      container.destroy({ children: true });
    },
  };
}

/** The Pixi container behind a Pixi view's layer handle, for a game drawing what the view can't. */
export function pixiContainer(handle: ViewLayerHandle): Container {
  if (!(handle instanceof Container)) throw new Error("not a Pixi view layer");
  return handle;
}
