import type { Store } from "@tanstack/store";
import { Container } from "pixi.js";

import { initAssets } from "./assets";
import { createCamera } from "./camera";
import type { DebugOverlay } from "./debug";
import { type ConstructType, CONSTRUCT_CONFIGS } from "./entities/shaper-constructs";
import { GameEventEmitter } from "./events";
import { createInputSystem } from "./input";
import { createGameLoop } from "./loop";
import { createRenderer } from "./renderer";
import { createSceneRuntime, type SceneRuntimeHandle } from "./runtime/runtime";
import type { LoadReport } from "./runtime/types";
import type { ExpandedScene } from "./scene/types";
import {
  createGameStore,
  incrementTick,
  removePlayer,
  resetGameStore,
  setFPS,
  setMode as setStoreMode,
  setPhase,
  updateCamera,
  updatePlayer,
} from "./store";
import { createShaperSystem, type ShaperSystem } from "./systems/shaper";
import type {
  GameConfig,
  GameEventMap,
  GameInstance,
  GameMode,
  GameStoreState,
  RapierModule,
} from "./types";
import { DEFAULT_GAME_CONFIG } from "./types";

const loadDefaultRapier = (): Promise<RapierModule> => import("@dimforge/rapier2d");

export async function createGame(
  canvas: HTMLCanvasElement,
  config?: Partial<GameConfig>,
): Promise<GameInstance> {
  const cfg: GameConfig = { ...DEFAULT_GAME_CONFIG, ...config };

  // ─── Initialize subsystems ────────────────────────────────

  const store = createGameStore();
  const events = new GameEventEmitter();

  setPhase(store, "loading");

  // Renderer (must be created first — Application.init() initializes Assets internally)
  const renderer = await createRenderer(canvas, cfg);

  // Register asset bundles (after renderer so Assets is already initialized)
  await initAssets();

  // Camera (display dimensions drive the expand-viewport scaling)
  const camera = createCamera(
    renderer.worldContainer,
    cfg.displayWidth,
    cfg.displayHeight,
    cfg.camera,
  );

  const rapier = await (cfg.rapier ?? loadDefaultRapier)();
  const input = createInputSystem(cfg.bindings);

  // Each loaded scene draws into its own container inside this layer, so a
  // reload never reorders it against the debug overlay.
  const sceneLayer = new Container();
  sceneLayer.label = "scene";
  renderer.worldContainer.addChild(sceneLayer);

  let debugOverlay: DebugOverlay | null = null;
  if (cfg.dev && cfg.debug) {
    debugOverlay = cfg.debug({
      worldContainer: renderer.worldContainer,
      uiContainer: renderer.uiContainer,
      camera,
      store,
      physics: null,
      inputTarget: window,
    });
  }

  // ─── Scene runtime (one at a time) ────────────────────────

  let runtime: SceneRuntimeHandle | null = null;
  let runtimeView: Container | null = null;
  let shaper: ShaperSystem | null = null;
  let shaperMode = false;

  function teardownRuntime(): void {
    shaper?.destroy();
    shaper = null;
    debugOverlay?.setPhysics(null);
    runtime?.destroy();
    runtimeView?.destroy({ children: true });
    runtime = null;
    runtimeView = null;
    removePlayer(store, "local");
  }

  function loadScene(scene: ExpandedScene): LoadReport {
    if (destroyed) return { ok: false, error: "game destroyed" };

    const view = new Container();
    view.label = `scene:${scene.name}`;
    const next = createSceneRuntime({
      rapier,
      view: { world: view },
      dev: cfg.dev,
      now: () => performance.now(),
    });
    const report = next.load(scene);
    if (!report.ok) {
      next.destroy();
      view.destroy({ children: true });
      if (cfg.dev) console.warn(`[scene] load failed: ${report.error}`, report);
      return report;
    }

    teardownRuntime();
    runtime = next;
    runtimeView = view;
    sceneLayer.addChild(view);
    shaper = createShaperSystem({
      view,
      constructs: next.constructs,
      anchors: next.anchors,
      bounds: next.ctx.bounds,
    });
    shaper.setActive(shaperMode);
    debugOverlay?.setPhysics({ physics: next.ctx.physics, tags: next.ctx.tags });

    const player = next.player();
    if (player) {
      updatePlayer(store, "local", {
        id: "local",
        position: player.getPosition(),
        velocity: { x: 0, y: 0 },
      });
    }
    return report;
  }

  function unloadScene(): void {
    teardownRuntime();
  }

  function getMode(): GameMode {
    return store.state.mode;
  }

  function setMode(mode: GameMode): void {
    const prev = getMode();
    if (prev === mode) return;
    setStoreMode(store, mode);
    input.setEnabled(mode === "play");
    if (mode === "edit") {
      shaperMode = false;
      shaper?.setActive(false);
      shaper?.clearSelection();
      const scene = runtime?.scene();
      if (prev === "play" && scene) loadScene(scene);
    }
  }

  // ─── Shaper input handling ────────────────────────

  function setupShaperInput(): void {
    window.addEventListener("keydown", onShaperKeyDown);
    window.addEventListener("mousedown", onShaperMouseDown);
    window.addEventListener("wheel", onShaperWheel, { passive: true });
  }

  function onShaperKeyDown(e: KeyboardEvent): void {
    if (!shaper || getMode() !== "play") return;

    if (e.key === "Tab") {
      e.preventDefault();
      shaperMode = !shaperMode;
      shaper.setActive(shaperMode);
      if (!shaperMode) shaper.clearSelection();
      return;
    }

    if (!shaperMode) return;

    // Number keys select construct type
    const hotkeyNum = parseInt(e.key);
    if (hotkeyNum >= 1 && hotkeyNum <= 6) {
      const entry = Object.entries(CONSTRUCT_CONFIGS).find(([, c]) => c.hotkey === hotkeyNum);
      if (entry) shaper.selectType(entry[0] as ConstructType);
    }

    if (e.key === "Escape" && shaper.getSelectedType()) {
      // Consumed here, so an editor listening for Escape doesn't also stop play.
      e.preventDefault();
      shaper.clearSelection();
    }
  }

  function onShaperMouseDown(e: MouseEvent): void {
    if (!shaper || !shaperMode || getMode() !== "play" || !shaper.getSelectedType()) return;
    if (e.button === 0) {
      const result = shaper.place();
      if (!result.valid && cfg.dev) {
        console.log(`[shaper] placement rejected: ${result.reason}`);
      }
    } else if (e.button === 2) {
      shaper.clearSelection();
    }
  }

  function onShaperWheel(e: WheelEvent): void {
    if (!shaper || !shaperMode || getMode() !== "play") return;
    shaper.rotatePreview(e.deltaY > 0 ? 1 : -1);
  }

  // ─── Game loop ────────────────────────────────────────────

  const loop = createGameLoop({
    tickRate: cfg.targetFPS,

    onTick(dt: number) {
      const actions = input.poll(store.state.tick);
      const mouseWorld = camera.screenToWorld(input.getMousePosition());

      if (runtime && getMode() === "play") {
        if (shaperMode) shaper?.updatePreview(mouseWorld, dt);
        const result = runtime.step(dt, actions);
        if (cfg.dev) {
          for (const evt of result.events) {
            if (evt.type !== "landed" && evt.type !== "left-ground") {
              console.log(`[scene] ${evt.type}`, evt);
            }
          }
        }
        incrementTick(store);
      }

      const player = runtime?.player() ?? null;
      camera.update(dt, player ? player.getPosition() : camera.getPosition());

      if (player) {
        updatePlayer(store, "local", {
          position: player.getPosition(),
          velocity: player.getVelocity(),
        });
      }
      updateCamera(store, { position: camera.getPosition() });

      debugOverlay?.update(
        dt,
        player && {
          position: player.getPosition(),
          velocity: player.getVelocity(),
          grounded: player.isGrounded(),
          holdingJump: player.isHoldingJump(),
          holdingMove: player.isHoldingMove(),
          wallSliding: player.isWallSliding(),
          wallDirection: player.getWallDirection(),
          preUpdate: player.getPreUpdateState(),
        },
        mouseWorld,
      );

      events.emit("game:tick", { tick: store.state.tick });
    },

    onRender(_alpha: number) {
      // Future: interpolate visual positions between physics ticks
      // For now, PixiJS renders automatically via its ticker (driven by rAF)
      setFPS(store, loop.getFPS());
    },
  });

  // ─── Public API ───────────────────────────────────────────

  let destroyed = false;

  function start(): void {
    if (destroyed) return;
    setPhase(store, "running");
    input.attach(window);
    setupShaperInput();
    loop.start();
    events.emit("game:start");
  }

  function resize(width: number, height: number): void {
    if (destroyed) return;
    renderer.resize(width, height);
    camera.resize(width, height);
  }

  function destroy(): void {
    if (destroyed) return;
    destroyed = true;

    loop.stop();
    window.removeEventListener("keydown", onShaperKeyDown);
    window.removeEventListener("mousedown", onShaperMouseDown);
    window.removeEventListener("wheel", onShaperWheel);
    debugOverlay?.destroy();
    teardownRuntime();
    input.destroy();
    camera.destroy();
    renderer.destroy();

    events.emit("game:destroy");
    events.destroy();

    resetGameStore(store);
    setPhase(store, "destroyed");
  }

  function on<K extends keyof GameEventMap>(
    event: K,
    handler: (payload: GameEventMap[K]) => void,
  ): void {
    events.on(event, handler);
  }

  function off<K extends keyof GameEventMap>(
    event: K,
    handler: (payload: GameEventMap[K]) => void,
  ): void {
    events.off(event, handler);
  }

  function getStore(): Store<GameStoreState> {
    return store;
  }

  if (cfg.scene) {
    const report = loadScene(cfg.scene);
    if (!report.ok) {
      destroy();
      throw new Error(`scene "${cfg.scene.name}" failed to load: ${report.error}`);
    }
  }

  setPhase(store, "idle");

  return { start, destroy, resize, on, off, getStore, loadScene, unloadScene, setMode, getMode };
}
