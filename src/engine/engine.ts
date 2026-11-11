import type { Store } from "@tanstack/store";
import { Container } from "pixi.js";

import { createCamera } from "./camera";
import type { DebugOverlay } from "./debug";
import { GameEventEmitter } from "./events";
import { resolveTime, type ResolvedTime } from "./game/time";
import type { GameAttachment, GameCommand, GameOutcome, GameShell } from "./game/types";
import type { PlayOptions } from "./headless/playtest-types";
import { createInputSystem } from "./input";
import { createGameLoop } from "./loop";
import {
  bundleOf,
  projectBundle,
  sceneBundle,
  type AssetBundle,
  type BundleEntry,
} from "./project/bundle";
import { engineResolution } from "./project/kinds/game-settings";
import { TEXTURE_KIND } from "./project/kinds/texture";
import type { ProjectRuntimeView } from "./project/runtime-view";
import type { AssetId, ProjectView } from "./project/types";
import type { LoadProgress } from "./render/asset-loader";
import { createPixiView, type PixiView } from "./render/pixi-view";
import { createRenderer } from "./renderer";
import { resolveResolution } from "./resolution";
import { createSessionRecording, preparePlay, type SessionRecording } from "./runtime/play-session";
import { recordingRapier } from "./runtime/recorder";
import { createSceneRuntime, resolveGame, type ProjectOption } from "./runtime/runtime";
import type { AssetReloadError, LoadReport, SceneRuntimeHandle, StepResult } from "./runtime/types";
import { defaultPhysics, expandScene, isExpandedScene, scenePhysics } from "./scene/expand";
import { checkCommand, elapsedCommand } from "./scene/input-script";
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
  InputAction,
  PlayReport,
  RapierModule,
  Vec2,
} from "./types";
import { DEFAULT_GAME_CONFIG } from "./types";

/** The scene that is playing: its runtime, the view it draws into, and the game's tools on it. */
type LoadedScene = {
  runtime: SceneRuntimeHandle;
  view: PixiView;
  attachment: GameAttachment | null;
  /** The textures it draws, retained while it is loaded; null without `config.assets`. */
  bundle: AssetBundle | null;
};

/** Time away shorter than this (a quick tab switch, one long frame) isn't worth an `@elapsed`. */
const MIN_CATCH_UP_MS = 1000;

/** `config.project` is what every scene's game reads as `EngineContext.project`; null without one. */
export async function createGame(
  canvas: HTMLCanvasElement,
  config: Partial<GameConfig> & Pick<GameConfig, "game"> & ProjectOption,
): Promise<GameInstance> {
  const { project: initialProject = null, ...rest } = config;
  let project = initialProject;
  const cfg: GameConfig = { ...DEFAULT_GAME_CONFIG, ...rest };
  const { game } = cfg;
  // Resolved before any rendering, so a malformed game fails fast; every scene's runtime shares it.
  const { registry } = resolveGame({ game, registry: cfg.registry });
  const projectResolution = project ? engineResolution(project.engine) : undefined;
  const resolution = resolveResolution({
    ...(cfg.resolution ? { host: cfg.resolution } : {}),
    ...(projectResolution ? { project: projectResolution } : {}),
    ...(game.resolution ? { game: game.resolution } : {}),
  });

  // ─── Initialize subsystems ────────────────────────────────

  const store = createGameStore();
  const events = new GameEventEmitter();
  let destroyed = false;

  setPhase(store, "loading");

  const renderer = await createRenderer(canvas, cfg, resolution);

  const camera = createCamera(
    renderer.worldContainer,
    cfg.displayWidth,
    cfg.displayHeight,
    cfg.camera,
    resolution,
  );
  updateCamera(store, { scale: camera.getState().scale });

  // Rapier loads at start only when the game (or its start-up scene) runs on it; `preload`
  // brings it in for a later Rapier scene, and without it such a load reports `physics-not-loaded`.
  let rapier: RapierModule | null = null;
  let rapierLoading: Promise<RapierModule | null> | null = null;

  function loadRapier(): Promise<RapierModule | null> {
    if (rapier || !cfg.rapier) return Promise.resolve(rapier);
    rapierLoading ??= cfg.rapier().then(
      (mod) => (rapier = mod),
      (error: unknown) => {
        rapierLoading = null;
        throw error;
      },
    );
    return rapierLoading;
  }

  const startScene = cfg.scene;
  const startPhysics = !startScene
    ? null
    : isExpandedScene(startScene)
      ? startScene.settings.physics
      : scenePhysics(startScene, registry, project?.engine);
  if (defaultPhysics(registry, project?.engine) === "rapier" || startPhysics === "rapier") {
    await loadRapier();
  }
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

  // ─── Textures ─────────────────────────────────────────────

  // `view` is read at each use, so a host may pass a getter that follows its project.
  const assets = cfg.assets ?? null;
  let projectAssets: AssetBundle | null = null;
  let projectRequested = false;
  /** The view a reload brought, until the host's own `view` moves on from the one it replaced. */
  let reloaded: { view: ProjectView; over: ProjectView } | null = null;

  function assetView(): ProjectView | null {
    if (!assets) return null;
    const own = assets.view;
    if (reloaded && reloaded.over === own) return reloaded.view;
    reloaded = null;
    return own;
  }

  function resolveProject(view: ProjectView): AssetBundle {
    const settings = project ? { game: project.settings } : undefined;
    return projectBundle(view, settings, assets!.kinds, registry).bundle;
  }

  /** The project bundle, retained for the instance's life from its first use. */
  function heldProject(): AssetBundle | null {
    if (!assets) return null;
    if (!projectAssets) {
      projectAssets = resolveProject(assetView()!);
      assets.loader.retain(projectAssets);
    }
    return projectAssets;
  }

  /**
   * A definition's bundle covers its `assets` header and its prefabs'; an
   * expanded scene carries no header, so only its entities and settings count.
   */
  function bundleFor(scene: ExpandedScene, def: SceneDefinition | null): AssetBundle | null {
    if (!assets) return null;
    const source = def ?? { v: 0, name: scene.name, bounds: scene.bounds };
    const library = def ? prefabs : new Map();
    return sceneBundle(scene, source, library, assetView()!, assets.kinds, registry).bundle;
  }

  /**
   * Loads `bundle`, joined by the project's entries until a load brings them
   * all in: a project texture that failed is asked for again by the next load.
   */
  async function loadBundle(
    bundle: AssetBundle,
    onProgress?: (p: LoadProgress) => void,
  ): Promise<{ failed: BundleEntry[] }> {
    const loader = assets?.loader;
    if (!loader) return { failed: [] };
    const shared = heldProject();
    if (!shared || projectRequested || shared.entries.length === 0) {
      return loader.load(bundle, onProgress);
    }
    projectRequested = true;
    const joined = bundleOf(bundle.name, [...shared.entries, ...bundle.entries]);
    const result = await loader.load(joined, onProgress);
    const held = new Set(shared.entries.map((e) => e.sha256));
    if (result.failed.some((e) => held.has(e.sha256))) projectRequested = false;
    return result;
  }

  function syncGameSlice(): void {
    setGameSlice(store, loaded?.runtime.game?.storeSlice?.() ?? null);
  }

  function teardownScene(): void {
    if (!loaded) return;
    debugOverlay?.setPhysics(null);
    loaded.attachment?.destroy();
    loaded.runtime.destroy();
    loaded.view.destroy();
    if (loaded.bundle) assets?.loader.release(loaded.bundle);
    loaded = null;
    syncGameSlice();
  }

  /**
   * Builds a fresh world for `scene` and swaps it in; on failure the current
   * one keeps running. Unless `snap` says otherwise, the camera snaps to the
   * game's target in play mode and on the first load; in edit mode it stays
   * where the editor put it.
   */
  function buildWorld(
    scene: ExpandedScene,
    bundle: AssetBundle | null,
    play?: PlayOptions,
    snap?: boolean,
  ): LoadReport {
    if (destroyed) return { ok: false, error: "game destroyed" };
    const container = new Container();
    container.label = `scene:${scene.name}`;
    const view = createPixiView(container, {
      layers: registry.layers,
      textures: cfg.assets?.loader,
      editing: () => getMode() === "edit",
      ...(resolution.pixelSnap ? { pixelSnap: true } : {}),
    });
    const runtime = createSceneRuntime({
      rapier,
      view,
      game,
      registry,
      dev: cfg.dev,
      now: () => performance.now(),
      project,
      ...(resolution.sampling ? { sampling: resolution.sampling } : {}),
    });
    const report = runtime.load(scene, play);
    if (!report.ok) {
      runtime.destroy();
      view.destroy();
      if (cfg.dev) console.warn(`[scene] load failed: ${report.error}`, report);
      return report;
    }

    const first = loaded === null;
    syncTickRate(runtime.ctx.time);
    // Retained before the old scene releases, so textures both use stay resident.
    if (bundle) assets?.loader.retain(bundle);
    teardownScene();
    if (bundle && assets) void loadBundle(bundle);
    sceneLayer.addChild(container);
    const shell: GameShell = { view, router, dev: cfg.dev, getMode, send };
    loaded = { runtime, view, attachment: game.attach?.(shell, runtime) ?? null, bundle };
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

  function expand(
    source: SceneDefinition | ExpandedScene,
  ): { ok: true; scene: ExpandedScene } | { ok: false; error: string } {
    try {
      const scene = isExpandedScene(source)
        ? source
        : expandScene(source, registry, { prefabs, engine: project?.engine });
      return { ok: true, scene };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  function loadScene(source: SceneDefinition | ExpandedScene): LoadReport {
    if (destroyed) return { ok: false, error: "game destroyed" };
    const expanded = expand(source);
    if (!expanded.ok) {
      if (cfg.dev) console.warn(`[scene] expand failed: ${expanded.error}`);
      return expanded;
    }
    const def = isExpandedScene(source) ? null : source;
    return buildWorld(expanded.scene, bundleFor(expanded.scene, def));
  }

  function getMode(): GameMode {
    return store.state.mode;
  }

  // ─── Edit and play ────────────────────────────────────────

  /** What Stop brings back: the edit world's scene and the editor camera, taken at Play. */
  let editState: {
    scene: ExpandedScene | null;
    camera: CameraState;
    bundle: AssetBundle | null;
  } | null = null;

  function enterMode(mode: GameMode): void {
    setStoreMode(store, mode);
    input.setEnabled(mode === "play");
    camera.setMode(mode === "play" ? "follow" : "free");
    updateCamera(store, camera.getState());
    loaded?.attachment?.onModeChange?.(mode);
    if (mode === "play" && store.state.phase === "running") focusInput();
  }

  function startPlay(
    scene: ExpandedScene,
    bundle: AssetBundle | null,
    opts: PlayOptions = {},
  ): PlayReport {
    const playing = getMode() === "play" && editState !== null;
    const remembered = playing
      ? editState
      : {
          scene: loaded?.runtime.scene() ?? null,
          camera: camera.getState(),
          bundle: loaded?.bundle ?? null,
        };
    // The edit scene's textures stay resident through Play, for Stop.
    if (!playing && remembered?.bundle) assets?.loader.retain(remembered.bundle);
    const report = buildWorld(scene, bundle, opts, true);
    if (!report.ok) {
      if (!playing && remembered?.bundle) assets?.loader.release(remembered.bundle);
      const out: PlayReport = { ok: false, issues: [], error: report.error };
      if (report.reason) out.reason = report.reason;
      return out;
    }
    editState = remembered;
    resetQueues();
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
    const prepared = preparePlay(doc, registry, { dev: cfg.dev, prefabs, engine: project?.engine });
    if (!prepared.ok) return { ok: false, issues: prepared.issues };
    finishRecording(session?.stop() ?? null);
    session = null;
    const report = startPlay(prepared.scene, bundleFor(prepared.scene, doc), opts);
    if (report.ok) {
      session = createSessionRecording({
        rapier: recordingRapier(prepared.scene, rapier),
        game,
        scene: doc.name,
        sceneHash: prepared.hash,
        start: opts,
        ...(loaded ? { time: loaded.runtime.ctx.time } : {}),
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
    const bundle = remembered?.scene ? remembered.bundle : (loaded?.bundle ?? null);
    if (!scene || !buildWorld(scene, bundle, undefined, false).ok) teardownScene();
    if (remembered?.bundle) assets?.loader.release(remembered.bundle);
    resetQueues();
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
    if (scene) startPlay(scene, loaded?.bundle ?? null);
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

  // ─── Clock and input queues ──────────────────────────────

  /** The loaded runtime's clock; before any load, the one a load would get. */
  function clock(): ResolvedTime {
    return (
      loaded?.runtime.ctx.time ?? resolveTime({ project: project?.engine, game: registry.time })
    );
  }

  const initialTime = clock();
  let loopRate = initialTime.rate;

  function syncTickRate(time: ResolvedTime): void {
    if (time.rate === loopRate) return;
    loopRate = time.rate;
    loop.setTickRate(time.rate);
  }

  /** Commands for the next simulated tick (`send`, `@elapsed`), in the order they were queued. */
  let pendingCommands: GameCommand[] = [];
  /** Input polled while a turns or event game sat idle, delivered with its next tick. */
  let heldInput: InputAction[] = [];
  /** The pointer at the last simulated tick, so an event game can tell it moved. */
  let tickPointer: Vec2 = input.getMousePosition();

  /** A new world starts with nothing pending from the last. */
  function resetQueues(): void {
    input.flush();
    heldInput = [];
    pendingCommands = [];
    tickPointer = input.getMousePosition();
  }

  function takeInput(tick: number): InputAction[] {
    const polled = input.poll(tick);
    if (heldInput.length === 0) return polled;
    const actions = heldInput.concat(polled);
    heldInput = [];
    for (const action of actions) action.tick = tick;
    return actions;
  }

  /** Commands wake every model; for event games so do button edges and, when asked, pointer moves. */
  function wakePending(time: ResolvedTime): boolean {
    if (pendingCommands.length > 0) return true;
    if (time.kind !== "event") return false;
    const polled = input.poll(store.state.tick);
    if (polled.length > 0) heldInput.push(...polled);
    if (heldInput.length > 0) return true;
    if (!time.wakeOnPointerMove) return false;
    const at = input.getMousePosition();
    return at.x !== tickPointer.x || at.y !== tickPointer.y;
  }

  /** Whether the loop may tick now: always outside play, while replaying and for fixed games. */
  function gate(): boolean {
    if (!loaded || getMode() !== "play" || session?.replaying) return true;
    const time = loaded.runtime.ctx.time;
    if (time.kind === "fixed") return true;
    return wakePending(time) || loaded.runtime.busy();
  }

  /** Queues `@elapsed` for wall time away, clamped to the game's `catchUp.maxMs`. */
  function queueElapsed(ms: number): boolean {
    const catchUp = clock().catchUp;
    if (!catchUp || !loaded || getMode() !== "play") return false;
    pendingCommands.push(elapsedCommand(ms, catchUp));
    return true;
  }

  // ─── Game loop ────────────────────────────────────────────

  /** The camera, the game's store slice and the debug overlay: what moves on with or without a step. */
  function shellTick(dt: number, mouseWorld: Vec2): void {
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
  }

  const loop = createGameLoop({
    tickRate: initialTime.rate,
    maxDeltaMs: cfg.maxDeltaTime,
    ...(initialTime.kind === "fixed" ? {} : { gate }),

    onTick(dt: number) {
      const polled = takeInput(store.state.tick);
      const mouseWorld = camera.screenToWorld(input.getMousePosition());

      if (loaded && getMode() === "play") {
        const tick = loaded.runtime.ctx.tick;
        const actions = session ? session.actions(tick, polled) : polled;
        const queued = pendingCommands;
        pendingCommands = [];
        const commands = session ? session.commands(tick, queued) : queued;
        tickPointer = input.getMousePosition();
        loaded.attachment?.onTick?.(dt, mouseWorld);
        const result = loaded.runtime.step(dt, actions, commands);
        incrementTick(store);
        events.emit("scene:step", result);
        const verdict = judge(result);
        if (session) {
          const wasReplay = session.replaying;
          const finished = session.stepped(result, actions, verdict, commands);
          finishRecording(finished);
          // A replay holds its last frame until Stop, so the end state can be looked at.
          if (finished && wasReplay) pause();
        }
      }

      shellTick(dt, mouseWorld);
      events.emit("game:tick", { tick: store.state.tick });
    },

    onIdle(dt: number) {
      shellTick(dt, camera.screenToWorld(input.getMousePosition()));
    },

    onDropped(ms: number) {
      if (ms >= MIN_CATCH_UP_MS) queueElapsed(ms);
    },

    onRender(alpha: number) {
      if (loaded) {
        // Paused or editing, nothing steps, so visuals sit at their latest poses (an idle
        // turns or event game gets alpha 1 from the loop).
        const a = loop.isPaused() || getMode() === "edit" ? 1 : alpha;
        const { position, zoom } = camera.getState();
        loaded.view.frame?.({ alpha: a, camera: { x: position.x, y: position.y, zoom } });
        loaded.runtime.render(a);
      }
      setFPS(store, loop.getFPS());
    },
  });

  // ─── Simulation controls ──────────────────────────────────

  // A hidden tab gets no frames; pausing keeps its return from catching up the gap in one burst.
  let pausedWhileHidden = false;
  let hiddenAt = 0;

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

  /** Why `command` can't be queued now, or the command as it is queued. */
  function commandProblem(command: GameCommand): { why: string } | { command: GameCommand } {
    if (destroyed) return { why: "game destroyed" };
    if (!loaded || getMode() !== "play") return { why: "nothing is playing" };
    if (session?.replaying) return { why: "a replay plays its recorded commands" };
    const checked = checkCommand(registry, command);
    if (!checked.ok) return { why: checked.message };
    if (checked.command.name !== "@elapsed") return { command: checked.command };
    const catchUp = clock().catchUp;
    if (!catchUp) return { why: "the game has no time.catchUp" };
    const { ms } = checked.command.args as { ms: number };
    return { command: elapsedCommand(ms, catchUp) };
  }

  function send(command: GameCommand): boolean {
    const checked = commandProblem(command);
    if ("why" in checked) {
      if (cfg.dev) console.warn(`[game] send("${command.name}"): ${checked.why}`);
      return false;
    }
    pendingCommands.push(checked.command);
    return true;
  }

  function elapse(ms: number): void {
    if (destroyed) return;
    const why = !clock().catchUp
      ? "the game has no time.catchUp"
      : !(Number.isFinite(ms) && ms > 0)
        ? "ms must be a finite number > 0"
        : queueElapsed(ms)
          ? null
          : "nothing is playing";
    if (why && cfg.dev) console.warn(`[game] elapse(${ms}): ${why}`);
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
    const { scale } = camera.getState();
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
      hiddenAt = performance.now();
      loop.pause();
    } else if (!document.hidden && pausedWhileHidden) {
      pausedWhileHidden = false;
      loop.resume();
      const away = performance.now() - hiddenAt;
      if (away >= MIN_CATCH_UP_MS) queueElapsed(away);
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
    updateCamera(store, { scale: camera.getState().scale });
  }

  /**
   * A scene that doesn't expand has nothing to load; `loadScene` reports why,
   * as it reports `physics-not-loaded` when Rapier failed to load here.
   */
  async function preload(
    source: SceneDefinition | ExpandedScene,
    onProgress?: (p: LoadProgress) => void,
  ): Promise<{ failed: BundleEntry[] }> {
    if (destroyed) return { failed: [] };
    const expanded = expand(source);
    if (!expanded.ok) return { failed: [] };
    const physics =
      expanded.scene.settings.physics === "rapier"
        ? loadRapier().catch((error: unknown) => {
            if (cfg.dev) console.warn(`[scene] Rapier failed to load`, error);
          })
        : null;
    const def = isExpandedScene(source) ? null : source;
    const bundle = assets ? bundleFor(expanded.scene, def) : null;
    const textures = bundle ? loadBundle(bundle, onProgress) : { failed: [] };
    const [, result] = await Promise.all([physics, textures]);
    return result;
  }

  /** `bundle` with each changed texture's entry at `view`'s hash; `bundle` itself when none changed. */
  function rehashed(
    bundle: AssetBundle,
    view: ProjectView,
    changed: ReadonlySet<AssetId>,
  ): AssetBundle {
    let moved = false;
    const entries = bundle.entries.map((e) => {
      const live = changed.has(e.id) ? view.byId.get(e.id) : undefined;
      if (live?.sha256 === undefined || live.sha256 === e.sha256) return e;
      moved = true;
      return { ...e, sha256: live.sha256, bytes: live.bytes ?? e.bytes };
    });
    return moved ? bundleOf(bundle.name, entries) : bundle;
  }

  /** Swaps each held bundle for its rehashed copy, so the new textures stay resident and the old may go. */
  function rehashHeld(view: ProjectView, changed: ReadonlySet<AssetId>): void {
    if (!assets) return;
    const swap = (bundle: AssetBundle): AssetBundle => {
      const next = rehashed(bundle, view, changed);
      if (next !== bundle) {
        assets.loader.retain(next);
        assets.loader.release(bundle);
      }
      return next;
    };
    if (loaded?.bundle) loaded.bundle = swap(loaded.bundle);
    if (editState?.bundle) editState.bundle = swap(editState.bundle);
    if (projectAssets) projectAssets = swap(projectAssets);
  }

  /** The changed textures' entries at `view`'s hashes. */
  function changedTextures(view: ProjectView, changed: readonly AssetId[]): BundleEntry[] {
    const entries: BundleEntry[] = [];
    for (const id of new Set(changed)) {
      const live = view.byId.get(id);
      if (live?.kind !== TEXTURE_KIND || live.sha256 === undefined) continue;
      entries.push({ id, kind: live.kind, sha256: live.sha256, bytes: live.bytes ?? 0 });
    }
    return entries;
  }

  /**
   * Re-resolves the held project bundle from the current project's settings
   * at `view`: swaps it in when it differs, and returns the entries it gained.
   */
  function refreshProject(view: ProjectView): BundleEntry[] {
    if (!assets || !projectAssets) return [];
    const next = resolveProject(view);
    const had = new Set(projectAssets.entries.map((e) => `${e.id}\0${e.sha256}`));
    const gained = next.entries.filter((e) => !had.has(`${e.id}\0${e.sha256}`));
    if (gained.length === 0 && next.entries.length === projectAssets.entries.length) return [];
    assets.loader.retain(next);
    assets.loader.release(projectAssets);
    projectAssets = next;
    return gained;
  }

  async function reloadAssets(update: {
    project: ProjectRuntimeView | null;
    view: ProjectView;
    changed: readonly AssetId[];
  }): Promise<{ failed: BundleEntry[]; errors: AssetReloadError[] }> {
    if (destroyed) return { failed: [], errors: [] };
    const projectMoved = update.project !== project;
    project = update.project;
    if (assets) reloaded = { view: update.view, over: assets.view };
    let failed: BundleEntry[] = [];
    if (assets) {
      rehashHeld(update.view, new Set(update.changed));
      const gained = projectMoved ? refreshProject(update.view) : [];
      const bundle = bundleOf("reload", [
        ...changedTextures(update.view, update.changed),
        ...gained,
      ]);
      if (bundle.entries.length > 0) failed = (await assets.loader.load(bundle)).failed;
      const fresh = new Set(gained.map((e) => e.sha256));
      if (failed.some((e) => fresh.has(e.sha256))) projectRequested = false;
    }
    const errors = destroyed ? [] : (loaded?.runtime.reloadAssets(project, update.changed) ?? []);
    return { failed, errors };
  }

  function destroy(): void {
    if (destroyed) return;
    destroyed = true;

    loop.stop();
    document.removeEventListener("visibilitychange", onVisibilityChange);
    inputTarget.removeEventListener("blur", onInputBlur);
    debugOverlay?.destroy();
    teardownScene();
    if (editState?.bundle) assets?.loader.release(editState.bundle);
    editState = null;
    if (projectAssets) assets?.loader.release(projectAssets);
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
    preload,
    reloadAssets,
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
    send,
    elapse,
    cancel,
    pointerWorld,
    setMode,
    getMode,
    router,
    screenToWorld: (screen) => camera.screenToWorld(screen),
    panBy,
    zoomAt,
    frame,
    extractPixels: (world) => renderer.extractPixels(world),
  };
}
