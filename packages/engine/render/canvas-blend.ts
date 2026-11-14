/**
 * Pixi's Canvas2D renderer caches its blend mode across render targets, but
 * each target is its own 2D context with its own `globalCompositeOperation`.
 * After a pass that ends additive on one target, the next target can be left
 * drawing normal sprites with `lighter` while the cache says "normal". So
 * every target change starts from a known state: normal, on the new context.
 */
type CanvasContextLike = {
  activeContext: { globalCompositeOperation: string } | null;
  setBlendMode(mode: "normal"): void;
};

type RendererLike = {
  canvasContext?: CanvasContextLike;
  renderTarget?: { onRenderTargetChange?: { add(item: object): unknown } };
};

/** Resets the blend mode on each render target change; a no-op on WebGL and WebGPU renderers. */
export function resetCanvasBlendOnTargetChange(renderer: unknown): void {
  const { canvasContext, renderTarget } = (renderer ?? {}) as RendererLike;
  if (!canvasContext || !renderTarget?.onRenderTargetChange) return;
  renderTarget.onRenderTargetChange.add({
    onRenderTargetChange: () => {
      canvasContext.setBlendMode("normal");
      if (canvasContext.activeContext)
        canvasContext.activeContext.globalCompositeOperation = "source-over";
    },
  });
}
