import { Container, Graphics } from "pixi.js";
import { describe, expect, it } from "vite-plus/test";

import { DRAW_LAYERS, type ViewLayerHandle } from "../../context";
import type { ShapeObj } from "../../scene/types";
import { createPixiView, pixiContainer } from "../pixi-view";

const box: ShapeObj = { type: "box", cx: 0, cy: 0, hw: 10, hh: 5, rotDeg: 0 };
const style = { fill: 0x112233, stroke: 0xffffff, alpha: 0.5 };

function graphicsOf(view: ReturnType<typeof createPixiView>, id: string): Graphics | undefined {
  for (const layer of view.container.children) {
    const g = layer.children.find((c) => c.label === id);
    if (g) return g as Graphics;
  }
  return undefined;
}

describe("createPixiView", () => {
  it("draws each id once, in a child per layer ordered by DRAW_LAYERS", () => {
    const view = createPixiView(new Container());
    view.draw("a", box, style, "terrain");
    view.draw("b", box, style, "actor");
    view.draw("c", box, style, 35);

    const layers = view.container.children;
    expect(view.container.sortableChildren).toBe(true);
    expect(layers.map((l) => l.zIndex)).toEqual([DRAW_LAYERS.terrain, DRAW_LAYERS.actor, 35]);
    expect(layers.map((l) => l.children.map((c) => c.label))).toEqual([["a"], ["b"], ["c"]]);
  });

  it("replaces a drawing in place and keeps its pose", () => {
    const view = createPixiView(new Container());
    view.draw("a", box, style, "body");
    const g = graphicsOf(view, "a")!;
    view.pose("a", 40, 50, 0.5);
    view.draw("a", { ...box, hw: 20 }, style, "body");

    expect(graphicsOf(view, "a")).toBe(g);
    expect([g.position.x, g.position.y, g.rotation]).toEqual([40, 50, 0.5]);
    expect(g.bounds.width).toBeGreaterThanOrEqual(40);
  });

  it("gives the stroke its own alpha when the style has one", () => {
    const view = createPixiView(new Container());
    view.draw("a", box, { ...style, alpha: 0.2, strokeAlpha: 0.6, strokeWidth: 2 }, "body");
    const painted = graphicsOf(view, "a")!.context.instructions.map((i) => [
      i.action,
      (i.data.style as { alpha: number }).alpha,
    ]);
    expect(painted).toEqual([
      ["fill", 0.2],
      ["stroke", 0.6],
    ]);
  });

  it("moves a redrawn id to its new layer", () => {
    const view = createPixiView(new Container());
    view.draw("a", box, style, "terrain");
    view.draw("a", box, style, "overlay");
    expect(view.container.children.map((l) => l.children.length)).toEqual([0, 1]);
  });

  it("removes idempotently and ignores a pose for an unknown id", () => {
    const view = createPixiView(new Container());
    view.draw("a", box, style, "terrain");
    const g = graphicsOf(view, "a")!;
    view.remove("a");
    view.remove("a");
    view.pose("a", 1, 2);
    expect(g.destroyed).toBe(true);
    expect(graphicsOf(view, "a")).toBeUndefined();
  });

  it("hands out one container per layer for games that draw their own", () => {
    const view = createPixiView(new Container());
    const handle = view.layer("marker");
    const c = pixiContainer(handle);
    expect(c).toBeInstanceOf(Container);
    expect(pixiContainer(view.layer(DRAW_LAYERS.marker))).toBe(c);
    expect(() => pixiContainer({ __viewLayer: true } as ViewLayerHandle)).toThrow();
  });

  it("destroys its visuals and container", () => {
    const container = new Container();
    const view = createPixiView(container);
    view.draw("a", box, style, "terrain");
    const g = graphicsOf(view, "a")!;
    view.destroy();
    expect(g.destroyed).toBe(true);
    expect(container.destroyed).toBe(true);
  });
});
