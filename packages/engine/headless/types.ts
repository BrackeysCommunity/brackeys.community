import type { SceneLibrary } from "../game/flow";
import type { SaveDepth, SaveFile } from "../game/save-file";
import type {
  EngineContext,
  GameCommand,
  GameDefinition,
  GameOutcome,
  Registry,
} from "../game/types";
import type { ProjectRuntimeView } from "../project/runtime-view";
import type { RunTiming } from "../runtime/timing";
import type { LoadReport, RuntimeStats, SceneRuntimeHandle, StepEvent } from "../runtime/types";
import type { ExpandedScene, SceneIssue } from "../scene/types";
import type { GameLive, RapierModule, StagedVersion } from "../types";
import type { PlaytestBlocked } from "./playtest-types";

export type HeadlessRuntimeOptions = {
  /** Needed for a scene that runs on Rapier; a scene without physics loads with none. */
  rapier?: RapierModule | null;
  /** Without one the runtime loads primitives only. */
  game?: GameDefinition | null;
  /** Built from `game` when omitted. */
  registry?: Registry;
  scene?: ExpandedScene;
  dev?: boolean;
  /** The listed scenes: with it a flow request loads the next scene after the tick; without it the run ends there. */
  flow?: SceneLibrary;
  /** Start from this save instead of the scene's fresh load. */
  fromSave?: SaveFile;
  /** Times each step's parts into this collector; `stats().timing` reports them. */
  timing?: RunTiming;
  /** Keep presentation requests in each `StepResult.present`; default false, when they are dropped. */
  recordPresentation?: boolean;
};

/**
 * `GameInstance.live` for a headless runtime: the same members, with no
 * preloading, so staging answers at once. An activated `now` or `boundary`
 * swap applies after the step it waits for, between ticks.
 */
export type HeadlessLive = Omit<GameLive, "stage"> & {
  /** Reads and validates a version for a listed scene and keeps it resident; nothing is fetched or preloaded. */
  stage(v: StagedVersion): { ok: true } | { ok: false; issue: SceneIssue };
};

/** A headless runtime; `save` captures the world as `captureSave` does, and `live` swaps scene versions in. */
export type HeadlessRuntime = SceneRuntimeHandle & {
  save?(opts: {
    depth: SaveDepth;
    slot: string;
    title?: string;
    /** The caller's clock for `meta.savedAt`. */
    now: number;
  }): { ok: true; file: SaveFile } | { ok: false; issue: SceneIssue };
  live?: HeadlessLive;
};

export type ProbeInput = {
  ticks: number;
  /** Actions pressed at tick 0 and never released. */
  hold?: string[];
  /** Edges applied at the start of their tick, in list order. */
  inputs?: [tick: number, action: string, pressed: 0 | 1][];
  /** Game commands stepped on their tick, in list order; checked by the caller (`compileInputScript`). */
  commands?: readonly (readonly [tick: number, command: GameCommand])[];
  /** Cap on `events`; defaults to 1000. */
  maxEvents?: number;
};

export type ProbeOptions<S = unknown> = ProbeInput & {
  /** Needed for a scene that runs on Rapier; a scene without physics loads with none. */
  rapier?: RapierModule | null;
  game?: GameDefinition<S> | null;
  registry?: Registry;
  scene: ExpandedScene;
  /** The project the scene runs in: its `engine.tickRate` sets the clock before the game's. */
  project?: ProjectRuntimeView | null;
  /**
   * Times each step's parts into this collector, reported as
   * `stats.timing`: wall time, so the one part of the report two runs of
   * the same input don't share. Without it the report holds no timing.
   */
  timing?: RunTiming;
  /**
   * Called after each tick's step that didn't throw, with the tick and the
   * runtime's context, to read state the report doesn't carry (an entity's
   * clip, say) inside the probe's own run. It must not change the run.
   */
  onTick?: (tick: number, ctx: EngineContext) => void;
};

export type ProbeReport<S = unknown> = {
  /** Changes with the engine version, the tick rate, the game and its tuning. */
  configHash: string;
  /** The runtime's ticks per second. */
  tickRate: number;
  /** Ticks actually simulated: 0 when the scene failed to load. */
  ticks: number;
  load: LoadReport;
  events: StepEvent[];
  truncated: boolean;
  /** The game's snapshot after the last tick; `null` without a game. */
  final: S | null;
  /** The commands legal after the last tick (`GamePlayDef.commands`), at most 64; absent when the game declares none. */
  legal?: GameCommand[];
  /** True when `legal` was cut at 64 entries. */
  legalTruncated?: boolean;
  /** The game's first verdict (`play.outcome`) and its tick; the probe still runs every tick. */
  outcome?: GameOutcome & { tick: number };
  /** Set when an `EngineError` out of a step ended the run: stage `run`, the error's code on its issue; `ticks`, `events` and `final` cover the ticks before it. */
  blocked?: PlaytestBlocked;
  stats: RuntimeStats;
};
