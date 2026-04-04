import { Application, Container } from "pixi.js";
import type { GameConfig } from "./types";

export type Renderer = {
  app: Application;
  worldContainer: Container;
  uiContainer: Container;
  resize: (width: number, height: number) => void;
  destroy: () => void;
};

export async function createRenderer(
  canvas: HTMLCanvasElement,
  config: GameConfig,
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
    antialias: true,
  });

  // Stage hierarchy: world (camera-affected) and UI (screen-fixed)
  const worldContainer = new Container();
  worldContainer.label = "world";

  const uiContainer = new Container();
  uiContainer.label = "ui";

  app.stage.addChild(worldContainer);
  app.stage.addChild(uiContainer);

  function resize(width: number, height: number): void {
    app.renderer.resize(width, height);
  }

  function destroy(): void {
    // Pass false for removeView — React owns the canvas DOM element, not PixiJS.
    // Passing true causes Strict Mode double-mount to fail (canvas removed on first cleanup).
    app.destroy(false, { children: true });
  }

  return { app, worldContainer, uiContainer, resize, destroy };
}
