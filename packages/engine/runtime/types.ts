import type { SceneView } from "../context";
import type { BehaviorName } from "../game/behaviors";
import type { FlowRequest, SceneLibrary } from "../game/flow";
import type { SceneDiff, SceneSwap, SwapStrategy } from "../game/live";
import type {
  EngineContext,
  GameCommand,
  GameDefinition,
  GameRuntime,
  JsonValue,
  Registry,
  SaveRequest,
} from "../game/types";
import type { PlayOptions } from "../headless/playtest-types";
import type { TickInput } from "../input/stream";
import type { ProjectRuntimeView } from "../project/runtime-view";
import type { AssetId, Sha256 } from "../project/types";
import type {
  EntityTypeName,
  ExpandedScene,
  PrefabLibrary,
  RuntimeEntity,
  SceneIssue,
} from "../scene/types";
import type { InputAction, RapierModule, Vec2 } from "../types";
import type { RunTiming, TimingReport } from "./timing";

export type ReconcileReport = { ok: true } | { ok: false; error: string; entityId?: string };

/**
 * An entity whose behavior blocks threw while redrawing for changed assets.
 * The blocks naming a changed asset were detached and attached afresh; its
 * other blocks keep their state. When that threw too (`reattached` false)
 * those blocks stay detached until an edit or a scene load replaces the
 * entity.
 */
export type AssetReloadError = { entityId: string; error: string; reattached: boolean };

/**
 * Why a load failed, when it wasn't a plain error. `spawn-blocked`: a play
 * start `at` lies inside a solid. `physics-required`: an entity needs physics
 * the scene runs without. `physics-not-loaded`: the scene needs Rapier and
 * the host gave none.
 */
export type LoadFailureReason = "spawn-blocked" | "physics-required" | "physics-not-loaded";

export type LoadReport =
  | { ok: true; counts: Record<EntityTypeName, number>; ms: number }
  | { ok: false; error: string; entityId?: string; reason?: LoadFailureReason };

/**
 * Something that happened during one tick, naming entities by id. The
 * engine raises `sensor:enter` and `sensor:exit` (`entityId` is the sensor,
 * `other` what entered or left it, `at` the other's position), the
 * `entity:*` lifecycle events (`data: { type }`) and `contact:start` and
 * `contact:end`, and `player:joined` and `player:left` (`player` the seat,
 * `data: { device }`, `at` the origin, since a seat has no position); a
 * game raises its own types through `EngineContext.emit`.
 */
export type StepEvent = {
  tick: number;
  type: string;
  entityId?: string;
  other?: string;
  at: Vec2;
  /** The seat the event is about. */
  player?: number;
  /** Plain JSON a game or a timer attaches. */
  data?: unknown;
};

/** Engine event types. */
export const SENSOR_ENTER = "sensor:enter";
export const SENSOR_EXIT = "sensor:exit";
/** A spawner made a spawn: `entityId` the spawner, `other` and `data.id` the new id, `at` where it appeared. */
export const SPAWNER_SPAWNED = "spawner:spawned";
/** A character landed: `entityId` the character, `other` what it landed on. */
export const CHARACTER_LANDED = "character:landed";
/** A character left the ground, by a jump, a launch or a ledge. */
export const CHARACTER_LEFT_GROUND = "character:left-ground";
/** A character's jump started, on the ground or in coyote time. */
export const CHARACTER_JUMPED = "character:jumped";
/** A nav agent reached its destination: `entityId` the agent, `other` the entity it followed. */
export const NAV_ARRIVED = "nav:arrived";
/** A nav agent gave up: `data.reason` is `no-path`, `stuck` or `gone`. */
export const NAV_BLOCKED = "nav:blocked";
/** An entity spawned inside a step, at its spawn pose. */
export const ENTITY_SPAWNED = "entity:spawned";
/** An entity destroyed at the end of a tick, at its last pose. */
export const ENTITY_DESTROYED = "entity:destroyed";
export const ENTITY_ENABLED = "entity:enabled";
export const ENTITY_DISABLED = "entity:disabled";
/** A watched pair started touching: `entityId` the watched side, `other` the other, `at` the contact point. */
export const CONTACT_START = "contact:start";
export const CONTACT_END = "contact:end";
/** A device took a seat. */
export const PLAYER_JOINED = "player:joined";
/** A seat's device left it (a pad disconnected, or the host freed it). */
export const PLAYER_LEFT = "player:left";

export type StepResult = {
  /** The tick just simulated, counting from 0 after each load. */
  tick: number;
  /** Engine events first (sensors), then the game's, each in the order raised. */
  events: StepEvent[];
  /** The game's `snapshot()` after the step; `null` without a game. */
  game: unknown;
};

export type RuntimeStats = {
  /** Which world holds the colliders `bodies` and `colliders` count. */
  backend: "rapier" | "geometry";
  bodies: number;
  colliders: number;
  tags: number;
  entities: number;
  perType: Record<EntityTypeName, number>;
  /** Each built behavior system's live attachments; zeros left out. */
  behaviors: Record<BehaviorName, number>;
  /**
   * Where the steps' wall time went, by part: only for a runtime made with
   * `SceneRuntimeOptions.timing`, while that collector is enabled. The one
   * field of the stats that differs between two runs of the same input.
   */
  timing?: TimingReport;
};

export type SceneRuntime = {
  /**
   * Replaces the current scene; a scene with duplicate ids or unknown types is
   * rejected before anything changes. With `play` it builds a play world:
   * `EngineContext.play` is set before the game's `onLoad`, and an `at` inside
   * a solid fails the load (`reason: "spawn-blocked"`).
   */
  load: (scene: ExpandedScene, play?: PlayOptions) => LoadReport;
  unload: () => void;
  /**
   * Spawns entities into the loaded scene. A duplicate id or an unknown type
   * rejects the whole call before anything changes, and a spawn that throws
   * rolls the call back. The game's `onLoad` doesn't run again.
   */
  add: (entities: RuntimeEntity[]) => ReconcileReport;
  /**
   * Replaces entities by id: the system's `update(e, prev)` fast path when it
   * has one, otherwise despawn then spawn. An id that isn't loaded is skipped
   * (a no-op), as is an entity equal to what's loaded. A type change despawns
   * from the old system and spawns in the new. Rejected and rolled back as `add` is.
   */
  update: (entities: RuntimeEntity[]) => ReconcileReport;
  /** Despawns by id; unknown ids are no-ops. */
  remove: (ids: string[]) => void;
  get: (id: string) => RuntimeEntity | undefined;
  /**
   * One tick of `input`: `ctx.input` is updated from it before the systems'
   * `beforeStep`, and its actions and commands reach the game's
   * `beforeStep`. The array form (with `commands` beside it) is 0.x's.
   */
  step: (
    dtMs: number,
    input: TickInput | InputAction[],
    commands?: readonly GameCommand[],
  ) => StepResult;
  /** The game's `busy()`: false without a game or the hook. */
  busy: () => boolean;
  /** The game's snapshot now; `null` without a game. */
  snapshot: () => unknown;
  stats: () => RuntimeStats;
  /**
   * The flow request and the save requests game code made since the last
   * call, emptied: the host applies them after the tick that made them.
   */
  takeRequests: () => RuntimeRequests;
  /**
   * Applies a new version of the loaded scene between ticks: reconcile when
   * the header is unchanged, else reload with capture and restore. Never
   * runs `onSwap`; the instance's live layer does.
   */
  swap: (
    next: ExpandedScene,
    opts: { prefabs: PrefabLibrary; strategy?: "auto" | "reload" },
  ) => SwapReport;
  destroy: () => void;
};

/** What `SceneRuntime.swap` did; `undo()` puts the old version back. */
export type SwapReport =
  | {
      ok: true;
      strategy: SwapStrategy;
      carried: SceneSwap["carried"];
      diff: SceneDiff;
      undo(): void;
    }
  | { ok: false; issue: SceneIssue };

/** What `SceneRuntime.takeRequests` hands the host. */
export type RuntimeRequests = { flow: FlowRequest | null; saves: SaveRequest[] };

/**
 * The value `EngineContext.persist` reads and writes. One cell outlives
 * every runtime of a game instance or headless session, so the value
 * survives scene loads.
 */
export type PersistCell = {
  readonly value: JsonValue;
  set(next: JsonValue): void;
  /** Back to the game's initial value. */
  reset(): void;
};

export type SceneRuntimeOptions = {
  /** Without one the runtime has no Rapier world: `ctx.rapier` and `ctx.physics` are null. */
  rapier: RapierModule | null | undefined;
  view: SceneView | null;
  /** Without a game the runtime loads primitives only, has no hooks, and snapshots `null`. */
  game?: GameDefinition | null;
  /** Built from `game` when omitted; pass one to share it across runtimes. */
  registry?: Registry;
  dev?: boolean;
  /** Clock for `LoadReport.ms`. Defaults to a constant 0 so reports stay deterministic. */
  now?: () => number;
  /** Texture sampling for sprites whose texture sets no import `filter`; default "linear". */
  sampling?: "linear" | "nearest";
  /** The prefabs `ctx.instantiate` resolves, read once per load and frozen for the run. */
  prefabs?: PrefabLibrary | (() => PrefabLibrary);
  /** The listed scenes flow loads and attaches, read once per load and frozen for the run. */
  scenes?: SceneLibrary | (() => SceneLibrary);
  /** The persistent value; without one the runtime keeps its own, from the game's `persist.initial()`. */
  persist?: PersistCell;
  /**
   * Times each step's parts into the collector's `tick` scope, on the
   * collector's clock, and reports them as `RuntimeStats.timing`. Without
   * one the runtime reads no clock in a step.
   */
  timing?: RunTiming;
  /**
   * What `EngineContext.live` reads: the instance's live layer. Without one
   * the version is null and `boundary()` does nothing.
   */
  live?: { version(): Sha256 | null; boundary(label?: string): void };
};

/** The runtime plus the parts the shell and a game's tools drive directly. */
export type SceneRuntimeHandle = SceneRuntime & {
  readonly ctx: EngineContext;
  /** The game's per-runtime hooks, or `null` without a game. */
  readonly game: GameRuntime | null;
  /** The loaded scene with every `add`, `update` and `remove` since applied, or null. */
  scene: () => ExpandedScene | null;
  /** Each rendered frame, after the view's `frame`: the visual behaviors' render hooks. */
  render: (alpha: number) => void;
  /**
   * Swaps in the project's new view and redraws what uses the `changed`
   * assets; returns the entities whose redraw threw, the rest redrawn.
   */
  reloadAssets: (
    project: ProjectRuntimeView | null,
    changed: readonly AssetId[],
  ) => AssetReloadError[];
};
