import type { Store } from "@tanstack/store";
import { Container } from "pixi.js";

import { initAssets } from "./assets";
import { createCamera } from "./camera";
import type { DebugOverlay } from "./debug";
import { GameEventEmitter } from "./events";
import type { GameAttachment, GameOutcome, GameShell } from "./game/types";
import type { PlayOptions } from "./headless/playtest-types";
import { createInputSystem } from "./input";
import { createGameLoop } from "./loop";
import { createPixiView, type PixiView } from "./render/pixi-view";
import { createRenderer } from "./renderer";
import { createSessionRecording, preparePlay, type SessionRecording } from "./runtime/play-session";
import { createSceneRuntime, resolveGame, type ProjectOption } from "./runtime/runtime";
import type { LoadReport, SceneRuntimeHandle, StepResult } from "./runtime/types";
import { expandScene, isExpandedScene } from "./scene/expand";
import type { RunRecording } from "./scene/recording-schema";
import type { Aabb, ExpandedScene, PrefabLibrary, SceneDefinition } from "./scene/types";
import {
  createGameStore,
  incrementTick,
  resetGameStore,
  setFPS,
  setGameSlice,
  setMode as setStoreMode,
  setPhase,
  setSession,
  setSimPaused,
  setSimTimeScale,
  updateCamera,
} from "./store";
import { createToolRouter, resolveInputTarget } from "./tool-router";
import type {
  CameraState,
  GameConfig,
  GameEventMap,
  GameInstance,
  GameMode,
  GameStoreState,
  PlayReport,
  Vec2,
} from "./types";
import { DEFAULT_GAME_CONFIG } from "./types";

/** The scene that is playing: its runtime, the view it draws into, and the game's tools on it. */
type LoadedScene = {
  runtime: SceneRuntimeHandle;
  view: PixiView;
  attachment: GameAttachment | null;
};

/** `config.project` is what every scene's game reads as `EngineContext.project`; null without one. */
export async function createGame(
  canvas: HTMLCanvasElement,
  config: Partial<GameConfig> & Pick<GameConfig, "game" | "rapier"> & ProjectOption,
): Promise<GameInstance> {
  const { project = null, ...rest } = config;
  const cfg: GameConfig = { ...DEFAULT_GAME_CONFIG, ...rest };
  const { game } = cfg;
  // Resolved before any rendering, so a malformed game fails fast; every scene's runtime shares it.
  const { registry } = resolveGame({ game, registry: cfg.registry });

  // ─── Initialize subsystems ────────────────────────────────

  const store = createGameStore();
  const events = new GameEventEmitter();
  let destroyed = false;

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

  const rapier = await cfg.rapier();
  const input = createInputSystem(cfg.bindings ?? game.actions);
  const inputTarget = resolveInputTarget(canvas, cfg.inputTarget);
  const keyTarget = cfg.keyTarget ?? inputTarget;
  const router = createToolRouter();
  router.register(input.consumer());

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
      store,
      router,
      layers: cfg.debugLayers,
    });
  }

  // ─── Scene runtime (one at a time) ────────────────────────

  let loaded: LoadedScene | null = null;

  function syncGameSlice(): void {
    setGameSlice(store, loaded?.runtime.game?.storeSlice?.() ?? null);
  }

  function teardownScene(): void {
    if (!loaded) return;
    debugOverlay?.setPhysics(null);
    loaded.attachment?.destroy();
    loaded.runtime.destroy();
    loaded.view.destroy();
    loaded = null;
    syncGameSlice();
  }

  /**
   * Builds a fresh world for `scene` and swaps it in; on failure the current
   * one keeps running. Unless `snap` says otherwise, the camera snaps to the
   * game's target in play mode and on the first load; in edit mode it stays
   * where the editor put it.
   */
  function buildWorld(scene: ExpandedScene, play?: PlayOptions, snap?: boolean): LoadReport {
    if (destroyed) return { ok: false, error: "game destroyed" };
    const container = new Container();
    container.label = `scene:${scene.name}`;
    const view = createPixiView(container);
    const runtime = createSceneRuntime({
      rapier,
      view,
      game,
      registry,
      dev: cfg.dev,
      now: () => performance.now(),
      project,
    });
    const report = runtime.load(scene, play);
    if (!report.ok) {
      runtime.destroy();
      view.destroy();
      if (cfg.dev) console.warn(`[scene] load failed: ${report.error}`, report);
      return report;
    }

    const first = loaded === null;
    teardownScene();
    sceneLayer.addChild(container);
    const shell: GameShell = { view, router, dev: cfg.dev, getMode };
    loaded = { runtime, view, attachment: game.attach?.(shell, runtime) ?? null };
    debugOverlay?.setPhysics(runtime.ctx);
    syncGameSlice();
    camera.setBoundsFromScene(scene.bounds);
    if (snap ?? (first || getMode() === "play")) {
      camera.snapTo(runtime.game?.cameraTarget?.() ?? null);
    }
    updateCamera(store, camera.getState());
    return report;
  }

  let prefabs: PrefabLibrary = cfg.prefabs ?? new Map();

  function loadScene(source: SceneDefinition | ExpandedScene): LoadReport {
    if (destroyed) return { ok: false, error: "game destroyed" };
    let scene: ExpandedScene;
    try {
      scene = isExpandedScene(source) ? source : expandScene(source, registry, { prefabs });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (cfg.dev) console.warn(`[scene] expand failed: ${message}`);
      return { ok: false, error: message };
    }
    return buildWorld(scene);
  }

  function getMode(): GameMode {
    return store.state.mode;
  }

  // ─── Edit and play ────────────────────────────────────────

  /** What Stop brings back: the edit world's scene and the editor camera, taken at Play. */
  let editState: { scene: ExpandedScene | null; camera: CameraState } | null = null;

  function enterMode(mode: GameMode): void {
    setStoreMode(store, mode);
    input.setEnabled(mode === "play");
    camera.setMode(mode === "play" ? "follow" : "free");
    updateCamera(store, camera.getState());
    loaded?.attachment?.onModeChange?.(mode);
    if (mode === "play" && store.state.phase === "running") focusInput();
  }

  function startPlay(scene: ExpandedScene, opts: PlayOptions = {}): PlayReport {
    const playing = getMode() === "play" && editState !== null;
    const remembered = playing
      ? editState
      : { scene: loaded?.runtime.scene() ?? null, camera: camera.getState() };
    const report = buildWorld(scene, opts, true);
    if (!report.ok) {
      const out: PlayReport = { ok: false, issues: [], error: report.error };
      if (report.reason) out.reason = report.reason;
      return out;
    }
    editState = remembered;
    input.flush();
    enterMode("play");
    setSession(store, { startTick: store.state.tick, outcome: null });
    return { ok: true, issues: [] };
  }

  /** The session's recording while playing; after Stop, `lastRecording` keeps what it finished. */
  let session: SessionRecording | null = null;
  let lastRecording: RunRecording | null = null;

  function finishRecording(recording: RunRecording | null): void {
    if (!recording) return;
    lastRecording = recording;
    events.emit("play:recorded", recording);
  }

  function playRecorded(
    doc: SceneDefinition,
    opts: PlayOptions,
    replay?: RunRecording,
  ): PlayReport {
    if (destroyed) return { ok: false, issues: [], error: "game destroyed" };
    const prepared = preparePlay(doc, registry, { dev: cfg.dev, prefabs });
    if (!prepared.ok) return { ok: false, issues: prepared.issues };
    finishRecording(session?.stop() ?? null);
    session = null;
    const report = startPlay(prepared.scene, opts);
    if (report.ok) {
      session = createSessionRecording({
        rapier,
        game,
        scene: doc.name,
        sceneHash: prepared.hash,
        start: opts,
        ...(replay ? { replay } : {}),
      });
      if (replay && loop.isPaused()) resume();
    }
    return { ...report, issues: prepared.issues };
  }

  function play(doc: SceneDefinition, opts: PlayOptions = {}): PlayReport {
    return playRecorded(doc, opts);
  }

  function replay(doc: SceneDefinition, recording: RunRecording): PlayReport {
    const opts: PlayOptions = {};
    if (recording.start.at) opts.at = { x: recording.start.at[0], y: recording.start.at[1] };
    if (recording.start.timeOffsetMs !== undefined)
      opts.timeOffsetMs = recording.start.timeOffsetMs;
    if (recording.start.game !== undefined) opts.game = recording.start.game;
    return playRecorded(doc, opts, recording);
  }

  function stop(): void {
    if (destroyed || getMode() !== "play") return;
    finishRecording(session?.stop() ?? null);
    session = null;
    const remembered = editState;
    editState = null;
    const scene = remembered?.scene ?? loaded?.runtime.scene() ?? null;
    if (!scene || !buildWorld(scene, undefined, false).ok) teardownScene();
    input.flush();
    enterMode("edit");
    if (remembered) restoreCamera(remembered.camera);
    setSession(store, null);
    // Edit mode's camera and overlays tick too, so the loop runs on at 1x.
    loop.setTimeScale(1);
    if (!pausedWhileHidden) loop.resume();
    syncSim();
  }

  function restoreCamera(state: CameraState): void {
    camera.setBounds(state.bounds.min, state.bounds.max);
    camera.setZoom(state.zoom);
    camera.setMode(state.mode);
    camera.snapTo(state.position);
    updateCamera(store, camera.getState());
  }

  function setMode(mode: GameMode): void {
    if (getMode() === mode) return;
    if (mode === "edit") return stop();
    session = null;
    const scene = loaded?.runtime.scene();
    if (scene) startPlay(scene);
    else enterMode("play");
  }

  /** The game's first verdict on this tick, recorded once per session. */
  function judge(result: StepResult): GameOutcome | null {
    const current = store.state.session;
    const hooks = game.play;
    if (!current || current.outcome || !hooks?.outcome) return null;
    const verdict = hooks.outcome({
      tick: result.tick,
      snapshot: result.game,
      events: result.events,
    });
    if (!verdict) return null;
    const recorded = { ...verdict, tick: result.tick };
    setSession(store, { ...current, outcome: recorded });
    events.emit("play:outcome", recorded);
    return verdict;
  }

  // ─── Game loop ────────────────────────────────────────────

  const loop = createGameLoop({
    tickRate: cfg.targetFPS,
    maxDeltaMs: cfg.maxDeltaTime,

    onTick(dt: number) {
      const polled = input.poll(store.state.tick);
      const mouseWorld = camera.screenToWorld(input.getMousePosition());

      if (loaded && getMode() === "play") {
        const actions = session ? session.actions(loaded.runtime.ctx.tick, polled) : polled;
        loaded.attachment?.onTick?.(dt, mouseWorld);
        const result = loaded.runtime.step(dt, actions);
        incrementTick(store);
        events.emit("scene:step", result);
        const verdict = judge(result);
        if (session) {
          const wasReplay = session.replaying;
          const finished = session.stepped(result, actions, verdict);
          finishRecording(finished);
          // A replay holds its last frame until Stop, so the end state can be looked at.
          if (finished && wasReplay) pause();
        }
      }

      const hooks = loaded?.runtime.game ?? null;
      camera.update(dt, hooks?.cameraTarget?.() ?? null);
      syncGameSlice();
      updateCamera(store, { position: camera.getPosition() });

      debugOverlay?.update({
        dtMs: dt,
        mouseWorld,
        viewport: camera.getViewport(),
        info: hooks?.debugInfo?.() ?? null,
      });

      events.emit("game:tick", { tick: store.state.tick });
    },

    onRender(_alpha: number) {
      // Future: interpolate visual positions between physics ticks
      // For now, PixiJS renders automatically via its ticker (driven by rAF)
      setFPS(store, loop.getFPS());
    },
  });

  // ─── Simulation controls ──────────────────────────────────

  // A hidden tab gets no frames; pausing keeps its return from catching up the gap in one burst.
  let pausedWhileHidden = false;

  function syncSim(): void {
    setSimPaused(store, loop.isPaused());
    setSimTimeScale(store, loop.getTimeScale());
  }

  function pause(): void {
    if (destroyed || loop.isPaused()) return;
    loop.pause();
    syncSim();
    events.emit("game:pause");
  }

  function resume(): void {
    if (destroyed) return;
    loop.resume();
    syncSim();
  }

  function step(n = 1): void {
    if (destroyed || getMode() !== "play") return;
    loop.step(n);
  }

  function setTimeScale(scale: number): void {
    loop.setTimeScale(scale);
    syncSim();
  }

  function command(name: string): boolean {
    return loaded?.attachment?.onCommand?.(name) ?? false;
  }

  function cancel(): boolean {
    return getMode() === "play" && (loaded?.attachment?.onCancel?.() ?? false);
  }

  function pointerWorld(): Vec2 | null {
    return input.hasPointer() ? camera.screenToWorld(input.getMousePosition()) : null;
  }

  // ─── Editor camera ────────────────────────────────────────

  /** Screen px from a frame's edges to what it frames, unless the host says otherwise. */
  const FRAME_MARGIN_PX = 48;

  function moveCamera(to: Vec2): void {
    camera.snapTo(to);
    updateCamera(store, camera.getState());
  }

  function panBy(delta: Vec2): void {
    if (destroyed) return;
    const scale = camera.getDisplayScale() * camera.getState().zoom;
    const at = camera.getPosition();
    moveCamera({ x: at.x - delta.x / scale, y: at.y - delta.y / scale });
  }

  function zoomAt(screen: Vec2, factor: number): void {
    if (destroyed || !(factor > 0) || !Number.isFinite(factor)) return;
    const before = camera.screenToWorld(screen);
    camera.setZoom(camera.getState().zoom * factor);
    const after = camera.screenToWorld(screen);
    const at = camera.getPosition();
    moveCamera({ x: at.x + before.x - after.x, y: at.y + before.y - after.y });
  }

  function frame(rect: Aabb, marginPx = FRAME_MARGIN_PX): void {
    if (destroyed) return;
    const w = rect.maxX - rect.minX;
    const h = rect.maxY - rect.minY;
    if (w > 0 || h > 0) {
      const { zoom } = camera.getState();
      const ds = camera.getDisplayScale();
      const vp = camera.getViewport();
      const room = (screenPx: number) =>
        screenPx > 2 * marginPx ? screenPx - 2 * marginPx : screenPx;
      const fitW = w > 0 ? room(vp.width * zoom * ds) / (w * ds) : Infinity;
      const fitH = h > 0 ? room(vp.height * zoom * ds) / (h * ds) : Infinity;
      camera.setZoom(Math.min(fitW, fitH));
    }
    moveCamera({ x: (rect.minX + rect.maxX) / 2, y: (rect.minY + rect.maxY) / 2 });
  }

  function onVisibilityChange(): void {
    if (document.hidden) input.releaseAll(performance.now());
    if (document.hidden && !loop.isPaused()) {
      pausedWhileHidden = true;
      loop.pause();
    } else if (!document.hidden && pausedWhileHidden) {
      pausedWhileHidden = false;
      loop.resume();
    }
    syncSim();
  }

  // ─── Public API ───────────────────────────────────────────

  function start(): void {
    if (destroyed) return;
    setPhase(store, "running");
    router.attach(inputTarget, keyTarget);
    inputTarget.addEventListener("blur", onInputBlur);
    focusInput();
    document.addEventListener("visibilitychange", onVisibilityChange);
    loop.start();
    syncSim();
    events.emit("game:start");
  }

  function onInputBlur(): void {
    input.releaseAll(performance.now());
  }

  /** Keys reach the game only while its input target has focus. */
  function focusInput(): void {
    inputTarget.focus({ preventScroll: true });
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
    document.removeEventListener("visibilitychange", onVisibilityChange);
    inputTarget.removeEventListener("blur", onInputBlur);
    debugOverlay?.destroy();
    teardownScene();
    router.destroy();
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

  return {
    start,
    destroy,
    resize,
    on,
    off,
    getStore,
    registry,
    loadScene,
    unloadScene: teardownScene,
    runtime: () => loaded?.runtime ?? null,
    play,
    replay,
    setPrefabs: (next) => {
      prefabs = next;
    },
    recording: () => session?.done ?? lastRecording,
    stop,
    pause,
    resume,
    step,
    setTimeScale,
    command,
    cancel,
    pointerWorld,
    setMode,
    getMode,
    router,
    screenToWorld: (screen) => camera.screenToWorld(screen),
    panBy,
    zoomAt,
    frame,
  };
}
