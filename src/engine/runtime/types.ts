import type { SceneView } from "../context";
import type { BehaviorName } from "../game/behaviors";
import type {
  EngineContext,
  GameCommand,
  GameDefinition,
  GameRuntime,
  Registry,
} from "../game/types";
import type { PlayOptions } from "../headless/playtest-types";
import type { ProjectRuntimeView } from "../project/runtime-view";
import type { AssetId } from "../project/types";
import type { EntityTypeName, ExpandedScene, RuntimeEntity } from "../scene/types";
import type { InputAction, RapierModule, Vec2 } from "../types";

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
 * `other` what entered or left it, `at` the other's position); a game raises
 * its own types through `EngineContext.emit`.
 */
export type StepEvent = {
  tick: number;
  type: string;
  entityId?: string;
  other?: string;
  at: Vec2;
};

/** Engine event types. */
export const SENSOR_ENTER = "sensor:enter";
export const SENSOR_EXIT = "sensor:exit";

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
  /** One tick; `commands` reach the game's `beforeStep`. */
  step: (dtMs: number, actions: InputAction[], commands?: readonly GameCommand[]) => StepResult;
  /** The game's `busy()`: false without a game or the hook. */
  busy: () => boolean;
  /** The game's snapshot now; `null` without a game. */
  snapshot: () => unknown;
  stats: () => RuntimeStats;
  destroy: () => void;
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
