import { Application, Container, Graphics } from "pixi.js";

import { DEFAULT_RESOLUTION, viewportFor, type ResolutionPolicy } from "./resolution";
import type { GameConfig } from "./types";

export type Renderer = {
  app: Application;
  worldContainer: Container;
  uiContainer: Container;
  resize: (width: number, height: number) => void;
  destroy: () => void;
};

/**
 * The Pixi app, antialiased as `resolution` says, with the world under the
 * policy's bars (in `bars`, default the background) and the UI over both.
 */
export async function createRenderer(
  canvas: HTMLCanvasElement,
  config: GameConfig,
  resolution: ResolutionPolicy = DEFAULT_RESOLUTION,
): Promise<Renderer> {
  const app = new Application();

  await app.init({
    canvas,
    preference: "webgpu",
    width: config.displayWidth,
    height: config.displayHeight,
    backgroundColor: config.backgroundColor,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
    antialias: resolution.antialias ?? true,
  });

  // Stage hierarchy: world (camera-affected), the bars over it, and UI (screen-fixed)
  const worldContainer = new Container();
  worldContainer.label = "world";

  const bars = new Graphics();
  bars.label = "bars";
  const barColor = resolution.bars ?? config.backgroundColor;

  const uiContainer = new Container();
  uiContainer.label = "ui";

  app.stage.addChild(worldContainer);
  app.stage.addChild(bars);
  app.stage.addChild(uiContainer);

  /** Covers the canvas outside the policy's viewport, so the world shows only inside it. */
  function drawBars(width: number, height: number): void {
    bars.clear();
    const vp = viewportFor(resolution, { width, height });
    if (!vp.bars) return;
    const { x, y } = vp.offset;
    const w = vp.view.width * vp.scale;
    const h = vp.view.height * vp.scale;
    const rects: [number, number, number, number][] = [
      [0, 0, width, y],
      [0, y + h, width, height - y - h],
      [0, y, x, h],
      [x + w, y, width - x - w, h],
    ];
    for (const [rx, ry, rw, rh] of rects) if (rw > 0 && rh > 0) bars.rect(rx, ry, rw, rh);
    bars.fill(barColor);
  }

  function resize(width: number, height: number): void {
    app.renderer.resize(width, height);
    drawBars(width, height);
  }

  drawBars(config.displayWidth, config.displayHeight);

  function destroy(): void {
    // Pass false for removeView — React owns the canvas DOM element, not PixiJS.
    // Passing true causes Strict Mode double-mount to fail (canvas removed on first cleanup).
    app.destroy(false, { children: true });
  }

  return { app, worldContainer, uiContainer, resize, destroy };
}
