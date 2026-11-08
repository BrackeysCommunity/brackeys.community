import type { Store } from "@tanstack/store";

import type { DebugLayerFactory, DebugOverlayFactory } from "./debug";
import type { GameDefinition, GameOutcome, Registry } from "./game/types";
import type { PlayOptions } from "./headless/playtest-types";
import type { BundleEntry } from "./project/bundle";
import type { KindRegistry } from "./project/kinds";
import type { ProjectRuntimeView } from "./project/runtime-view";
import type { AssetId, ProjectView } from "./project/types";
import type { AssetLoader, LoadProgress } from "./render/asset-loader";
import type { ResolutionPolicy } from "./resolution";
import type { AssetReloadError, LoadReport, SceneRuntime, StepResult } from "./runtime/types";
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
  /** What the shell plays: its entity types, actions, hooks and play-mode tools. */
  game: GameDefinition;
  /** A registry the host already built from `game`, so host and shell share one; built here when omitted. */
  registry?: Registry;
  displayWidth: number;
  displayHeight: number;
  backgroundColor: number;
  targetFPS: number;
  maxDeltaTime: number;
  camera: CameraConfig;
  /** Overrides the game's default bindings. */
  bindings?: readonly InputBinding[];
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
   * Loads the Rapier module: `() => import("@dimforge/rapier2d")` in a browser,
   * or `@dimforge/rapier2d-compat` (cast) after its `init()` in Bun or Node.
   */
  rapier: () => Promise<RapierModule>;
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
      min: { x: -2000, y: -2000 },
      max: { x: 4000, y: 2000 },
    },
  },
};

// ─── Camera ──────────────────────────────────────────────

export type CameraConfig = {
  lerpSpeed: number;
  /** Used until a scene loads; each load replaces them with the scene's bounds plus a margin. */
  bounds: { min: Vec2; max: Vec2 };
};

/** `follow` eases toward the game's camera target; `free` holds wherever it was put. */
export type CameraMode = "follow" | "free";

export type CameraState = {
  position: Vec2;
  zoom: number;
  /** World units to canvas pixels: the display scale times `zoom`. */
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
  keys: string[];
};

export type InputAction = {
  action: string;
  pressed: boolean;
  tick: number;
  timestamp: number;
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
};

// ─── Store ───────────────────────────────────────────────

/** `edit` pauses the simulation; `play` runs it. */
export type GameMode = "edit" | "play";

export type GamePhase = "idle" | "loading" | "running" | "paused" | "destroyed";

/** A game's verdict, at the play world's tick (from 0 at Play) that produced it. */
export type PlayOutcome = GameOutcome & { tick: number };

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
      /** `spawn-blocked`: `at` lies inside a solid. */
      reason?: "spawn-blocked";
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
   * by the next `preload` or `loadScene`); resolves when its textures are in.
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
   */
  replay: (doc: SceneDefinition, recording: RunRecording) => PlayReport;
  /**
   * The prefabs that documents passed to `loadScene`, `play` and `replay`
   * expand their instances from, e.g. the collab doc's as they change.
   */
  setPrefabs: (prefabs: PrefabLibrary) => void;
  /**
   * The session's recording once finished (the game's first verdict, or
   * Stop), else the last session's; null before any Play. A session started
   * through `setMode` isn't recorded.
   */
  recording: () => RunRecording | null;
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
  /** Offers Escape to the game in play (a tool's selection); true when it used it, so play goes on. */
  cancel: () => boolean;
  /** The last pointer position over the input target in world units, for "play from here"; null before any. */
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
  /** Router screen px (from the input target's corner) to world px, through the camera. */
  screenToWorld: (screen: Vec2) => Vec2;
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
  /** Centres `rect` (world px) and zooms so it fits with `marginPx` screen px around it (default 48). */
  frame: (rect: Aabb, marginPx?: number) => void;
};
