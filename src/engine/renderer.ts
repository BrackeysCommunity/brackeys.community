import { Application, Container, Graphics, Rectangle } from "pixi.js";

import { DEFAULT_RESOLUTION, viewportFor, type ResolutionPolicy } from "./resolution";
import type { GameConfig, GameInstance, Vec2 } from "./types";

export type Renderer = {
  app: Application;
  worldContainer: Container;
  uiContainer: Container;
  resize: (width: number, height: number) => void;
  /** The canvas pixel under each world point, through the world container's current transform. */
  extractPixels: GameInstance["extractPixels"];
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

  function extractPixels(world: readonly Vec2[]): ReturnType<GameInstance["extractPixels"]> {
    const { width, height } = app.screen;
    const pixels = world.map((point) => {
      const at = worldContainer.toGlobal(point);
      const x = Math.floor(at.x);
      const y = Math.floor(at.y);
      if (!(x >= 0 && y >= 0 && x < width && y < height)) return null;
      const { pixels: rgba } = app.renderer.extract.pixels({
        target: app.stage,
        frame: new Rectangle(x, y, 1, 1),
        resolution: 1,
        clearColor: config.backgroundColor,
      });
      return [rgba[0] ?? 0, rgba[1] ?? 0, rgba[2] ?? 0, rgba[3] ?? 0] as const;
    });
    return { renderer: app.renderer.name, pixels };
  }

  function destroy(): void {
    // Pass false for removeView — React owns the canvas DOM element, not PixiJS.
    // Passing true causes Strict Mode double-mount to fail (canvas removed on first cleanup).
    app.destroy(false, { children: true });
  }

  return { app, worldContainer, uiContainer, resize, extractPixels, destroy };
}
