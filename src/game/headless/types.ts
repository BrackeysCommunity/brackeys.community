import type { LoadReport, RuntimeStats, StepEvent, StepResult } from "../runtime/types";
import type { ExpandedScene } from "../scene/types";
import type { RapierModule, Vec2 } from "../types";

export type HeadlessRuntimeOptions = {
  rapier: RapierModule;
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

export type ProbeOptions = ProbeInput & { rapier: RapierModule; scene: ExpandedScene };

export type ProbeReport = {
  /** Changes with movement tuning, the tick rate and the engine version. */
  configHash: string;
  tickRate: 60;
  /** Ticks actually simulated: 0 when the scene failed to load. */
  ticks: number;
  load: LoadReport;
  events: StepEvent[];
  truncated: boolean;
  landings: { tick: number; on: string; at: Vec2 }[];
  final: StepResult["player"];
  stats: RuntimeStats;
};
