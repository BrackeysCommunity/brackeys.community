import type { Store } from "@tanstack/store";
import type { Container } from "pixi.js";

import type { Viewport } from "../camera";
import { DEFAULT_LENGTH_UNIT } from "../game/defaults";
import type { EngineContext } from "../game/types";
import { setDebugMode } from "../store";
import type { ToolRouter } from "../tool-router";
import type { GameStoreState, Vec2 } from "../types";
import { createDebugPanel, type DebugPanel } from "./debug-panel";
import { gridLayer } from "./grid-overlay";
import { physicsLayer } from "./physics-wireframes";

/** The loaded scene's world, as the physics wireframes and the grid read it. */
export type DebugSceneSource = Pick<EngineContext, "physics" | "geometry" | "tags" | "registry"> &
  Partial<Pick<EngineContext, "grid">>;

/** What every visible layer gets each shell tick. */
export type DebugFrame = {
  dtMs: number;
  /** World metres. */
  mouseWorld: Vec2;
  /** World metres. */
  viewport: Viewport;
  /** Canvas px per world metre, zoom included: a layer's line widths and labels divide screen px by it. */
  scale: number;
  /** The game's `debugInfo()`; null without a scene or when the game supplies none. */
  info: unknown;
  /** The world bound by `setPhysics`; null without a scene. */
  scene: DebugSceneSource | null;
};

/** What the shell hands the overlay each tick; the overlay adds the bound scene. */
export type DebugTick = Omit<DebugFrame, "scene">;

/**
 * Where a layer adds its containers: the camera-affected world (world
 * metres), or the screen-fixed UI (canvas px). `pxPerMetre` is the game's.
 */
export type DebugLayerHost = {
  worldContainer: Container;
  uiContainer: Container;
  pxPerMetre: number;
};

export type DebugLayer = {
  update: (frame: DebugFrame) => void;
  setVisible: (visible: boolean) => void;
  destroy: () => void;
};

/**
 * A debug layer, created the first time F3 reaches its mode. Its id is that
 * mode's name; each mode shows its own layer and every layer before it.
 */
export type DebugLayerFactory = {
  id: string;
  create: (host: DebugLayerHost) => DebugLayer;
};

/** The engine's layers, before the game's. */
export const ENGINE_DEBUG_LAYERS: readonly DebugLayerFactory[] = [gridLayer, physicsLayer];

export const DEBUG_OFF = "off";

/** F3's cycle: `off`, then one mode per layer in order. */
export function debugModes(layers: readonly DebugLayerFactory[]): string[] {
  const modes = [DEBUG_OFF];
  for (const layer of layers) {
    if (modes.includes(layer.id)) throw new Error(`duplicate debug layer "${layer.id}"`);
    modes.push(layer.id);
  }
  return modes;
}

export type DebugOverlay = {
  /** Binds the loaded scene's world; every layer reads it until the next call. */
  setPhysics: (source: DebugSceneSource | null) => void;
  update: (tick: DebugTick) => void;
  destroy: () => void;
};

export type DebugOverlayFactory = (deps: DebugDeps) => DebugOverlay;

export type DebugDeps = Omit<DebugLayerHost, "pxPerMetre"> & {
  /** The game's px per metre; default 100. */
  pxPerMetre?: number;
  store: Store<GameStoreState>;
  /** The shell's router; F3 registers on it above every tool. */
  router: ToolRouter;
  /** The game's layers, shown after the engine's. */
  layers?: readonly DebugLayerFactory[];
};

/** Creates the debug overlay. Hosts only call it in dev builds. */
export function createDebugOverlay(deps: DebugDeps): DebugOverlay {
  const { store, router } = deps;
  const host: DebugLayerHost = {
    worldContainer: deps.worldContainer,
    uiContainer: deps.uiContainer,
    pxPerMetre: deps.pxPerMetre ?? DEFAULT_LENGTH_UNIT,
  };
  const factories = [...ENGINE_DEBUG_LAYERS, ...(deps.layers ?? [])];
  const modes = debugModes(factories);
  const layers: (DebugLayer | null)[] = factories.map(() => null);
  let shown = 0;
  let scene: DebugSceneSource | null = null;

  function applyMode(mode: string): void {
    shown = Math.max(0, modes.indexOf(mode));
    setDebugMode(store, modes[shown] ?? DEBUG_OFF);
    factories.forEach((factory, i) => {
      const visible = i < shown;
      if (visible) layers[i] ??= factory.create(host);
      layers[i]?.setVisible(visible);
    });
  }

  const panel: DebugPanel = createDebugPanel(router, modes, applyMode);

  function setPhysics(source: DebugSceneSource | null): void {
    scene = source;
  }

  function update(tick: DebugTick): void {
    const frame: DebugFrame = { ...tick, scene };
    for (let i = 0; i < shown; i++) layers[i]?.update(frame);
  }

  function destroy(): void {
    panel.destroy();
    for (const layer of layers) layer?.destroy();
    layers.fill(null);
    shown = 0;
    scene = null;
  }

  return { setPhysics, update, destroy };
}
