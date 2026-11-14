// @vitest-environment node
import { CanvasContextSystem, SystemRunner } from "pixi.js";
import { describe, expect, it } from "vite-plus/test";

import { resetCanvasBlendOnTargetChange } from "../canvas-blend";

type Ctx = { globalCompositeOperation: string };
type Active = CanvasContextSystem["activeContext"];

/** Pixi's Canvas2D context system over stand-in 2D contexts, bound the way its render target adaptor binds them. */
function canvasRenderer() {
  const canvasContext = new CanvasContextSystem({} as never);
  const onRenderTargetChange = new SystemRunner("onRenderTargetChange");
  const root: Ctx = { globalCompositeOperation: "source-over" };
  canvasContext.activeContext = root as unknown as Active;
  const bind = (ctx: Ctx) => {
    canvasContext.activeContext = ctx as unknown as Active;
    onRenderTargetChange.emit();
  };
  return { renderer: { canvasContext, renderTarget: { onRenderTargetChange } }, root, bind };
}

describe("resetCanvasBlendOnTargetChange", () => {
  it("draws a normal sprite with source-over on a target an earlier frame left additive", () => {
    const { renderer, root, bind } = canvasRenderer();
    resetCanvasBlendOnTargetChange(renderer);
    const surface: Ctx = { globalCompositeOperation: "source-over" };
    const ctx = renderer.canvasContext;

    // Frame one: the viewport surface ends on an additive draw, the stage then draws normal.
    bind(surface);
    ctx.setBlendMode("normal");
    ctx.setBlendMode("add");
    expect(surface.globalCompositeOperation).toBe("lighter");
    bind(root);
    ctx.setBlendMode("normal");
    expect(root.globalCompositeOperation).toBe("source-over");

    // Frame two: the surface's first sprite is normal.
    bind(surface);
    ctx.setBlendMode("normal");
    expect(surface.globalCompositeOperation).toBe("source-over");
  });

  it("still applies the next additive draw after a target change", () => {
    const { renderer, root, bind } = canvasRenderer();
    resetCanvasBlendOnTargetChange(renderer);
    const surface: Ctx = { globalCompositeOperation: "source-over" };
    renderer.canvasContext.setBlendMode("add");
    bind(surface);
    renderer.canvasContext.setBlendMode("add");
    expect(surface.globalCompositeOperation).toBe("lighter");
    expect(root.globalCompositeOperation).toBe("lighter");
  });

  it("leaves a renderer without a Canvas2D context alone", () => {
    const runner = new SystemRunner("onRenderTargetChange");
    resetCanvasBlendOnTargetChange({ renderTarget: { onRenderTargetChange: runner } });
    resetCanvasBlendOnTargetChange(null);
    expect(runner.items).toHaveLength(0);
  });
});
