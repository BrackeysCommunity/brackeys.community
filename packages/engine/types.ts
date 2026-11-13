import type { Store } from "@tanstack/store";

import type { DebugLayerFactory, DebugOverlayFactory } from "./debug";
import type { FlowRequest, LibraryScene, SceneListEntry, TransitionSpec } from "./game/flow";
import type { SceneSwap, SwapTiming } from "./game/live";
import type {
  ActionKind,
  Binding,
  DeviceId,
  GameCommand,
  GameDefinition,
  GameOutcome,
  PlayerInfo,
  Registry,
} from "./game/types";
import type { PlayOptions } from "./headless/playtest-types";
import type { RemapStore } from "./input/remap";
import type { BundleEntry } from "./project/bundle";
import type { KindRegistry } from "./project/kinds";
import type { ReleaseManifest } from "./project/release";
import type { ProjectRuntimeView } from "./project/runtime-view";
import type { SceneVersion } from "./project/scene-version";
import type { AssetId, ProjectView, Sha256 } from "./project/types";
import type { AssetLoader, LoadProgress } from "./render/asset-loader";
import type { ResolutionPolicy } from "./resolution";
import type { RecordingHost } from "./runtime/recorder";
import type {
  AssetReloadError,
  LoadFailureReason,
  LoadReport,
  SceneRuntime,
  StepResult,
} from "./runtime/types";
import type { SaveSlots } from "./saves/slots";
import type { SaveStore } from "./saves/store";
import type { RunRecording } from "./scene/recording-schema";
import type {
  Aabb,
  ExpandedScene,
  PrefabLibrary,
  SceneDefinition,
  SceneIssue,
} from "./scene/types";
import type { ToolRouter } from "./tool-router";

// ─── Primitives ──────────────────────────────────────────

export type Vec2 = { x: number; y: number };

export type RapierModule = typeof import("@dimforge/rapier2d");

// ─── Config ──────────────────────────────────────────────

export type GameConfig = {
  /** What the shell plays: its entity types, actions, hooks and play-mode tools; null plays an engine-only project's scenes under createRegistry(null). */
  game: GameDefinition | null;
  /** A registry the host already built from `game`, so host and shell share one; built here when omitted. */
  registry?: Registry;
  displayWidth: number;
  displayHeight: number;
  backgroundColor: number;
  /** @deprecated Ignored: the loop ticks at the game's `time.rate` (or the project's `engine.tickRate`). */
  targetFPS: number;
  maxDeltaTime: number;
  camera: CameraConfig;
  /**
   * The host's bindings: one of four layers per action and seat (the
   * player's remap, these, the project's input map, the game's `actions`).
   * The first layer that binds an action wins and replaces its bindings whole.
   */
  bindings?: readonly InputBinding[];
  /** On-screen controls and where a player's remaps persist. */
  input?: {
    /** When the input map's on-screen controls show; auto: on a coarse pointer (`matchMedia("(pointer: coarse)")`). */
    touch?: "auto" | "always" | "never";
    /** Where the player's remaps are saved and restored; none without one. */
    remaps?: RemapStore;
  };
  /** Where pointer and key input is read. Defaults to the canvas, made focusable. */
  inputTarget?: HTMLElement;
  /**
   * Where key events are read instead, so editor shortcuts work with focus on
   * a panel beside the canvas (pointers still come only from `inputTarget`).
   * Play input still takes a key press only when focus is in `inputTarget`.
   * Defaults to `inputTarget`.
   */
  keyTarget?: HTMLElement | Window;
  /** Enables dev logging, and the debug overlay when `debug` is given; hosts pass their build's dev flag. */
  dev: boolean;
  /** `createDebugOverlay` from `@jams/engine/debug`, passed only in dev builds so production never bundles it. */
  debug?: DebugOverlayFactory;
  /** The game's debug layers, shown after the engine's as F3 cycles; dev builds only, like `debug`. */
  debugLayers?: readonly DebugLayerFactory[];
  /**
   * Time where each tick and frame goes from the start: `runtime().stats().timing`
   * reports the runtime's step by part, the shell's tick around it, the
   * frame's work before the draw and Pixi's draw call. Default off, when
   * no tick or frame reads a clock for it; a dev host's debug overlay can
   * switch it on while the game runs.
   */
  timing?: boolean;
  /**
   * Loads the Rapier module: `() => import("@dimforge/rapier2d")` in a browser,
   * or `@dimforge/rapier2d-compat` (cast) after its `init()` in Bun or Node.
   * `createGame` awaits it only when the game's default physics (or the
   * start-up scene's) is Rapier; `preload` brings it in for a Rapier scene.
   * A game whose scenes all run without physics needs none.
   */
  rapier?: () => Promise<RapierModule>;
  /** The Rapier package and the project's snapshot, for Play's recordings; the engine fills the arch and runtime. */
  recording?: RecordingHost & {
    /**
     * Also records the scene flow's run outside the editor's Play: each
     * scene `flow` loads is a session until the next load, which ends it as
     * `flow`. A load from a save isn't recorded. Default false.
     */
    flow?: boolean;
  };
  /** Loaded on start, expanded through `registry` when it is a document. Without one the world is empty. */
  scene?: SceneDefinition | ExpandedScene;
  /** The prefabs scene documents' instances name; `setPrefabs` replaces them. */
  prefabs?: PrefabLibrary;
  /**
   * Where scenes' textures come from: the host's loader (built with its URL
   * scheme), the project view bundles are computed over, and its kinds.
   * Without it nothing is fetched and sprites draw as their boxes. `view`
   * is read each time a bundle is computed, so a getter can follow a live
   * project. The runtime view sprites size from is `createGame`'s `project`.
   */
  assets?: { loader: AssetLoader; view: ProjectView; kinds: KindRegistry };
  /** The host's resolution policy, over the project's and the game's. */
  resolution?: Partial<ResolutionPolicy>;
  /** Scenes for `GameInstance.flow`, and how a change between them looks. */
  flow?: {
    /** Where scenes come from: the site's files, a release's data, a test's map. */
    source: SceneSource;
    /** Runs a transition's halves; default `fadeTransition()` for "fade", nothing for "none". */
    transition?: TransitionRunner;
    /** Shown when a load takes longer than 150 ms; default `createLoadingOverlay()`; false for none. */
    loading?: LoadingViewFactory | false;
  };
  /** The host's save store; a game's own (`GameDefinition.saves.store`) wins, and the browser's is the default. */
  saves?: SaveStore;
  /** How the shell draws, and what it shows while the GPU context is restored. */
  renderer?: RendererConfig;
  /** The release this instance plays; the recorder writes its id as `release`. */
  release?: { id: Sha256; manifest: ReleaseManifest };
};

export type RendererConfig = {
  /** Default "webgpu"; the shell falls back to "webgl" on failure or loss. */
  preference?: "webgpu" | "webgl";
  /** Shown while restoring; default a centred "Restoring graphics…" line. */
  lostOverlay?: (layer: HTMLElement) => { destroy(): void };
};

/** A GPU backend the shell draws with. */
export type RenderBackend = "webgpu" | "webgl";

// ─── Flow ────────────────────────────────────────────────

/** The scenes a host can play: the scene list, its start, and each listed scene's data. */
export type SceneSource = {
  list(): readonly SceneListEntry[];
  start(): AssetId | null;
  /** Synchronous: every listed scene's text is resident, since sublevels attach inside a step. */
  scene(id: AssetId): LibraryScene | null;
};

/** Runs one half of a transition over `layer`, which sits above the game's UI. */
export type TransitionRunner = (
  phase: "out" | "in",
  spec: TransitionSpec,
  layer: HTMLElement,
) => Promise<void>;

/** What the flow host shows while a slow load runs. */
export type LoadingView = { show(p: LoadProgress): void; hide(): void };
/** Builds the loading view inside the host's layer. */
export type LoadingViewFactory = (layer: HTMLElement) => LoadingView;

/** What a scene change did: the scene it loaded, or why it refused (`scene-unlisted`, `start-scene-missing`, a load's refusal). */
export type FlowResult =
  | { ok: true; scene: AssetId; report: LoadReport }
  | { ok: false; issue: SceneIssue };

/** `GameInstance.flow`: the scene list and changes between its scenes. */
export type GameFlow = {
  readonly start: AssetId | null;
  readonly scenes: readonly SceneListEntry[];
  /** The main scene playing, or null. */
  current(): AssetId | null;
  /** Changes scene between ticks, through the transition; a `go` during a change waits for it. */
  go(to: AssetId, opts?: Omit<FlowRequest, "to">): Promise<FlowResult>;
  /** Loads `start` with persist reset to the game's initial value. */
  restart(): Promise<FlowResult>;
};

export const DEFAULT_GAME_CONFIG: Omit<GameConfig, "game" | "rapier"> = {
  displayWidth: 1920,
  displayHeight: 1080,
  backgroundColor: 0x1a1a2e,
  targetFPS: 60,
  maxDeltaTime: 250,
  dev: false,
  camera: {
    lerpSpeed: 0.1,
    bounds: {
      min: { x: -20, y: -20 },
      max: { x: 40, y: 20 },
    },
  },
};

// ─── Camera ──────────────────────────────────────────────

export type CameraConfig = {
  lerpSpeed: number;
  /** World metres; used until a scene loads; each load replaces them with the scene's bounds plus a margin. */
  bounds: { min: Vec2; max: Vec2 };
};

/** `follow` eases toward the game's camera target; `free` holds wherever it was put. */
export type CameraMode = "follow" | "free";

export type CameraState = {
  position: Vec2;
  zoom: number;
  /** Canvas px per world metre: the display scale (the policy's scale × the game's px per metre) times `zoom`. */
  scale: number;
  bounds: { min: Vec2; max: Vec2 };
  mode: CameraMode;
};

/** The loop's simulation controls: a paused loop runs no ticks, and `timeScale` scales simulated time per frame. */
export type SimState = {
  paused: boolean;
  timeScale: number;
};

// ─── Input ───────────────────────────────────────────────

export type InputBinding = {
  action: string;
  bindings?: readonly Binding[];
  /**
   * @deprecated 0.x layout keys, read as `{ device: "key", code }` for each
   * code `KEY_TO_CODE` gives the key; use `bindings`.
   */
  keys?: readonly string[];
};

export type InputAction = {
  action: string;
  /** Buttons: down. Axes and vectors: the value isn't zero. */
  pressed: boolean;
  /** An axis's value in −1…1, quantised to 1/1000. */
  value?: number;
  /** A vector's components, in the unit disc, quantised to 1/1000. */
  x?: number;
  y?: number;
  /** The seat; 0 when absent. */
  player?: number;
  tick: number;
  timestamp: number;
  /** Where in the tick it happened, 0…1 in thousandths; only with `GameDefinition.input.subTick`. */
  offset?: number;
};

/** A seat's bindings by action. */
export type ActionBindings = Readonly<Record<string, readonly Binding[]>>;

/** The shell's input: bindings per seat, remapping, seats and the pointer. */
export type GameInput = {
  /** A seat's bindings by action (default seat 0). */
  bindings: (player?: number) => ActionBindings;
  /** Replaces an action's bindings for a seat, saved through `GameConfig.input.remaps` and applied from the next tick. */
  rebind: (
    action: string,
    bindings: readonly Binding[],
    opts?: { player?: number },
  ) => { ok: true } | { ok: false; issue: SceneIssue };
  /** Drops a seat's remap of `action`, or of every action. */
  reset: (action?: string, opts?: { player?: number }) => void;
  /** The next key, pad button or pointer press, for a "press a key" prompt; null on timeout or Escape. */
  capture: (opts?: {
    devices?: readonly ("key" | "pad" | "pointer")[];
    timeoutMs?: number;
  }) => Promise<Binding | null>;
  /** Gives a device to a seat, or frees it with null (`join: "host"`). */
  assign: (device: DeviceId, player: number | null) => void;
  players: () => readonly PlayerInfo[];
  /** While on, pointer moves anywhere in the document update the pointer sample, so a DOM drag shows in the world. */
  trackPointer: (on: boolean) => void;
  /** Every action edge and analog change as devices produce them, simulation idle or not; returns the unsubscribe. */
  onAction: (
    listener: (e: UiActionEvent) => void,
    opts?: { actions?: readonly string[] },
  ) => () => void;
};

/** One action change delivered to `GameInput.onAction` listeners, UI-only or not. */
export type UiActionEvent = {
  action: string;
  player: number;
  kind: ActionKind;
  device: DeviceId;
  /** Buttons: the edge; with `repeat` true for the OS's key repeat. */
  down?: boolean;
  repeat?: boolean;
  /** Axes and vectors: the quantised value. */
  value?: number;
  vector?: Vec2;
};

// ─── Events ──────────────────────────────────────────────

export type GameEventMap = {
  "game:start": undefined;
  "game:pause": undefined;
  "game:destroy": undefined;
  "game:tick": { tick: number };
  /** Each simulated tick in play mode, with the step's events and the game's snapshot. */
  "scene:step": StepResult;
  /** The game's first verdict in a play session, from its `play.outcome`. */
  "play:outcome": PlayOutcome;
  /** A play session's recording, finished at the game's first verdict, a replay's last tick, or Stop. */
  "play:recorded": RunRecording;
  /** A scene change finished. */
  "flow:change": { from: AssetId | null; to: AssetId; entry: string | null };
  /** A scene change's load progress. */
  "flow:loading": LoadProgress;
  /** A save landed in the store. */
  "save:written": { slot: string; bytes: number };
  /** A save didn't land; game code never sees why. */
  "save:failed": { slot: string; issue: SceneIssue };
  /** The GPU context or device was lost; the game pauses until it is restored. */
  "render:lost": { backend: RenderBackend };
  /** Drawing resumed: in place (`rebuilt: false`) or on a new renderer. */
  "render:restored": { backend: RenderBackend; rebuilt: boolean };
  /** Rebuilding the renderer after a loss failed: nothing draws again, and `render:restored` never follows. */
  "render:failed": { backend: RenderBackend };
  /** WebGPU failed at start or was lost, and the shell draws with WebGL for the rest of the session. */
  "render:fallback": { from: "webgpu"; reason: "init" | "lost" };
  /** A new version of the running scene was applied between ticks, after the game's `onSwap`. */
  "live:swapped": SceneSwap;
  /** A version couldn't be staged or applied; the old one keeps running and the new one waits for the next load. */
  "live:failed": { scene: AssetId; version: Sha256 | null; issue: SceneIssue };
};

// ─── Store ───────────────────────────────────────────────

/** `edit` pauses the simulation; `play` runs it. */
export type GameMode = "edit" | "play";

export type GamePhase = "idle" | "loading" | "running" | "paused" | "destroyed";

/**
 * A game's verdict, at the play world's tick (from 0 at Play) that produced
 * it; or `flow`, when a scene change the game requested ended the editor's
 * Play, with the scene it asked for as `to`.
 */
export type PlayOutcome = GameOutcome & { tick: number; to?: AssetId };

/** One Play to Stop. The shell records the game's first verdict and keeps playing; stopping is the host's call. */
export type PlaySession = {
  /** The store's `tick` when Play started. */
  startTick: number;
  outcome: PlayOutcome | null;
};

/** What `GameInstance.play` did: validation errors (and a refused start) block it and are returned. */
export type PlayReport =
  | { ok: true; issues: SceneIssue[] }
  | {
      ok: false;
      issues: SceneIssue[];
      /** Why the play world didn't load; absent when validation blocked it. */
      error?: string;
      /** The load's own reason (`LoadReport`): `spawn-blocked` when `at` lies inside a solid. */
      reason?: LoadFailureReason;
    };

export type GameStoreState = {
  phase: GamePhase;
  /** The game's `storeSlice()`, refreshed each tick; null without a scene or a slice. */
  game: unknown;
  camera: CameraState;
  sim: SimState;
  tick: number;
  fps: number;
  /** `off`, or the id of the last debug layer shown; every layer before it shows too. */
  debugMode: string;
  mode: GameMode;
  /** Set at Play, cleared at Stop. */
  session: PlaySession | null;
};

// ─── Game Instance ───────────────────────────────────────

export type GameInstance = {
  start: () => void;
  destroy: () => void;
  resize: (width: number, height: number) => void;
  on: <K extends keyof GameEventMap>(event: K, handler: (payload: GameEventMap[K]) => void) => void;
  off: <K extends keyof GameEventMap>(
    event: K,
    handler: (payload: GameEventMap[K]) => void,
  ) => void;
  getStore: () => Store<GameStoreState>;
  /** The registry built from `config.game`; hosts parse and expand scenes with it. */
  registry: Registry;
  /**
   * Builds a fresh world for `scene`, expanding a document through `registry`
   * first; on failure the current scene keeps running.
   */
  loadScene: (scene: SceneDefinition | ExpandedScene) => LoadReport;
  /**
   * Loads the scene's bundle, joined by the project bundle until all of the
   * project's textures are in (a project texture that failed is fetched again
   * by the next `preload` or `loadScene`), and `GameConfig.rapier` when the
   * scene's physics is Rapier; resolves when both are in. Loading a Rapier
   * scene before its module is in reports `physics-not-loaded`.
   */
  preload: (
    scene: SceneDefinition | ExpandedScene,
    onProgress?: (p: LoadProgress) => void,
  ) => Promise<{ failed: BundleEntry[] }>;
  /**
   * Re-imported art: loads the `changed` assets' new bytes, then redraws the
   * loaded scene's visuals that use them, without reloading the scene. A new
   * `project` also re-resolves the project bundle from its game settings, so
   * a settings asset field moved to another id is loaded and kept resident.
   * A new `project` whose input map differs rebuilds the bindings and the
   * touch overlay from it, after letting go of everything the old map held;
   * the player's remaps stay, and seats and the pad deadzone keep what the
   * instance started with.
   * `failed` lists textures that did not load; `errors` the entities whose
   * redraw threw (every other entity still redraws). Never rejects for those.
   */
  reloadAssets: (update: {
    project: ProjectRuntimeView | null;
    view: ProjectView;
    changed: readonly AssetId[];
  }) => Promise<{ failed: BundleEntry[]; errors: AssetReloadError[] }>;
  unloadScene: () => void;
  /**
   * The loaded scene's runtime, for entity-level edits (`add`, `update`,
   * `remove`) that shouldn't rebuild the world; null with nothing loaded.
   * A `loadScene` replaces it.
   */
  runtime: () => SceneRuntime | null;
  /**
   * Validates `doc` (errors block and are returned) and builds a fresh play
   * world from a clone of it, frozen in dev: input is flushed, the camera
   * snaps to the game's target and the mode becomes `play`. From edit it
   * remembers the edit world and the editor camera for `stop`; while
   * playing it restarts on `doc` and keeps what it remembered. A failed
   * Play leaves the current world running.
   */
  play: (doc: SceneDefinition, opts?: PlayOptions) => PlayReport;
  /**
   * Plays `recording` on `doc`: Play from the recording's start, with its
   * input edges stepped on their ticks in place of the keyboard's. At its
   * last tick the loop pauses on the end state; Stop returns to edit.
   *
   * A recording that started on a live version (`sceneVersion`) plays that
   * version's scene in place of `doc`, and each recorded swap is applied
   * before its tick with its recorded strategy, through the same path as a
   * live swap. A version `versions` can't give is `scene-version-removed`:
   * for the start, the replay doesn't start (the report carries the issue);
   * for a swap, `live:failed` carries it with `detail.tick` and the replay
   * stops on that tick. The scene's own live version comes back at Stop.
   */
  replay: (
    doc: SceneDefinition,
    recording: RunRecording,
    opts?: {
      /** The scene versions the recording names, by id; null for one the host doesn't have. */
      versions?: (id: Sha256) => StagedVersion | null;
    },
  ) => PlayReport;
  /**
   * The prefabs that documents passed to `loadScene`, `play` and `replay`
   * expand their instances from, e.g. the collab doc's as they change.
   */
  setPrefabs: (prefabs: PrefabLibrary) => void;
  /**
   * The session's recording once finished (the game's first verdict, or
   * Stop), else the last session's; null before any Play. A session started
   * through `setMode` isn't recorded. With `running`, a session still
   * recording comes back as Stop would end it now, and keeps recording.
   */
  recording: (opts?: { running?: boolean }) => RunRecording | null;
  /**
   * Discards the play world, rebuilds the edit world from the scene loaded
   * before Play (the play world's own scene when there was none), restores
   * the editor camera exactly and resumes the loop at 1x. No-op in edit.
   */
  stop: () => void;
  /** Rendering, overlays and the camera keep running; no ticks until `resume` or `step`. */
  pause: () => void;
  resume: () => void;
  /** Simulates `n` ticks now (default 1), delivering keys pressed while paused. Play mode only. */
  step: (n?: number) => void;
  /** Scales simulated time per frame; throws on a negative or non-finite scale. */
  setTimeScale: (scale: number) => void;
  /** Runs a game command (its `editorKeys`, or a host button); false when the game didn't apply it. */
  command: (name: string) => boolean;
  /**
   * Queues a command for the next simulated tick as the sending seat's
   * (`player`, default 0), recorded on that seat's stream, waking a turns or
   * event game; false (and a dev warning) when not playing, while a replay
   * plays its recorded commands, for a seat past `players.max`
   * (player-unknown), for an unknown name, or when its args don't parse.
   */
  send: (command: GameCommand) => boolean;
  /** Wall time away, e.g. a restored save's last-seen gap; becomes `@elapsed` when the game has `time.catchUp`. */
  elapse: (ms: number) => void;
  /** Offers Escape to the game in play (a tool's selection); true when it used it, so play goes on. */
  cancel: () => boolean;
  /** The last pointer position over the input target in world metres, for "play from here"; null before any. */
  pointerWorld: () => Vec2 | null;
  /**
   * Kept for hosts without a document: `play` plays the loaded scene as it
   * stands (no validation) and `edit` is `stop`.
   */
  setMode: (mode: GameMode) => void;
  getMode: () => GameMode;
  /**
   * Routes the input target's pointer events and the key target's key events;
   * editor tools register at `TOOL_PRIORITY.editor`.
   */
  router: ToolRouter;
  /** Router screen px (from the input target's corner) to world metres, through the camera. */
  screenToWorld: (screen: Vec2) => Vec2;
  /** Page coordinates (a DOM event's `clientX`, `clientY`) to world metres, through the input target's rect and the camera. */
  clientToWorld: (clientX: number, clientY: number) => Vec2;
  /** Page coordinates of a world point through the camera and the canvas's rect; clientToWorld's inverse. */
  worldToClient: (p: Vec2) => { x: number; y: number };
  /** The project's runtime view: the one `createGame` was given, or the last `reloadAssets` passed; null without one. */
  project: () => ProjectRuntimeView | null;
  /** Bindings, remapping, seats and pointer tracking. */
  input: GameInput;
  /**
   * The editor camera, for edit mode (play's camera follows the game). Each
   * call moves the view now, within the camera's bounds and zoom limits, and
   * updates the store's `camera` so DOM overlays follow.
   *
   * `panBy` moves the view with a screen-px drag: what was under the pointer stays under it.
   */
  panBy: (screenDelta: Vec2) => void;
  /** Zooms by `factor` about a screen point, keeping the world point under it fixed. */
  zoomAt: (screen: Vec2, factor: number) => void;
  /** Centres `rect` (world metres) and zooms so it fits with `marginPx` screen px around it (default 48). */
  frame: (rect: Aabb, marginPx?: number) => void;
  /**
   * Reads back the canvas pixel (RGBA bytes) under each point (world metres), through
   * the camera, from the stage at resolution 1 over the game's background
   * colour; a point off the canvas reads null. `renderer` is the renderer
   * that drew them, `webgl` or `webgpu`.
   */
  extractPixels: (world: readonly Vec2[]) => {
    renderer: string;
    pixels: (readonly [number, number, number, number] | null)[];
  };
  /** The scene list, the current scene and changes between scenes. */
  flow: GameFlow;
  /** Save slots over the game's, the host's or the browser's store. */
  saves: SaveSlots;
  /** New versions of listed scenes, staged and swapped into the running game. */
  live: GameLive;
};

/** A scene version the host fetched, ready to stage. */
export type StagedVersion = {
  id: Sha256;
  version: SceneVersion;
  /** Canonical texts by hash (the scene and its prefabs), already hash-checked. */
  texts: ReadonlyMap<Sha256, string>;
};

/** `GameInstance.live`. */
export type GameLive = {
  /**
   * Fetches nothing: makes a version resident (validated, expanded, bundle
   * preloaded) for a listed scene. Its preload gets `LIVE_DEFAULTS.preloadTimeoutMs`,
   * or less when `signal` aborts first; a refusal leaves the scene's versions as they were.
   */
  stage(
    v: StagedVersion,
    opts?: { signal?: AbortSignal },
  ): Promise<{ ok: true } | { ok: false; issue: SceneIssue }>;
  /**
   * Uses a staged version (null: the release's own) for a scene, with a timing
   * clamped to what the game accepts. The issue is live-timing-unsupported (a
   * warning) when the timing was clamped, or live-swap-failed when the version
   * isn't staged.
   */
  activate(
    scene: AssetId,
    version: Sha256 | null,
    timing: SwapTiming,
  ): { timing: SwapTiming; clamped: boolean; issue?: SceneIssue };
  /** The version this scene's loads use; null for the release's own. */
  current(scene: AssetId): Sha256 | null;
  /** Activations waiting for their timing, in scene-id order. */
  pending(): readonly { scene: AssetId; version: Sha256 | null; timing: SwapTiming }[];
  /** For online sessions: ignore activations until unpinned. */
  pin(versions: Readonly<Record<AssetId, Sha256>>): void;
  unpin(): void;
};
