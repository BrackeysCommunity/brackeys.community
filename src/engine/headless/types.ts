import type { GameDefinition, GameOutcome, Registry } from "../game/types";
import type { LoadReport, RuntimeStats, StepEvent } from "../runtime/types";
import type { ExpandedScene } from "../scene/types";
import type { RapierModule } from "../types";

export type HeadlessRuntimeOptions = {
  rapier: RapierModule;
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
  /** Cap on `events`; defaults to 1000. */
  maxEvents?: number;
};

export type ProbeOptions<S = unknown> = ProbeInput & {
  rapier: RapierModule;
  game?: GameDefinition<S> | null;
  registry?: Registry;
  scene: ExpandedScene;
};

export type ProbeReport<S = unknown> = {
  /** Changes with the engine version, the tick rate, the game and its tuning. */
  configHash: string;
  tickRate: 60;
  /** Ticks actually simulated: 0 when the scene failed to load. */
  ticks: number;
  load: LoadReport;
  events: StepEvent[];
  truncated: boolean;
  /** The game's snapshot after the last tick; `null` without a game. */
  final: S | null;
  /** The game's first verdict (`play.outcome`) and its tick; the probe still runs every tick. */
  outcome?: GameOutcome & { tick: number };
  stats: RuntimeStats;
};
