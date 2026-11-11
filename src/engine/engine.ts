import type { Store } from "@tanstack/store";
import { Container } from "pixi.js";

import { createCamera } from "./camera";
import type { DebugOverlay } from "./debug";
import { GameEventEmitter } from "./events";
import { createFlowHost } from "./flow-host";
import { flowIssue, type FlowRequest, type LibraryScene, type SceneLibrary } from "./game/flow";
import {
  actionProblem,
  bindingProblems,
  isUiAction,
  keysProblems,
  type BindingProblem,
} from "./game/input-bindings";
import { isRuntimeId } from "./game/runtime-ids";
import type { SaveFile } from "./game/save-file";
import { resolveTime, type ResolvedTime } from "./game/time";
import type {
  Binding,
  DeviceId,
  GameAttachment,
  GameCommand,
  GameOutcome,
  GameShell,
  JsonValue,
  PlayerInfo,
} from "./game/types";
import { pxPerMetreOf } from "./game/units";
import type { PlayOptions } from "./headless/playtest-types";
import {
  actionBindings,
  resolveBindings,
  seatTables,
  type DeviceTables,
  type ResolvedBindings,
} from "./input/bindings";
import {
  createGamepadReader,
  type GamepadPoll,
  type GamepadView,
  type PadBinding,
  type PadChange,
} from "./input/gamepad";
import {
  createSeatBook,
  createSeats,
  resolvePlayers,
  seatCount,
  seatProblem,
} from "./input/players";
import { DEFAULT_DEADZONE, qPointer } from "./input/quantize";
import {
  matchCapturePress,
  type CaptureDevice,
  type CapturePress,
  type RemapState,
} from "./input/remap";
import type { PointerState } from "./input/state";
import { mergeTick, offsetIn, type SeatChange } from "./input/stream";
import { createInputSystem } from "./input/system";
import { createTouchControls, type TouchControls } from "./input/touch-controls";
import { createGameLoop } from "./loop";
import {
  bundleOf,
  projectBundle,
  sceneBundle,
  type AssetBundle,
  type BundleEntry,
} from "./project/bundle";
import { sameValue } from "./project/canonical";
import { engineResolution } from "./project/kinds/game-settings";
import { TEXTURE_KIND } from "./project/kinds/texture";
import type { ProjectRuntimeView } from "./project/runtime-view";
import type { AssetId, ProjectView } from "./project/types";
import type { LoadProgress } from "./render/asset-loader";
import { createPixiView, type PixiView } from "./render/pixi-view";
import { createRenderer } from "./renderer";
import { resolveResolution } from "./resolution";
import { loadListed } from "./runtime/flow";
import { gamePersistCell, playClockOf } from "./runtime/persist";
import {
  createSessionRecording,
  playWorld,
  preparePlay,
  type SessionRecording,
} from "./runtime/play-session";
import { recordingRapier, recordingStart } from "./runtime/recorder";
import {
  createSceneRuntime,
  resolveGame,
  SAVE_INPUT_KEY,
  type ProjectOption,
} from "./runtime/runtime";
import { captureSave, restoreSave } from "./runtime/save-state";
import type { AssetReloadError, LoadReport, SceneRuntimeHandle, StepResult } from "./runtime/types";
import {
  createSaveSlots,
  inertSaveSlots,
  pickSaveStore,
  saveRequested,
  type SaveSlots,
} from "./saves/slots";
import type { SaveWriteResult } from "./saves/store";
import { defaultPhysics, expandScene, isExpandedScene, scenePhysics } from "./scene/expand";
import { checkCommand, elapsedCommand } from "./scene/input-script";
import { makeIssue } from "./scene/issues";
import type { RunRecording } from "./scene/recording-schema";
import type {
  Aabb,
  ExpandedScene,
  PrefabLibrary,
  SceneDefinition,
  SceneIssue,
} from "./scene/types";
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
import { createToolRouter, resolveInputTarget, type ToolEvent } from "./tool-router";
import type {
  CameraState,
  FlowResult,
  GameConfig,
  GameEventMap,
  GameInput,
  GameInstance,
  GameMode,
  GameStoreState,
  InputAction,
  InputBinding,
  PlayOutcome,
  PlayReport,
  RapierModule,
  UiActionEvent,
  Vec2,
} from "./types";
import { DEFAULT_GAME_CONFIG } from "./types";
import { cancelMountedUi, createTransitionLayer } from "./ui/layer";

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

/** A pad timestamp further back than this from now isn't on `performance.now()`'s clock. */
const PAD_CLOCK_WINDOW_MS = 1000;

/**
 * `config.project` is what every scene's game reads as `EngineContext.project`;
 * null without one. `config.game` null plays an engine-only project's scenes
 * under `createRegistry(null)`.
 */
export async function createGame(
  canvas: HTMLCanvasElement,
  config: Partial<GameConfig> & Pick<GameConfig, "game"> & ProjectOption,
): Promise<GameInstance> {
  const { project: initialProject = null, ...rest } = config;
  let project = initialProject;
  /** This instance, once built; a mounted UI's cancel is found through it. */
  let self: GameInstance | null = null;
  const cfg: GameConfig = { ...DEFAULT_GAME_CONFIG, ...rest };
  const { game } = cfg;
  // Resolved before any rendering, so a malformed game fails fast; every scene's runtime shares it.
  const { registry } = resolveGame({ game, registry: cfg.registry });
  const projectResolution = project ? engineResolution(project.engine) : undefined;
  const resolution = resolveResolution({
    ...(cfg.resolution ? { host: cfg.resolution } : {}),
    ...(projectResolution ? { project: projectResolution } : {}),
    ...(game?.resolution ? { game: game.resolution } : {}),
  });

  // ─── Initialize subsystems ────────────────────────────────

  const store = createGameStore();
  const events = new GameEventEmitter();
  /** The game's persistent value, shared by every runtime this instance builds, Play's included. */
  const persist = gamePersistCell(game, cfg.dev);
  let destroyed = false;
  // Read once for every recording this instance makes; "unknown" until (and unless) the browser says.
  let arch = "unknown";
  void browserArch().then((a) => (arch = a));

  setPhase(store, "loading");

  const renderer = await createRenderer(canvas, cfg, resolution);

  // World metres to the policy's virtual px; nothing on the simulation side reads it.
  const pxPerMetre = pxPerMetreOf(registry);
  const camera = createCamera(
    renderer.worldContainer,
    cfg.displayWidth,
    cfg.displayHeight,
    cfg.camera,
    resolution,
    pxPerMetre,
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
  // ─── Seats, bindings and devices ──────────────────────────

  const playersDef = resolvePlayers(project?.inputMap, game);
  const seatMax = seatCount(playersDef);
  const seats = createSeats(playersDef);
  const remaps = cfg.input?.remaps ?? null;
  // The player's remaps belong to the game they were made for; a gameless project keeps none.
  const remapKey = game?.id ?? null;
  let controls = controlIds();
  let remap: RemapState = loadRemaps();

  function controlIds(): string[] {
    return (project?.inputMap?.touch ?? []).map((c) => c.id);
  }

  function resolveAll(): ResolvedBindings {
    return resolveBindings({
      remap,
      host: cfg.bindings,
      map: project?.inputMap ?? null,
      game: game?.actions ?? [],
      players: seatMax,
    });
  }

  let bindings = resolveAll();
  if (cfg.dev && cfg.bindings) warnHostBindings(cfg.bindings, bindings);
  /** What the input system reads: the bindings each device's seat drives now. */
  const routed: Tables = { ...bindings.tables };
  let padTables: PadTables[] = [];
  /** The seat each device class was last routed to; undefined before the first routing. */
  let routedOwners: Partial<Record<"keyboard" | "pointer" | "touch", number | null>> = {};
  routeDevices(true);
  const input = createInputSystem(routed, { isUi: (action) => isUiAction(registry, action) });
  const pads = createGamepadReader({
    deadzone: project?.inputMap?.deadzone ?? game?.input?.deadzone ?? DEFAULT_DEADZONE,
  });
  const inputTarget = resolveInputTarget(canvas, cfg.inputTarget);
  const keyTarget = cfg.keyTarget ?? inputTarget;
  const router = createToolRouter();
  const playConsumer = input.consumer();
  // A device's first press may seat it, before the press itself is read for that seat.
  router.register({
    ...playConsumer,
    handle(e) {
      const device = pressedDevice(e);
      if (device) {
        seats.press(device);
        syncSeats();
      }
      playConsumer.handle(e);
    },
  });

  /** Seat changes for the next simulated tick's `joins`, in the order they happened. */
  let queuedJoins: SeatChange[] = [];

  /**
   * Takes the seats' changes for the next tick, and routes devices to their
   * new seats. A device leaving a seat lets go of what it held there first,
   * unless its release was already read (a pad poll releases a pad that went
   * away before freeing its seat).
   */
  function syncSeats(released = false): void {
    const changes = seats.drain();
    if (changes.length === 0) return;
    if (!released && changes.some((c) => !c.joined)) input.releaseAll(performance.now());
    queuedJoins.push(...changes);
    routeDevices();
  }

  /**
   * The joins that bring a fresh world's seats (which start as the join
   * policy starts them, or as `from` says for a restored one) to the live
   * ones, so a new world and its recording begin with the devices where they are.
   */
  function seatSync(from?: readonly PlayerInfo[]): SeatChange[] {
    seats.drain();
    const fresh = createSeatBook(playersDef);
    if (from) {
      for (const { index, devices } of fresh.players()) {
        for (const device of devices)
          if (!from[index]?.devices.includes(device))
            fresh.apply({ player: index, device, joined: false });
      }
      for (const { index, devices } of from)
        for (const device of devices) fresh.apply({ player: index, device, joined: true });
    }
    const out: SeatChange[] = [];
    for (const { index, devices } of fresh.players()) {
      for (const device of devices) {
        if (seats.seatOf(device) !== index)
          out.push(...fresh.apply({ player: index, device, joined: false }));
      }
    }
    for (const { index, devices } of seats.players()) {
      for (const device of devices)
        out.push(...fresh.apply({ player: index, device, joined: true }));
    }
    return out;
  }

  /**
   * Points the input system at the bindings each device's seat drives: a
   * key binding that names its seat always, any other binding only while its
   * seat owns the device; each pad reads its own seat's pad tables. With one
   * seat every device drives seat 0, as the resolved tables already say. A
   * class's tables are rebuilt only when its owner or the bindings change,
   * so what other devices hold keeps reading the same entries.
   */
  function routeDevices(rebound = false): void {
    const all = bindings.tables;
    if (seatMax === 1) {
      Object.assign(routed, all);
      padTables = [{ padButtons: all.padButtons, padAxes: all.padAxes, padSticks: all.padSticks }];
      return;
    }
    if (rebound) {
      routedOwners = {};
      padTables = Array.from({ length: seatMax }, (_, p) => {
        const { padButtons, padAxes, padSticks } = seatTables(all, { pad: p });
        return { padButtons, padAxes, padSticks };
      });
    }
    const moved = (cls: "keyboard" | "pointer" | "touch"): number | null | undefined => {
      const owner = seats.seatOf(cls);
      if (Object.hasOwn(routedOwners, cls) && routedOwners[cls] === owner) return undefined;
      routedOwners[cls] = owner;
      return owner;
    };
    const keyboard = moved("keyboard");
    if (keyboard !== undefined) routed.keys = seatTables(all, { keyboard }).keys;
    const pointer = moved("pointer");
    if (pointer !== undefined) routed.pointer = seatTables(all, { pointer }).pointer;
    const touch = moved("touch");
    if (touch !== undefined) routed.touch = seatTables(all, { touch }).touch;
  }

  /** The stored remaps that still fit the game: an action it declares, a seat it has, bindings that pass the check. */
  function loadRemaps(): RemapState {
    const players: Record<number, Record<string, readonly Binding[]>> = {};
    let stored: RemapState | null = null;
    try {
      stored = remaps && remapKey !== null ? remaps.load(remapKey) : null;
    } catch (error) {
      if (cfg.dev) console.warn("[game] input remaps failed to load", error);
    }
    for (const [seat, actions] of Object.entries(stored?.players ?? {})) {
      const player = Number(seat);
      if (!(Number.isInteger(player) && player >= 0 && player < seatMax)) continue;
      for (const [action, list] of Object.entries(actions)) {
        if (remapProblem(action, list, player)) {
          if (cfg.dev)
            console.warn(`[game] dropped a stored remap of "${action}" for seat ${seat}`);
          continue;
        }
        (players[player] ??= {})[action] = list;
      }
    }
    return { v: 1, players };
  }
  let touch = createTouchOverlay();

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
      pxPerMetre,
      store,
      router,
      layers: cfg.debugLayers,
    });
  }

  // ─── Scene runtime (one at a time) ────────────────────────

  let loaded: LoadedScene | null = null;
  /** True while a scene change runs: the loop renders on but doesn't tick. */
  let flowHolding = false;

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
  function bundleFor(
    scene: ExpandedScene,
    def: SceneDefinition | null,
    defPrefabs: PrefabLibrary = prefabs,
  ): AssetBundle | null {
    if (!assets) return null;
    const source = def ?? { v: 0, name: scene.name, bounds: scene.bounds };
    const library = def ? defPrefabs : new Map();
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
    const built = buildRuntime(scene.name);
    const report = built.runtime.load(scene, play);
    if (!report.ok) {
      discard(built, report);
      return report;
    }
    return swapIn(built, scene, bundle, report, snap);
  }

  type BuiltRuntime = { runtime: SceneRuntimeHandle; view: PixiView; container: Container };

  /** The listed scenes as the flow source holds them, for a runtime's flow loads and attaches. */
  function flowLibrary(): SceneLibrary {
    const source = cfg.flow!.source;
    const list = source.list();
    const scenes = new Map<AssetId, LibraryScene>();
    for (const entry of list) {
      const listed = source.scene(entry.scene);
      if (listed) scenes.set(entry.scene, listed);
    }
    return { list, scenes };
  }

  function buildRuntime(name: string): BuiltRuntime {
    const container = new Container();
    container.label = `scene:${name}`;
    const view = createPixiView(container, {
      layers: registry.layers,
      textures: cfg.assets?.loader,
      editing: () => getMode() === "edit",
      pxPerMetre,
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
      prefabs: () => prefabs,
      persist,
      ...(cfg.flow ? { scenes: flowLibrary } : {}),
      ...(resolution.sampling ? { sampling: resolution.sampling } : {}),
    });
    return { runtime, view, container };
  }

  function discard(built: BuiltRuntime, report: Extract<LoadReport, { ok: false }>): void {
    built.runtime.destroy();
    built.view.destroy();
    if (cfg.dev) console.warn(`[scene] load failed: ${report.error}`, report);
  }

  /** Makes a loaded runtime the playing scene, tearing down the one before. */
  function swapIn(
    { runtime, view, container }: BuiltRuntime,
    scene: ExpandedScene,
    bundle: AssetBundle | null,
    report: LoadReport,
    snap?: boolean,
  ): LoadReport {
    const first = loaded === null;
    syncTickRate(runtime.ctx.time);
    // Retained before the old scene releases, so textures both use stay resident.
    if (bundle) assets?.loader.retain(bundle);
    teardownScene();
    if (bundle && assets) void loadBundle(bundle);
    sceneLayer.addChild(container);
    const shell: GameShell = { view, router, dev: cfg.dev, getMode, send };
    loaded = { runtime, view, attachment: game?.attach?.(shell, runtime) ?? null, bundle };
    debugOverlay?.setPhysics(runtime.ctx);
    syncGameSlice();
    camera.setBoundsFromScene(scene.bounds);
    if (snap ?? (first || getMode() === "play")) {
      camera.snapTo(cameraTargetOf(runtime));
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

  // ─── Saves ────────────────────────────────────────────────

  /**
   * Pads a loaded world save seated that weren't connected when it loaded:
   * each takes its saved seat when it connects, and until then its seat
   * holds no pad.
   */
  const awaitingPads = new Map<DeviceId, number>();

  function padConnected(device: DeviceId): void {
    seats.connect(device);
    const player = awaitingPads.get(device);
    if (player === undefined) return;
    awaitingPads.delete(device);
    seats.assign(device, player);
  }

  const padPresent = (device: DeviceId): boolean => {
    if (!device.startsWith("pad:")) return true;
    const index = Number(device.slice(4));
    return typeof navigator !== "undefined" && navigator.getGamepads?.()?.[index] != null;
  };

  /**
   * The save as the shell restores it: the devices decide what is held, so
   * the saved held input is left out, and a seat's pad that isn't
   * connected waits in `awaitingPads` instead of being seated.
   */
  function liveSave(file: SaveFile): SaveFile {
    awaitingPads.clear();
    if (!file.world) return file;
    const { [SAVE_INPUT_KEY]: _held, ...systems } = file.world.systems;
    const seated = file.world.seats.map(({ player, devices }) => {
      for (const d of devices) if (!padPresent(d)) awaitingPads.set(d, player);
      return { player, devices: devices.filter(padPresent) };
    });
    return { ...file, world: { ...file.world, systems, seats: seated } };
  }

  /** Brings the live seats to a restored world's and queues the joins that bring it to the live ones. */
  function seatRestored(runtime: SceneRuntimeHandle): void {
    for (const { index, devices } of runtime.ctx.input.players())
      for (const device of devices) seats.assign(device, index);
    queuedJoins = seatSync(runtime.ctx.input.players());
    routeDevices();
  }

  /**
   * Loads a save in place of the current scene: pauses, builds a fresh
   * world for the save's listed scene, restores the save into it and swaps
   * it in, then resumes. On a refusal the current scene keeps running.
   */
  async function loadSave(
    file: SaveFile,
  ): Promise<{ ok: true } | { ok: false; issue: SceneIssue }> {
    if (destroyed) return { ok: false, issue: loadRefused(file.scene.id, "game destroyed") };
    const id = file.scene.id;
    const source = cfg.flow?.source;
    const refused = flowIssue(source?.list() ?? [], id, "go");
    if (refused) return { ok: false, issue: refused };
    const listed = source?.scene(id) ?? null;
    if (!listed) {
      return {
        ok: false,
        issue: makeIssue("scene-unlisted", {
          severity: "error",
          message: `the scene list holds "${id}" but the host's scene source has no data for it`,
          entityIds: [id],
        }),
      };
    }
    const from = self?.flow.current() ?? null;
    // A host that had paused (a pause menu's Load) keeps its pause; it resumes when it closes.
    const running = !loop.isPaused();
    if (running) pause();
    try {
      const built = buildRuntime(id);
      const drop = () => {
        built.runtime.destroy();
        built.view.destroy();
      };
      let loadedListed: ReturnType<typeof loadListed>;
      try {
        loadedListed = loadListed(
          built.runtime,
          id,
          file.scene.entry !== undefined ? { entry: file.scene.entry } : {},
        );
      } catch (error) {
        drop();
        return {
          ok: false,
          issue: loadRefused(id, error instanceof Error ? error.message : error),
        };
      }
      if (!loadedListed.ok) {
        drop();
        return { ok: false, issue: loadedListed.issue };
      }
      const restored = restoreSave(built.runtime, liveSave(file));
      if (!restored.ok) {
        drop();
        return restored;
      }
      if (cfg.dev)
        for (const issue of restored.issues ?? []) console.info(`[saves] ${issue.message}`);
      if (session) {
        finishRecording(session.requested({ to: id }));
        session = null;
      }
      const scene = built.runtime.scene()!;
      swapIn(built, scene, bundleFor(scene, listed.def, listed.prefabs), restored.report, true);
      resetQueues();
      if (file.depth === "world") seatRestored(built.runtime);
    } finally {
      if (running) resume();
    }
    syncGameSlice();
    events.emit("flow:change", { from, to: id, entry: file.scene.entry ?? null });
    return { ok: true };
  }

  const saves: SaveSlots = game
    ? createSaveSlots({
        game,
        store: pickSaveStore(game, cfg.saves),
        now: () => Date.now(),
        capture: (opts) =>
          loaded
            ? captureSave(loaded.runtime, opts)
            : {
                ok: false,
                issue: makeIssue("save-unsupported", {
                  message: `slot "${opts.slot}" can't be saved: no scene is loaded`,
                }),
              },
        restore: loadSave,
      })
    : inertSaveSlots();

  function reportSave(slot: string, result: SaveWriteResult): void {
    if (destroyed) return;
    if (result.ok) {
      events.emit("save:written", { slot, bytes: result.bytes });
      return;
    }
    if (cfg.dev) console.warn(`[saves] slot "${slot}": ${result.issue.message}`);
    events.emit("save:failed", { slot, issue: result.issue });
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
    touch?.sync();
    camera.setMode(mode === "play" ? "follow" : "free");
    updateCamera(store, camera.getState());
    loaded?.attachment?.onModeChange?.(mode);
    if (mode === "play" && store.state.phase === "running") focusInput();
  }

  /** The loaded scene without what game code spawned, which the next load spawns again. */
  function authoredScene(): ExpandedScene | null {
    const scene = loaded?.runtime.scene();
    if (!scene) return null;
    return { ...scene, entities: scene.entities.filter((e) => !isRuntimeId(e.id)) };
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
          scene: authoredScene(),
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
    const prepared = preparePlay(doc, registry, { dev: cfg.dev, prefabs, project });
    if (!prepared.ok) return { ok: false, issues: prepared.issues };
    finishRecording(session?.stop() ?? null);
    session = null;
    const report = startPlay(prepared.scene, bundleFor(prepared.scene, doc), opts);
    if (report.ok && loaded) {
      session = createSessionRecording({
        rapier: recordingRapier(prepared.scene, rapier),
        game,
        scene: doc.name,
        sceneHash: prepared.hash,
        runHash: prepared.runHash,
        platform: { arch, runtime: "browser", ...cfg.recording?.platform },
        ...(cfg.recording?.projectRef !== undefined
          ? { projectRef: cfg.recording.projectRef }
          : {}),
        start: opts,
        time: loaded.runtime.ctx.time,
        players: loaded.runtime.ctx.input.players(),
        world: playWorld(loaded.runtime.ctx),
        registry,
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
    return playRecorded(doc, recordingStart(recording.start, recording.seed), recording);
  }

  function stop(): void {
    if (destroyed || getMode() !== "play") return;
    finishRecording(session?.stop() ?? null);
    session = null;
    const remembered = editState;
    editState = null;
    const scene = remembered?.scene ?? authoredScene();
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
    const scene = authoredScene();
    if (scene) startPlay(scene, loaded?.bundle ?? null);
    else enterMode("play");
  }

  /** The game's first verdict on this tick, recorded once per session. */
  function judge(result: StepResult, runtime: SceneRuntimeHandle): GameOutcome | null {
    const current = store.state.session;
    const hooks = game?.play;
    if (!current || current.outcome || !hooks?.outcome) return null;
    const verdict = hooks.outcome({
      tick: result.tick,
      snapshot: result.game,
      events: result.events,
      world: playWorld(runtime.ctx),
      persist: runtime.ctx.persist.value,
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
  /** The pointer's screen position at the last simulated tick, so an event game can tell it moved. */
  let tickPointer: Vec2 = input.getMousePosition();
  /** The latest pointer sample, in world metres; null before the pointer was first seen. */
  let pointerNow: PointerState | null = null;
  /** The sample the runtime was last given; a tick carries a new one only when it differs. */
  let pointerSent: PointerState | null = null;
  /** The seat `pointerSent` went to. */
  let pointerSeat: number | null = null;
  /** Where the attachment last saw the pointer during a replay: the recording's latest sample. */
  let replayPointer: Vec2 | null = null;
  /** The devices were read for the coming tick, so the gate's look and the tick share one poll. */
  let sampled = false;
  /** Counts pad polls: an idle game reads its pads every frame without its tick advancing. */
  let padPolls = 0;

  /** A new world starts with nothing pending from the last. */
  function resetQueues(): void {
    input.flush();
    heldInput = [];
    pendingCommands = [];
    tickPointer = input.getMousePosition();
    pointerNow = null;
    pointerSent = null;
    pointerSeat = null;
    replayPointer = null;
    sampled = false;
    queuedJoins = seatSync();
  }

  /**
   * Reads the devices at the start of a tick, once: the pads' changes into
   * play input, and the pointer through the camera into a quantised world
   * sample with its buttons and whether it is over the canvas.
   */
  function sampleDevices(): void {
    if (sampled) return;
    sampled = true;
    applyPads(pads.poll(++padPolls));
    if (!input.hasPointer()) return;
    const reading = input.getPointer();
    const at = camera.screenToWorld({ x: reading.x, y: reading.y });
    pointerNow = {
      x: qPointer(at.x),
      y: qPointer(at.y),
      buttons: reading.buttons,
      over: reading.over,
    };
  }

  /**
   * A poll's pads reach their seats: new pads connect (and, under "auto",
   * take free seats), a first button press may seat a pad, and its edges and
   * value changes become play input for the seat that owns it, combined with
   * every other device's. A pad that went away is released on its seat
   * before the seat is freed. A press a capture takes is no play input.
   */
  function applyPads(poll: GamepadPoll, play = true): void {
    for (const index of poll.connected) padConnected(`pad:${index}`);
    let changes = poll.changes;
    const taken = capturing?.pad(changes);
    if (taken) changes = changes.filter((c) => c !== taken);
    for (const c of changes) if (c.kind === "button" && c.pressed) seats.press(`pad:${c.pad}`);
    syncSeats();
    if (play && changes.length > 0) routePads({ ...poll, changes });
    for (const index of poll.disconnected) seats.disconnect(`pad:${index}`);
    syncSeats(true);
  }

  /**
   * When `changes` happened: the latest browser update among their pads, so
   * a sub-tick offset places a pad edge as it does a key's. A pad with no
   * usable timestamp (none, or off `performance.now()`'s clock) counts as now.
   */
  function padsChangedAt(
    reader: Pick<GamepadView, "updatedAt">,
    changes: readonly PadChange[],
    now: number,
  ): number {
    let at = -Infinity;
    for (const c of changes) {
      const t = reader.updatedAt(c.pad);
      if (t === undefined || !(t <= now && t > now - PAD_CLOCK_WINDOW_MS)) return now;
      at = Math.max(at, t);
    }
    return at === -Infinity ? now : at;
  }

  type PadSink = (
    poll: GamepadPoll,
    reader: Pick<GamepadView, "pads" | "reading">,
    timestamp: number,
  ) => void;

  /** A poll's changes to the seat that owns each pad, read through `reader`: the cursor that polled. */
  function routePads(
    poll: GamepadPoll,
    reader: GamepadView = pads,
    sink: PadSink = input.setPads,
  ): void {
    const now = performance.now();
    if (seatMax === 1) return sink(poll, reader, padsChangedAt(reader, poll.changes, now));
    padTables.forEach((tables, player) => {
      const own = (pad: number) => seats.seatOf(`pad:${pad}`) === player;
      const changes = poll.changes.filter((c) => own(c.pad));
      if (changes.length === 0) return;
      Object.assign(routed, tables);
      const seated = {
        pads: () => reader.pads().filter(own),
        reading: (pad: number, binding: PadBinding) => reader.reading(pad, binding),
      };
      sink({ ...poll, changes }, seated, padsChangedAt(reader, changes, now));
    });
  }

  const subTick = game?.input?.subTick === true;

  /** Each action's offset: where its event fell in the tick-long wall-clock window this tick closes. */
  function stampOffsets(actions: InputAction[], tickMs: number): void {
    const start = performance.now() - tickMs;
    for (const action of actions) action.offset = offsetIn(action.timestamp, start, tickMs);
  }

  function takeInput(tick: number): InputAction[] {
    const polled = input.poll(tick);
    if (heldInput.length === 0) return polled;
    const actions = heldInput.concat(polled);
    heldInput = [];
    for (const action of actions) action.tick = tick;
    return actions;
  }

  /**
   * The pointer sample this tick carries, on the seat that owns the pointer:
   * the latest, when it changed since the last tick's or the pointer changed
   * seats. A pointer no seat owns drives none.
   */
  function takePointers(): (PointerState | undefined)[] {
    tickPointer = input.getMousePosition();
    const now = pointerNow;
    const seat = seatMax === 1 ? 0 : seats.seatOf("pointer");
    if (!now) return [];
    const changed = !pointerSent || seat !== pointerSeat || !samePointer(now, pointerSent);
    pointerSent = now;
    pointerSeat = seat;
    if (!changed || seat === null) return [];
    const out: (PointerState | undefined)[] = Array.from({ length: seat });
    out.push(now);
    return out;
  }

  /**
   * Commands wake every model. Event games also wake on what the tick's
   * input would carry: a button edge or an analog change (any action), a
   * pointer button, and a pointer move only with `wakeOnPointerMove`. Seat changes ride the next tick.
   */
  function wakePending(time: ResolvedTime): boolean {
    sampleDevices();
    if (pendingCommands.length > 0) return true;
    if (time.kind !== "event") return false;
    const polled = input.poll(store.state.tick);
    if (polled.length > 0) heldInput.push(...polled);
    if (heldInput.length > 0) return true;
    if (pointerNow && pointerNow.buttons !== (pointerSent?.buttons ?? 0)) return true;
    if (!time.wakeOnPointerMove || !input.hasPointer()) return false;
    const at = input.getMousePosition();
    return at.x !== tickPointer.x || at.y !== tickPointer.y;
  }

  /** Whether the loop may tick now: always outside play, while replaying and for fixed games. */
  function gate(): boolean {
    if (flowHolding) return false;
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
    camera.update(dt, loaded ? cameraTargetOf(loaded.runtime) : null);
    syncGameSlice();
    updateCamera(store, { position: camera.getPosition() });

    debugOverlay?.update({
      dtMs: dt,
      mouseWorld,
      viewport: camera.getViewport(),
      scale: camera.getState().scale,
      info: hooks?.debugInfo?.() ?? null,
    });
  }

  const loop = createGameLoop({
    tickRate: initialTime.rate,
    maxDeltaMs: cfg.maxDeltaTime,
    ...(initialTime.kind === "fixed" ? {} : { gate }),

    onTick(dt: number) {
      if (flowHolding) {
        shellTick(dt, camera.screenToWorld(input.getMousePosition()));
        return;
      }
      const playing = loaded !== null && getMode() === "play";
      if (playing) sampleDevices();
      sampled = false;
      const polled = takeInput(store.state.tick);
      let mouseWorld = camera.screenToWorld(input.getMousePosition());

      if (loaded && playing) {
        if (subTick) stampOffsets(polled, loaded.runtime.ctx.time.tickMs);
        // Seat by seat, as a replay decodes it, so a run and its replay deliver one order.
        const live = mergeTick({
          tick: loaded.runtime.ctx.tick,
          actions: polled,
          commands: pendingCommands,
          pointers: takePointers(),
          joins: queuedJoins,
        });
        pendingCommands = [];
        queuedJoins = [];
        const replaying = session?.replaying ?? false;
        // A replay steps the recorded tick whole: its pointer, seats and commands, never the live ones.
        const tickInput = session ? session.input(live.tick, live) : live;
        if (replaying) {
          const sample = tickInput.pointers.find((p) => p !== undefined);
          if (sample) replayPointer = { x: sample.x, y: sample.y };
          mouseWorld = replayPointer ?? camera.screenToWorld({ x: 0, y: 0 });
        } else if (pointerNow) {
          mouseWorld = { x: pointerNow.x, y: pointerNow.y };
        }
        loaded.attachment?.onTick?.(dt, mouseWorld);
        const result = loaded.runtime.step(dt, tickInput);
        incrementTick(store);
        events.emit("scene:step", result);
        const requests = loaded.runtime.takeRequests();
        // A replay re-runs the game's save requests; it never writes the player's saves.
        if (!replaying) saveRequested(saves, requests.saves, reportSave);
        const verdict = judge(result, loaded.runtime);
        if (session) {
          const finished = session.stepped(result, tickInput, verdict);
          finishRecording(finished);
          // A replay holds its last frame until Stop, so the end state can be looked at.
          if (finished && replaying) pause();
        }
        if (requests.flow) flowRequested(requests.flow, result.tick, verdict);
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
      // A frame's look at the devices ends with it; the next frame reads them afresh.
      sampled = false;
      pollFrame();
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

  /**
   * Why `command` can't be queued now, or the command as it is queued: a
   * game command keeps its sending seat (`player`, 0 when absent and then
   * left off, as a replay decodes it); `@elapsed` belongs to no seat.
   */
  function commandProblem(command: GameCommand): { why: string } | { command: GameCommand } {
    if (destroyed) return { why: "game destroyed" };
    if (!loaded || getMode() !== "play") return { why: "nothing is playing" };
    if (session?.replaying) return { why: "a replay plays its recorded commands" };
    const player = command.player ?? 0;
    const seat = seatProblem(player, seatMax);
    if (seat) return { why: `${seat.code}: ${seat.message}` };
    const checked = checkCommand(registry, command);
    if (!checked.ok) return { why: checked.message };
    if (checked.command.name !== "@elapsed") {
      return { command: player === 0 ? checked.command : { ...checked.command, player } };
    }
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
    if (getMode() !== "play") return false;
    if (loaded?.attachment?.onCancel?.()) return true;
    return self !== null && cancelMountedUi(self);
  }

  function pointerWorld(): Vec2 | null {
    return input.hasPointer() ? camera.screenToWorld(input.getMousePosition()) : null;
  }

  /** Page px to world metres, through the input target's rect, the bars, the zoom and the px per metre. */
  function clientToWorld(clientX: number, clientY: number): Vec2 {
    const rect = inputTarget.getBoundingClientRect();
    return camera.screenToWorld({ x: clientX - rect.left, y: clientY - rect.top });
  }

  /** World metres to page px: `clientToWorld`'s inverse, through the camera and the input target's rect. */
  function worldToClient(p: Vec2): { x: number; y: number } {
    const rect = inputTarget.getBoundingClientRect();
    const screen = camera.worldToScreen(p);
    return { x: rect.left + screen.x, y: rect.top + screen.y };
  }

  /**
   * The input map's on-screen controls over the canvas, shown in play per
   * `GameConfig.input.touch` (auto: while the primary pointer is coarse). A
   * touch that starts on a shown control drives it; any other is the pointer.
   */
  function createTouchOverlay(): { sync(): void; destroy(): void } | null {
    const defs = project?.inputMap?.touch ?? [];
    const policy = cfg.input?.touch ?? "auto";
    // A canvas can't hold the overlay, so it goes in the canvas's frame.
    const host = inputTarget instanceof HTMLCanvasElement ? inputTarget.parentElement : inputTarget;
    if (defs.length === 0 || policy === "never" || !host) return null;
    const coarse = policy === "auto" ? coarsePointer() : null;
    const controls: TouchControls = createTouchControls(host, defs, (control, value) =>
      input.setControl(control, value, performance.now()),
    );
    input.setTouchControls({
      controlAt(screen) {
        const rect = inputTarget.getBoundingClientRect();
        return controls.hitTest(rect.left + screen.x, rect.top + screen.y);
      },
    });
    const sync = () =>
      controls.show(getMode() === "play" && (policy === "always" || (coarse?.matches ?? false)));
    coarse?.addEventListener?.("change", sync);
    sync();
    return {
      sync,
      destroy() {
        coarse?.removeEventListener?.("change", sync);
        input.setTouchControls(null);
        controls.destroy();
      },
    };
  }

  /** Document-wide pointer moves feed play input while a host tracks a DOM drag. */
  let tracking = false;

  function onDocumentPointerMove(e: PointerEvent): void {
    // Moves over the input target already reach play input through the router.
    if (e.target instanceof Node && inputTarget.contains(e.target)) return;
    const rect = inputTarget.getBoundingClientRect();
    const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const inside =
      screen.x >= 0 && screen.y >= 0 && screen.x < rect.width && screen.y < rect.height;
    const move: ToolEvent = {
      kind: "pointer",
      type: "move",
      screen,
      button: -1,
      deltaY: 0,
      // Read as a mouse whatever the device: a tracked move only moves the pointer.
      pointerType: "mouse",
      native: e,
    };
    if (!inside) move.left = true;
    const play = input.consumer();
    if (play.accepts(move)) play.handle(move);
  }

  function trackPointer(on: boolean): void {
    if ((on && destroyed) || on === tracking) return;
    tracking = on;
    if (on) document.addEventListener("pointermove", onDocumentPointerMove, true);
    else document.removeEventListener("pointermove", onDocumentPointerMove, true);
  }

  // ─── Remapping ────────────────────────────────────────────

  function kindOfAction(action: string) {
    return registry.actions.find((a) => a.action === action)?.kind ?? "button";
  }

  /** The first thing wrong with remapping `action` to `list` for `player`, by the one binding check. */
  function remapProblem(
    action: string,
    list: readonly Binding[],
    player: number,
  ): BindingProblem | null {
    const unknown = actionProblem(action, registry.actionNames);
    if (unknown) return unknown;
    const seat = seatProblem(player, seatMax);
    if (seat) return { ...seat, path: "/player" };
    if (!Array.isArray(list)) {
      return { code: "binding-unknown", message: "bindings must be a list", path: "/bindings" };
    }
    const ctx = { kind: kindOfAction(action), max: seatMax, controls };
    for (const [i, binding] of list.entries()) {
      const problem = bindingProblems(binding, ctx)[0];
      if (problem) return { ...problem, path: `/bindings/${i}${problem.path}` };
    }
    return null;
  }

  /** Saves the remaps at once (a store that fails leaves them applied for this session) and applies them from the next tick. */
  function commitRemaps(): void {
    try {
      if (remaps && remapKey !== null) remaps.save(remapKey, remap);
    } catch (error) {
      if (cfg.dev) console.warn("[game] input remaps failed to save", error);
    }
    // What the old bindings hold lets go first, so nothing stays down under a binding that's gone.
    input.releaseAll(performance.now());
    bindings = resolveAll();
    routeDevices(true);
  }

  /**
   * Swaps in the current project's input map: the old overlay and every
   * held binding let go first (as releases), then the bindings and the touch
   * overlay are rebuilt from the new map. The player's remaps stay, less any
   * the new map no longer allows (a touch control it dropped). Seats and the
   * pad deadzone keep what the instance started with.
   */
  function reloadInputMap(): void {
    touch?.destroy();
    input.releaseAll(performance.now());
    controls = controlIds();
    const players: Record<number, Record<string, readonly Binding[]>> = {};
    for (const [seat, actions] of Object.entries(remap.players)) {
      for (const [action, list] of Object.entries(actions)) {
        if (!remapProblem(action, list, Number(seat)))
          (players[Number(seat)] ??= {})[action] = list;
      }
    }
    remap = { v: 1, players };
    bindings = resolveAll();
    routeDevices(true);
    touch = createTouchOverlay();
  }

  function rebind(
    action: string,
    list: readonly Binding[],
    opts: { player?: number } = {},
  ): { ok: true } | { ok: false; issue: SceneIssue } {
    const player = opts.player ?? 0;
    const problem = remapProblem(action, list, player);
    if (problem) {
      const { code, message, path, expected, got, hint } = problem;
      if (cfg.dev) console.warn(`[game] input.rebind("${action}"): ${message} (${code})`);
      const issue = makeIssue(code, {
        message,
        path,
        ...(expected !== undefined ? { expected } : {}),
        ...(got !== undefined ? { got } : {}),
        ...(hint !== undefined ? { hint } : {}),
      });
      return { ok: false, issue };
    }
    remap = {
      v: 1,
      players: {
        ...remap.players,
        [player]: { ...remap.players[player], [action]: list.map((b) => ({ ...b })) },
      },
    };
    commitRemaps();
    return { ok: true };
  }

  function reset(action?: string, opts: { player?: number } = {}): void {
    const player = opts.player ?? 0;
    const seat = remap.players[player];
    if (!seat || (action !== undefined && !Object.hasOwn(seat, action))) return;
    const players = { ...remap.players };
    if (action === undefined) delete players[player];
    else {
      const { [action]: _dropped, ...rest } = seat;
      if (Object.keys(rest).length > 0) players[player] = rest;
      else delete players[player];
    }
    remap = { v: 1, players };
    commitRemaps();
  }

  /** The capture waiting for a press, if any; a new capture ends the last one with null. */
  let capturing: {
    /** Takes the first pad press a capture accepts from a poll's changes, ending the capture. */
    pad(changes: readonly PadChange[]): PadChange | null;
    end(binding: Binding | null): void;
  } | null = null;

  /**
   * Resolves with the next key, pad button or pointer press, whatever has
   * focus, and keeps it from reaching the game or the page; Escape cancels.
   * Pads are read while it waits, outside play too.
   */
  function capture(
    opts: { devices?: readonly CaptureDevice[]; timeoutMs?: number } = {},
  ): Promise<Binding | null> {
    capturing?.end(null);
    if (destroyed) return Promise.resolve(null);
    const devices = opts.devices ?? ["key", "pad", "pointer"];
    return new Promise((resolve) => {
      const judge = (press: CapturePress, native?: Event): boolean => {
        const result = matchCapturePress(press, devices);
        if (result.kind === "wait") return false;
        native?.preventDefault();
        native?.stopPropagation();
        current.end(result.kind === "bind" ? result.binding : null);
        return true;
      };
      const onKey = (e: KeyboardEvent) =>
        void judge({ device: "key", code: e.code, repeat: e.repeat }, e);
      const onPointer = (e: PointerEvent) => void judge({ device: "pointer", button: e.button }, e);
      const listening = devices.includes("pad") && typeof navigator.getGamepads === "function";
      // Reads the pads only when no tick has since the last look, so a running game's polls stay one per tick.
      let seen = padPolls;
      const poll = listening
        ? setInterval(() => {
            if (padPolls === seen)
              applyPads(pads.poll(++padPolls), loaded !== null && getMode() === "play");
            seen = padPolls;
          }, CAPTURE_POLL_MS)
        : null;
      const timeout =
        opts.timeoutMs !== undefined ? setTimeout(() => current.end(null), opts.timeoutMs) : null;
      window.addEventListener("keydown", onKey, true);
      window.addEventListener("pointerdown", onPointer, true);
      const current: NonNullable<typeof capturing> = {
        pad(changes) {
          for (const change of changes) {
            if (change.kind !== "button" || !change.pressed) continue;
            if (judge({ device: "pad", button: change.button })) return change;
          }
          return null;
        },
        end(binding) {
          if (capturing === current) capturing = null;
          window.removeEventListener("keydown", onKey, true);
          window.removeEventListener("pointerdown", onPointer, true);
          if (poll !== null) clearInterval(poll);
          if (timeout !== null) clearTimeout(timeout);
          resolve(binding);
        },
      };
      capturing = current;
    });
  }

  function assign(device: DeviceId, player: number | null): void {
    if (destroyed) return;
    const problem = seats.assign(device, player);
    if (problem && cfg.dev) {
      console.warn(
        `[game] input.assign("${device}", ${player}): ${problem.message} (${problem.code})`,
      );
    }
    syncSeats();
  }

  /** Pads reach seats as the browser reports them; in play the next poll does the same, in order with their input. */
  function onPadConnected(e: GamepadEvent): void {
    padConnected(`pad:${e.gamepad.index}`);
    syncSeats();
  }

  function onPadDisconnected(e: GamepadEvent): void {
    // In play the poll releases what the pad held on its seat before freeing it.
    if (loaded && getMode() === "play") return;
    seats.disconnect(`pad:${e.gamepad.index}`);
    syncSeats();
  }

  window.addEventListener("gamepadconnected", onPadConnected);
  window.addEventListener("gamepaddisconnected", onPadDisconnected);

  // ─── Action listeners ─────────────────────────────────────

  function onAction(
    listener: (e: UiActionEvent) => void,
    opts?: { actions?: readonly string[] },
  ): () => void {
    return destroyed ? () => {} : input.onAction(listener, opts);
  }

  /**
   * Each frame while anything listens, whatever the mode and whether or not
   * a tick runs: the pads' changes since the last frame reach the listeners
   * (and only them) on the seats that own the pads. A capture's presses stay
   * out, as its keys do; their releases pass, so nothing is left held.
   */
  function pollFrame(): void {
    if (destroyed || !input.listening()) return;
    const poll = pads.pollFrame();
    const changes = capturing
      ? poll.changes.filter((c) => !(c.kind === "button" && c.pressed))
      : poll.changes;
    if (changes.length > 0) routePads({ ...poll, changes }, pads.frame, input.setFramePads);
  }

  const playerInput: GameInput = {
    bindings: (player) => bindings.bindings(player),
    rebind,
    reset,
    capture,
    assign,
    players: () => seats.players(),
    trackPointer,
    onAction,
  };

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

  // ─── Scene flow ───────────────────────────────────────────

  let transitionLayer: { root: HTMLElement; destroy(): void } | null = null;

  function flowLayer(): HTMLElement | null {
    if (destroyed) return null;
    if (!transitionLayer && canvas.parentElement) transitionLayer = createTransitionLayer(canvas);
    return transitionLayer?.root ?? null;
  }

  function currentScene(): AssetId | null {
    return loaded?.runtime.ctx.flow.scene ?? null;
  }

  /** Unloads the playing scene in place; the returned function loads it again after a failed change. */
  function flowUnload(): () => void {
    const prior = loaded;
    if (!prior) return () => {};
    const { runtime } = prior;
    const id = runtime.ctx.flow.scene;
    const entry = runtime.ctx.flow.entry;
    const authored = id === null ? authoredScene() : null;
    runtime.unload();
    syncGameSlice();
    return () => {
      if (destroyed || loaded !== prior) return;
      const back =
        id !== null ? loadListed(runtime, id, { entry }) : authored ? runtime.load(authored) : null;
      if (back && !back.ok && cfg.dev) console.warn("[flow] the previous scene didn't load again");
      syncGameSlice();
    };
  }

  function flowLoad(
    id: AssetId,
    opts: { entry: string | null; persist?: JsonValue; reset?: boolean },
  ): FlowResult {
    if (destroyed) return { ok: false, issue: loadRefused(id, "game destroyed") };
    const listed = cfg.flow?.source.scene(id) ?? null;
    // A recording covers one scene: a change during a Play session ends it there.
    if (session) {
      finishRecording(session.requested({ to: id }));
      session = null;
    }
    const before = opts.reset ? persist.value : undefined;
    const clock = playClockOf(persist);
    const ticksBefore = clock.ticks;
    if (opts.reset) {
      persist.reset();
      clock.ticks = 0;
    }
    const built = buildRuntime(id);
    let result: ReturnType<typeof loadListed>;
    try {
      result = loadListed(built.runtime, id, {
        entry: opts.entry,
        ...(opts.persist !== undefined ? { persist: opts.persist } : {}),
      });
    } catch (error) {
      result = {
        ok: false,
        issue: loadRefused(id, error instanceof Error ? error.message : error),
      };
    }
    if (!result.ok) {
      if (result.report) discard(built, result.report);
      else {
        built.runtime.destroy();
        built.view.destroy();
      }
      if (before !== undefined) persist.set(before);
      clock.ticks = ticksBefore;
      return { ok: false, issue: result.issue };
    }
    const scene = built.runtime.scene()!;
    const bundle = listed ? bundleFor(scene, listed.def, listed.prefabs) : null;
    swapIn(built, scene, bundle, result.report, true);
    return { ok: true, scene: id, report: result.report };
  }

  const flowHost = cfg.flow
    ? createFlowHost({
        source: cfg.flow.source,
        ...(cfg.flow.transition ? { transition: cfg.flow.transition } : {}),
        ...(cfg.flow.loading !== undefined ? { loading: cfg.flow.loading } : {}),
        layer: flowLayer,
        current: currentScene,
        setTicking: (on) => {
          flowHolding = !on;
        },
        unload: flowUnload,
        preload: (_id, listed, onProgress) => {
          const scene = expandScene(listed.def, registry, {
            prefabs: listed.prefabs,
            engine: project?.engine,
          });
          return preloadExpanded(scene, listed.def, listed.prefabs, onProgress);
        },
        load: flowLoad,
        changed: (e) => events.emit("flow:change", e),
        loadingProgress: (p) => events.emit("flow:loading", p),
        destroyed: () => destroyed,
        dev: cfg.dev,
      })
    : null;

  /**
   * A drained flow request, after its tick. The editor's Play stays on its
   * scene: the request ends the session with a `flow` outcome and holds the
   * frame, unless the game decided an outcome first. Otherwise the host
   * changes scene.
   */
  function flowRequested(req: FlowRequest, tick: number, verdict: GameOutcome | null): void {
    const current = store.state.session;
    if (current) {
      if (verdict || current.outcome) return;
      const outcome: PlayOutcome = { result: "flow", to: req.to, tick };
      setSession(store, { ...current, outcome });
      events.emit("play:outcome", outcome);
      finishRecording(session?.requested(req) ?? null);
      pause();
      return;
    }
    if (!flowHost) {
      if (cfg.dev) console.warn(`[flow] "${req.to}" was requested, but the host gave no scenes`);
      return;
    }
    const { to, ...rest } = req;
    void flowHost.go(to, rest).then((r) => {
      if (!r.ok && cfg.dev)
        console.warn(`[flow] the request for "${to}" failed: ${r.issue.message}`);
    });
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
    const def = isExpandedScene(source) ? null : source;
    return preloadExpanded(expanded.scene, def, prefabs, onProgress);
  }

  async function preloadExpanded(
    scene: ExpandedScene,
    def: SceneDefinition | null,
    defPrefabs: PrefabLibrary,
    onProgress?: (p: LoadProgress) => void,
  ): Promise<{ failed: BundleEntry[] }> {
    const physics =
      scene.settings.physics === "rapier"
        ? loadRapier().catch((error: unknown) => {
            if (cfg.dev) console.warn(`[scene] Rapier failed to load`, error);
          })
        : null;
    const bundle = assets ? bundleFor(scene, def, defPrefabs) : null;
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
    const mapMoved = !sameValue(update.project?.inputMap ?? null, project?.inputMap ?? null);
    project = update.project;
    if (mapMoved) reloadInputMap();
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
    flowHost?.destroy();
    transitionLayer?.destroy();
    capturing?.end(null);
    trackPointer(false);
    window.removeEventListener("gamepadconnected", onPadConnected);
    window.removeEventListener("gamepaddisconnected", onPadDisconnected);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    inputTarget.removeEventListener("blur", onInputBlur);
    debugOverlay?.destroy();
    teardownScene();
    if (editState?.bundle) assets?.loader.release(editState.bundle);
    editState = null;
    if (projectAssets) assets?.loader.release(projectAssets);
    router.destroy();
    touch?.destroy();
    pads.destroy();
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

  self = {
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
    clientToWorld,
    worldToClient,
    project: () => project,
    input: playerInput,
    panBy,
    zoomAt,
    frame,
    extractPixels: (world) => renderer.extractPixels(world),
    flow: {
      get start() {
        return cfg.flow?.source.start() ?? null;
      },
      get scenes() {
        return cfg.flow?.source.list() ?? [];
      },
      current: currentScene,
      go: (to, opts) => (flowHost ? flowHost.go(to, opts) : Promise.resolve(flowUnavailable())),
      restart: () => (flowHost ? flowHost.restart() : Promise.resolve(flowUnavailable())),
    },
    saves,
  };
  return self;
}

/** A save's scene that didn't build: the expand's or the load's own words. */
function loadRefused(scene: string, why: unknown): SceneIssue {
  return makeIssue("schema", {
    message: `the save's scene "${scene}" didn't load: ${String(why)}`,
    entityIds: [scene],
  });
}

function flowUnavailable(): FlowResult {
  return {
    ok: false,
    issue: makeIssue("start-scene-missing", {
      message: "this game instance can't change scenes: scene flow is not available",
    }),
  };
}

/**
 * Where the camera looks: the game's target, or, in a scene no game runs,
 * Play's start when Play began from a point, else the centre of the scene's
 * bounds. An edit world without a game leaves the camera to the editor.
 */
function cameraTargetOf(runtime: SceneRuntimeHandle): Vec2 | null {
  if (runtime.game) return runtime.game.cameraTarget?.() ?? null;
  const { play, bounds } = runtime.ctx;
  if (!play) return null;
  if (play.at) return { x: play.at.x, y: play.at.y };
  const [minX, minY, maxX, maxY] = bounds;
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

/** Whether the primary pointer is coarse (a touch screen); null where media queries aren't available. */
function coarsePointer(): MediaQueryList | null {
  try {
    return typeof window.matchMedia === "function" ? window.matchMedia("(pointer: coarse)") : null;
  } catch {
    return null;
  }
}

type UserAgentData = {
  getHighEntropyValues?(hints: string[]): Promise<{ architecture?: unknown; bitness?: unknown }>;
};

/**
 * The CPU architecture in `process.arch`'s names (`x64`, `arm64`), from
 * Chromium's user-agent client hints; "unknown" where the browser doesn't
 * say, which a replay never warns about.
 */
export async function browserArch(): Promise<string> {
  try {
    const data = (globalThis.navigator as { userAgentData?: UserAgentData } | undefined)
      ?.userAgentData;
    const values = await data?.getHighEntropyValues?.(["architecture", "bitness"]);
    const cpu = values?.architecture;
    if (typeof cpu !== "string" || cpu === "") return "unknown";
    const wide = values?.bitness === "64";
    if (cpu === "x86") return wide ? "x64" : "ia32";
    if (cpu === "arm") return wide ? "arm64" : "arm";
    return cpu;
  } catch {
    return "unknown";
  }
}

/** How often a waiting capture reads the pads while nothing simulates. */
const CAPTURE_POLL_MS = 16;

type Tables = { -readonly [K in keyof DeviceTables]: DeviceTables[K] };
type PadTables = Pick<DeviceTables, "padButtons" | "padAxes" | "padSticks">;

/** The device a play event presses: a key (not a repeat), a mouse or pen button, or a touch. */
function pressedDevice(e: ToolEvent): DeviceId | null {
  if (e.kind === "key") return e.type === "down" && !e.native.repeat ? "keyboard" : null;
  if (e.type !== "down") return null;
  return e.pointerType === "touch" ? "touch" : "pointer";
}

const samePointer = (a: PointerState, b: PointerState): boolean =>
  a.x === b.x && a.y === b.y && a.buttons === b.buttons && a.over === b.over;

/** The host's bindings are judged by the same check as the game's, but only warned about: the game still plays. */
function warnHostBindings(list: readonly InputBinding[], resolved: ResolvedBindings): void {
  for (const entry of list) {
    const ctx = { kind: resolved.kindOf(entry.action), max: resolved.players };
    for (const problem of keysProblems(entry)) {
      console.warn(
        `[game] GameConfig.bindings "${entry.action}"${problem.path}: ${problem.message} (${problem.code})`,
      );
    }
    actionBindings(entry).forEach((binding, i) => {
      for (const problem of bindingProblems(binding, ctx)) {
        console.warn(
          `[game] GameConfig.bindings "${entry.action}" #${i}${problem.path}: ${problem.message} (${problem.code})`,
        );
      }
    });
  }
}
