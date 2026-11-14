import { Application, Container, Graphics, Rectangle } from "pixi.js";

import { resetCanvasBlendOnTargetChange } from "./render/canvas-blend";
import { DEFAULT_RESOLUTION, viewportFor, type ResolutionPolicy } from "./resolution";
import type { GameConfig, GameInstance, RenderBackend, Vec2 } from "./types";
import { createUiLayer } from "./ui/layer";

export type Renderer = {
  /** The current Pixi app; a rebuild after a lost context replaces it. */
  readonly app: Application;
  /** The camera maps it from world metres to canvas px. */
  worldContainer: Container;
  uiContainer: Container;
  resize: (width: number, height: number) => void;
  /** The canvas pixel under each world point (metres), through the world container's current transform. */
  extractPixels: GameInstance["extractPixels"];
  destroy: () => void;
};

/** What the renderer tells its shell about a lost GPU context; the shell pauses and resumes around it. */
export type RendererHooks = {
  lost?: (backend: RenderBackend) => void;
  restored?: (backend: RenderBackend, rebuilt: boolean) => void;
  fallback?: (reason: "init" | "lost") => void;
  /** The rebuild after a loss failed: nothing draws again, and `restored` never follows. */
  failed?: (backend: RenderBackend, error: unknown) => void;
  /** Runs on a rebuilt renderer before `restored`, so resident textures upload to it. */
  rebuilt?: () => void;
  /** Where the lost overlay goes; none is shown without one. */
  layer?: () => HTMLElement | null;
  /** Around each render Pixi runs: `begin` before it walks the stage, `end` once it has drawn. */
  draw?: { begin(): void; end(): void };
};

/** How long a lost WebGL context may take to come back before the renderer is rebuilt. */
export const CONTEXT_RESTORE_MS = 3000;

type WebGpuDevice = { lost?: Promise<{ reason?: string }> };

/** Pixi's runners around `renderer.render`; each calls the method of its own name on what was added. */
type RenderRunners = Record<"prerender" | "postrender", { add(item: object): unknown }>;

function backendOf(app: Application): RenderBackend {
  return (app.renderer as { name?: string } | undefined)?.name === "webgpu" ? "webgpu" : "webgl";
}

/** A centred status line over the game. */
function statusOverlay(layer: HTMLElement, text: string): { destroy(): void } {
  const line = layer.ownerDocument.createElement("div");
  line.setAttribute("role", "status");
  line.textContent = text;
  Object.assign(line.style, {
    position: "absolute",
    inset: "0",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0, 0, 0, 0.6)",
    color: "#fff",
    font: "500 16px system-ui, sans-serif",
  });
  layer.append(line);
  return { destroy: () => line.remove() };
}

const defaultLostOverlay = (layer: HTMLElement) => statusOverlay(layer, "Restoring graphics…");

/** What replaces the lost overlay when drawing can't come back. */
const RENDER_FAILED_TEXT = "Graphics stopped working. Reload the page to continue.";

/**
 * The Pixi app, antialiased as `resolution` says, with the world under the
 * policy's bars (in `bars`, default the background) and the UI over both.
 *
 * A WebGPU init failure retries with WebGL. A lost context pauses drawing
 * behind an overlay: a WebGL context that comes back within
 * `CONTEXT_RESTORE_MS` is rebuilt in place by Pixi; otherwise, and on any
 * WebGPU device loss, the app is replaced by a WebGL one drawing on a fresh
 * canvas laid over the host's (a lost or WebGPU canvas can't give a new
 * WebGL context), and stays WebGL for the session.
 */
export async function createRenderer(
  canvas: HTMLCanvasElement,
  config: GameConfig,
  resolution: ResolutionPolicy = DEFAULT_RESOLUTION,
  hooks: RendererHooks = {},
): Promise<Renderer> {
  let size = { width: config.displayWidth, height: config.displayHeight };

  async function build(target: HTMLCanvasElement, preference: RenderBackend) {
    const next = new Application();
    await next.init({
      canvas: target,
      preference,
      width: size.width,
      height: size.height,
      backgroundColor: config.backgroundColor,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      antialias: resolution.antialias ?? true,
    });
    resetCanvasBlendOnTargetChange(next.renderer);
    if (hooks.draw) {
      const { runners } = (next.renderer ?? {}) as { runners?: Partial<RenderRunners> };
      const { draw } = hooks;
      runners?.prerender?.add({ prerender: () => draw.begin() });
      runners?.postrender?.add({ postrender: () => draw.end() });
    }
    return next;
  }

  const preference = config.renderer?.preference ?? "webgpu";
  let app: Application;
  try {
    app = await build(canvas, preference);
  } catch (error) {
    if (preference !== "webgpu") throw error;
    app = await build(canvas, "webgl");
    hooks.fallback?.("init");
  }

  // Stage hierarchy: world (camera-affected), the bars over it, and UI (screen-fixed)
  const worldContainer = new Container();
  worldContainer.label = "world";

  const bars = new Graphics();
  bars.label = "bars";
  const barColor = resolution.bars ?? config.backgroundColor;

  const uiContainer = new Container();
  uiContainer.label = "ui";

  function attachStage(to: Application): void {
    to.stage.addChild(worldContainer);
    to.stage.addChild(bars);
    to.stage.addChild(uiContainer);
  }
  attachStage(app);

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

  drawBars(size.width, size.height);

  // ─── Context loss ─────────────────────────────────────────

  let destroyed = false;
  /** The canvas the current app draws on: the host's, or a stand-in after a rebuild. */
  let surface = canvas;
  let standIn: { root: HTMLElement; destroy(): void } | null = null;
  let lost: RenderBackend | null = null;
  let rebuilding = false;
  /** The rebuild failed: `app` is torn down and nothing draws again. */
  let failed = false;
  let restoreTimer: ReturnType<typeof setTimeout> | null = null;
  let overlay: { root: HTMLElement; shown: { destroy(): void } } | null = null;
  let unlisten: () => void = () => {};

  function showOverlay(draw = config.renderer?.lostOverlay ?? defaultLostOverlay): void {
    if (overlay) return;
    const layer = hooks.layer?.();
    if (!layer) return;
    const root = layer.ownerDocument.createElement("div");
    root.setAttribute("data-jams-render-lost", "");
    Object.assign(root.style, { position: "absolute", inset: "0" });
    layer.append(root);
    overlay = { root, shown: draw(root) };
  }

  function hideOverlay(): void {
    if (!overlay) return;
    overlay.shown.destroy();
    overlay.root.remove();
    overlay = null;
  }

  function clearRestoreTimer(): void {
    if (restoreTimer !== null) clearTimeout(restoreTimer);
    restoreTimer = null;
  }

  function listen(to: Application, on: HTMLCanvasElement): void {
    unlisten();
    const onGlLost = (event: Event) => {
      event.preventDefault();
      onLost("webgl");
    };
    const onGlRestored = () => {
      if (lost !== "webgl" || rebuilding) return;
      clearRestoreTimer();
      lost = null;
      to.start?.();
      hideOverlay();
      hooks.restored?.("webgl", false);
    };
    on.addEventListener("webglcontextlost", onGlLost);
    on.addEventListener("webglcontextrestored", onGlRestored);
    let live = true;
    const device = (to.renderer as { gpu?: { device?: WebGpuDevice } } | undefined)?.gpu?.device;
    void device?.lost?.then(() => {
      if (live && app === to) onLost("webgpu");
    });
    unlisten = () => {
      live = false;
      on.removeEventListener("webglcontextlost", onGlLost);
      on.removeEventListener("webglcontextrestored", onGlRestored);
    };
  }

  function onLost(backend: RenderBackend): void {
    if (destroyed || lost) return;
    lost = backend;
    app.stop?.();
    hooks.lost?.(backend);
    showOverlay();
    if (backend === "webgpu") void rebuild();
    else restoreTimer = setTimeout(() => void rebuild(), CONTEXT_RESTORE_MS);
  }

  /** Drops `old`; `keepStage` lifts the world, bars and UI out first so a rebuilt app takes them on. */
  function teardown(old: Application, keepStage: boolean): void {
    unlisten();
    if (keepStage) old.stage.removeChild(worldContainer, bars, uiContainer);
    try {
      // Pass false for removeView — the host owns the canvas DOM element, not PixiJS.
      // Passing true causes Strict Mode double-mount to fail (canvas removed on first cleanup).
      old.destroy(false, { children: true });
    } catch {
      // A lost device may refuse parts of its own teardown; the app is dropped either way.
    }
  }

  function freshSurface(): HTMLCanvasElement {
    standIn?.destroy();
    standIn = null;
    if (!canvas.parentElement) return canvas;
    const layer = createUiLayer(canvas);
    layer.root.removeAttribute("data-jams-ui");
    layer.root.setAttribute("data-jams-renderer", "");
    const next = canvas.ownerDocument.createElement("canvas");
    next.style.display = "block";
    layer.root.append(next);
    standIn = layer;
    return next;
  }

  async function rebuild(): Promise<void> {
    clearRestoreTimer();
    if (destroyed || rebuilding || failed) return;
    const from = lost ?? backendOf(app);
    rebuilding = true;
    teardown(app, true);
    let next: Application;
    try {
      surface = freshSurface();
      next = await build(surface, "webgl");
    } catch (error) {
      rebuilding = false;
      failed = true;
      console.error("[renderer] couldn't rebuild after a lost GPU context", error);
      hideOverlay();
      if (!destroyed) {
        showOverlay((layer) => statusOverlay(layer, RENDER_FAILED_TEXT));
        hooks.failed?.(from, error);
      }
      return;
    }
    rebuilding = false;
    if (destroyed) {
      next.destroy(false, { children: true });
      return;
    }
    app = next;
    attachStage(app);
    app.renderer.resize(size.width, size.height);
    drawBars(size.width, size.height);
    listen(app, surface);
    lost = null;
    hooks.rebuilt?.();
    if (from === "webgpu") hooks.fallback?.("lost");
    hideOverlay();
    hooks.restored?.("webgl", true);
  }

  listen(app, surface);

  // ─── Surface ──────────────────────────────────────────────

  function resize(width: number, height: number): void {
    size = { width, height };
    if (rebuilding || failed) return;
    app.renderer.resize(width, height);
    drawBars(width, height);
  }

  function extractPixels(world: readonly Vec2[]): ReturnType<GameInstance["extractPixels"]> {
    if (rebuilding || failed) return { renderer: lost ?? "webgl", pixels: world.map(() => null) };
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
    if (destroyed) return;
    destroyed = true;
    clearRestoreTimer();
    hideOverlay();
    if (!rebuilding && !failed) teardown(app, false);
    else {
      unlisten();
      for (const node of [worldContainer, bars, uiContainer]) node.destroy({ children: true });
    }
    standIn?.destroy();
    standIn = null;
  }

  return {
    get app() {
      return app;
    },
    worldContainer,
    uiContainer,
    resize,
    extractPixels,
    destroy,
  };
}
