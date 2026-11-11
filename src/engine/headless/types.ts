import type { GameCommand, GameDefinition, GameOutcome, Registry } from "../game/types";
import type { ProjectRuntimeView } from "../project/runtime-view";
import type { LoadReport, RuntimeStats, StepEvent } from "../runtime/types";
import type { ExpandedScene } from "../scene/types";
import type { RapierModule } from "../types";
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
  /** The game's first verdict (`play.outcome`) and its tick; the probe still runs every tick. */
  outcome?: GameOutcome & { tick: number };
  /** Set when an `EngineError` out of a step ended the run: stage `run`, the error's code on its issue; `ticks`, `events` and `final` cover the ticks before it. */
  blocked?: PlaytestBlocked;
  stats: RuntimeStats;
};
