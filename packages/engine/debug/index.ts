import type { Store } from "@tanstack/store";
import type { Container } from "pixi.js";

import type { Viewport } from "../camera";
import { DEFAULT_LENGTH_UNIT } from "../game/defaults";
import type { DebugDrawCommand, DebugDrawSink, EngineContext, EntitySelector } from "../game/types";
import type { RunTiming } from "../runtime/timing";
import type { RuntimeTimings } from "../runtime/timings";
import type { SceneRuntimeHandle } from "../runtime/types";
import { setDebugMode } from "../store";
import type { ToolRouter } from "../tool-router";
import type { GameStoreState, Vec2 } from "../types";
import { createDebugPanel, type DebugPanel } from "./debug-panel";
import { createDebugDrawSink, debugDrawLayer } from "./draw";
import { createEventLog, type EventLogWriter } from "./event-log";
import { gridLayer } from "./grid-overlay";
import {
  inspectEntity,
  listEntities,
  pickEntity,
  type EntityInspection,
  type EntityRow,
} from "./inspect";
import { perfLayer } from "./perf";
import { physicsLayer } from "./physics-wireframes";
import { createTimingReadout } from "./timing-readout";

export { TIMING_ATTRIBUTE, TIMING_STORAGE_KEY } from "./timing-readout";
export { createDebugDrawSink, DEBUG_DRAW_MAX, debugDrawLayer } from "./draw";
export {
  createEventLog,
  EVENT_LOG_CAPACITY,
  type EventLog,
  type EventLogFilter,
  type EventLogWriter,
} from "./event-log";
export {
  inspectEntity,
  listEntities,
  pickEntity,
  type EntityInspection,
  type EntityRow,
} from "./inspect";
export {
  PERF_SLOWEST,
  perfLayer,
  perfLines,
  perfPlan,
  type PerfBar,
  type PerfPlan,
  type PerfRow,
} from "./perf";
export { TICK_PHASES, formatMs } from "../runtime/timings";
export type { RuntimeTimings, TickPhase, TimingStat } from "../runtime/timings";

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
  /** The store's `timings`, while a shown layer needs them. */
  timings?: RuntimeTimings | null;
  /** The last tick's `ctx.debug` draws, while a shown layer needs them. */
  draws?: readonly DebugDrawCommand[];
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
  /** What the shell must collect while this layer shows. */
  needs?: DebugNeeds;
  create: (host: DebugLayerHost) => DebugLayer;
};

/** `timings`: the runtime's timings in the store; `debugDraw`: game code's `ctx.debug` draws. */
export type DebugNeeds = { timings?: boolean; debugDraw?: boolean };

/** The engine's layers, before the game's. */
export const ENGINE_DEBUG_LAYERS: readonly DebugLayerFactory[] = [
  gridLayer,
  physicsLayer,
  debugDrawLayer,
  perfLayer,
];

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
  /** What the shown layers need now. */
  needs?: () => DebugNeeds;
  /** The sink the shown debug-draw layer reads; null while none shows. */
  debugDraw?: () => DebugDrawSink | null;
  /** Live inspection and the event log, for `GameInstance.debug`. */
  tools?: DebugTools;
};

/**
 * What a dev host's overlay lends `GameInstance.debug`. Every answer is
 * plain data, so the play world may later sit across a worker link.
 */
export type DebugTools = {
  inspect(runtime: SceneRuntimeHandle, id: string): EntityInspection | null;
  entities(runtime: SceneRuntimeHandle, sel?: EntitySelector): readonly EntityRow[];
  pick(runtime: SceneRuntimeHandle, p: Vec2): string | null;
  createEventLog(): EventLogWriter;
};

/** The engine's own inspection and event log. */
export function debugTools(): DebugTools {
  return {
    inspect: inspectEntity,
    entities: listEntities,
    pick: pickEntity,
    createEventLog: () => createEventLog(),
  };
}

export type DebugOverlayFactory = (deps: DebugDeps) => DebugOverlay;

export type DebugDeps = Omit<DebugLayerHost, "pxPerMetre"> & {
  /** The game's px per metre; default 100. */
  pxPerMetre?: number;
  store: Store<GameStoreState>;
  /** The shell's router; F3 registers on it above every tool. */
  router: ToolRouter;
  /** The game's layers, shown after the engine's. */
  layers?: readonly DebugLayerFactory[];
  /**
   * The shell's timing collector. With it, `localStorage["debug-timing"] =
   * "1"` switches timing on while the game runs (and off again when
   * removed), and the report is kept as JSON in a
   * `<script type="application/json" data-jams-timing>` on the page.
   */
  timing?: RunTiming;
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
  let drawSink: DebugDrawSink | null = null;

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
  const readout = deps.timing ? createTimingReadout(deps.timing) : null;

  function setPhysics(source: DebugSceneSource | null): void {
    scene = source;
  }

  function update(tick: DebugTick): void {
    const frame: DebugFrame = { ...tick, scene };
    for (let i = 0; i < shown; i++) layers[i]?.update(frame);
    readout?.update();
  }

  function needs(): DebugNeeds {
    const out: DebugNeeds = {};
    for (let i = 0; i < shown; i++) {
      const wants = factories[i]?.needs;
      if (wants?.timings) out.timings = true;
      if (wants?.debugDraw) out.debugDraw = true;
    }
    return out;
  }

  function destroy(): void {
    panel.destroy();
    readout?.destroy();
    for (const layer of layers) layer?.destroy();
    layers.fill(null);
    shown = 0;
    scene = null;
    drawSink = null;
  }

  const debugDraw = (): DebugDrawSink | null =>
    needs().debugDraw ? (drawSink ??= createDebugDrawSink()) : null;

  return { setPhysics, update, destroy, needs, debugDraw, tools: debugTools() };
}
