import type { GameDefinition, Registry, RunResult } from "../game/types";
import type { LoadReport, StepEvent } from "../runtime/types";
import type { RunRecording } from "../scene/recording-schema";
import type {
  EntityTypeName,
  PrefabLibrary,
  Pt,
  Ref,
  SceneDefinition,
  SceneHash,
  SceneIssue,
} from "../scene/types";
import type { RapierModule, Vec2 } from "../types";

// ─── Play options ────────────────────────────────────────

/** How a play world starts: the same object for the editor's Play, `runPlaytest` and `fuzz`. */
export type PlayOptions<G = unknown> = {
  /** Start here instead of the game's spawn, cast onto the first surface below; refused inside a solid. */
  at?: Vec2;
  /** Advances time-driven systems (followers) by this much before tick 0. */
  timeOffsetMs?: number;
  /** The game's own options (the platformer's abilities), parsed by its `play.options`. */
  game?: G;
};

/** One input edge: at the start of `tick`, `action` goes down (1) or up (0). */
export type InputEdge = [tick: number, action: string, pressed: 0 | 1];

// ─── Input scripts ───────────────────────────────────────

/** The engine's `event` predicate: an event type, or a type with the entity ids it must name. */
export type EventMatch = string | { type: string; entityId?: string; other?: string };

/**
 * When a step ends early: every key must hold (AND). `event` and `tick` (an
 * absolute tick, reached or passed) are the engine's; the rest are the game's
 * `play.predicates`.
 */
export type UntilClause = {
  event?: EventMatch;
  tick?: number;
  [predicate: string]: unknown;
};

/** How long a step runs: `for` ticks, `forMs` milliseconds (rounded to ticks), or `until`, capped by `max` ticks. */
export type StepDuration = {
  for?: number;
  forMs?: number;
  until?: UntilClause;
  /** With `until`: give up after this many ticks and move on (default 600). */
  max?: number;
};

/**
 * One script step. Each step names everything held during it; what the
 * step before held and this one doesn't is released at the boundary.
 */
export type InputScriptStep =
  | ({ hold: string[] } & StepDuration)
  /** Down for one tick, then up. */
  | { press: string | string[] }
  /** Nothing held for this many ticks. */
  | { wait: number };

export type InputScript<G = unknown> = {
  $schema?: string;
  v: 1;
  /** The scene this was written for; the CLI checks it against the scene it runs. */
  scene?: string;
  /** Play from here; omitted plays from the game's spawn. */
  at?: Pt;
  timeOffsetMs?: number;
  game?: G;
  /** The run ends as `timeout` after this many ticks (default 1800, 30 s). */
  maxTicks?: number;
  steps: InputScriptStep[];
};

/** A step with its duration in ticks and its held set resolved. */
export type CompiledStep = {
  /** Index into the script's `steps`. */
  index: number;
  hold: string[];
  /** Fixed length in ticks; absent when the step waits on `until`. */
  ticks?: number;
  until?: UntilClause;
  /** With `until`: the most ticks the step may run. */
  max?: number;
};

export type CompiledInputScript = {
  /** The script's `scene`: a playtest of any other scene is refused. */
  scene?: string;
  steps: CompiledStep[];
  maxTicks: number;
  play: PlayOptions;
  /**
   * Every edge before `maxTicks`, when no step waits on `until`; otherwise
   * edges are only known by running. Nothing is released after the last step.
   */
  edges: InputEdge[] | null;
};

/** Why a script didn't compile: a JSON Pointer into it and one sentence, with a guess when there is one. */
export type ScriptIssue = {
  path: string;
  message: string;
  expected?: string;
  got?: string;
  hint?: string;
};

export type CompileResult =
  | { ok: true; script: CompiledInputScript }
  | { ok: false; issues: ScriptIssue[] };

// ─── Playtests ───────────────────────────────────────────

export type PlaytestOptions<S = unknown, G = unknown> = {
  rapier: RapierModule;
  game?: GameDefinition<S, G> | null;
  /** Built from `game` when omitted. */
  registry?: Registry;
  /** Validated (errors block), hashed and expanded the way Play does. */
  scene: SceneDefinition;
  /** The prefabs the scene's instances name. */
  prefabs?: PrefabLibrary;
  script: InputScript<G> | CompiledInputScript;
  /** Cap on `events`; default 1000. */
  maxEvents?: number;
  /** Cap on `trail.pts`; default 2000. */
  maxTrail?: number;
  /** Freeze the played definition, as the editor's Play does in dev. */
  dev?: boolean;
};

/** How one script step went. */
export type PlaytestStep = {
  /** Index into the script's `steps`. */
  index: number;
  /** The tick it started on. */
  start: number;
  /** Ticks it ran. */
  ticks: number;
  /** `done`: its fixed length ran out; `until`: its condition held; `max`: it gave up; `run`: the run ended during it. */
  end: "done" | "until" | "max" | "run";
};

export type PlaytestOutcomeReport = {
  result: RunResult;
  /** The last tick simulated (`ticks - 1`). */
  tick: number;
  /** The game's focus then, or null without one. */
  at: Vec2 | null;
  cause?: string;
  entityId?: string;
};

export type PlaytestReport<S = unknown> = {
  blocked: false;
  scene: string;
  sceneHash: SceneHash;
  /** `probeConfigHash` of the game. */
  configHash: string;
  tickRate: 60;
  outcome: PlaytestOutcomeReport;
  /** Ticks simulated. */
  ticks: number;
  events: StepEvent[];
  truncated: boolean;
  /**
   * The game's focus after ticks 0, 4, 8, …, oldest first; a sample whose
   * focus was null is left out. Empty without a `focus` hook.
   */
  trail: { every: 4; pts: Pt[]; truncated: boolean };
  /** How many script steps started (the last one may not have finished). */
  stepsReached: number;
  /** Each started step: when it started, how long it ran and why it ended. */
  steps: PlaytestStep[];
  /** The game's snapshot after the last tick; `null` without a game. */
  final: S | null;
  /** The edges actually played, `until` steps resolved. */
  inputs: InputEdge[];
  /** Warnings and info the scene had; errors block instead. */
  issues: SceneIssue[];
  /** The run as a recording: `replayRecording` plays it again tick for tick. */
  recording: RunRecording;
};

/** A playtest that never ran: the script didn't compile, the scene has errors, or it didn't load. */
export type PlaytestBlocked = {
  blocked: true;
  stage: "script" | "scene" | "load";
  scene: string;
  issues: SceneIssue[];
  scriptIssues: ScriptIssue[];
  /** The load failure, for `stage: "load"`. */
  load?: LoadReport;
};

export type PlaytestRun<S = unknown> = PlaytestReport<S> | PlaytestBlocked;

// ─── Fuzz ────────────────────────────────────────────────

export type FuzzOptions<S = unknown, G = unknown> = {
  rapier: RapierModule;
  game?: GameDefinition<S, G> | null;
  registry?: Registry;
  scene: SceneDefinition;
  /** The prefabs the scene's instances name. */
  prefabs?: PrefabLibrary;
  /** Seeds the generator; the same seed gives the same report (timing aside). */
  seed: number | string;
  /** Default 100. */
  rollouts?: number;
  /** Ticks per rollout; default 600. */
  ticks?: number;
  play?: PlayOptions<G>;
  dev?: boolean;
};

/** An entity some rollout touched: named by an event's `entityId` or `other`. */
export type FuzzTouch = {
  ref: Ref;
  type: EntityTypeName;
  /** Rollouts that touched it. */
  reached: number;
  /** The earliest tick any rollout touched it, and that rollout's index. */
  firstTick: number;
  firstRollout: number;
};

export type FuzzReport = {
  blocked: false;
  scene: string;
  sceneHash: SceneHash;
  configHash: string;
  seed: number | string;
  rollouts: number;
  ticksPerRollout: number;
  /** Ticks simulated over every rollout; a rollout ends early on an outcome or `stuck`. */
  ticks: number;
  /** Sorted by `ref`. */
  touched: FuzzTouch[];
  /** Loadable entities no rollout touched, sorted. */
  untouched: Ref[];
  /** How many rollouts ended with each result. */
  results: Record<RunResult, number>;
  /** Measured, so it differs run to run; compare reports without it. */
  timing: { elapsedMs: number; ticksPerSecond: number };
};

/** A fuzz that never ran: the scene has errors (`scene`) or doesn't load (`load`). */
export type FuzzRun = FuzzReport | PlaytestBlocked;
