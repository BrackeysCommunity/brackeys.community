import type { SceneLibrary } from "../game/flow";
import type {
  DeviceId,
  GameCommand,
  GameDefinition,
  JsonValue,
  Registry,
  RunResult,
} from "../game/types";
import type { ProjectRuntimeView } from "../project/runtime-view";
import type { AssetId } from "../project/types";
import type { LoadReport, StepEvent } from "../runtime/types";
import type { AnalogSet, CountMatch, ExistsMatch, ScriptPointer } from "../scene/input-script";
import type { RecordingCommand, RecordingStream, RunRecording } from "../scene/recording-schema";
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
import type { SaveStart } from "./play-loop";

// ─── Play options ────────────────────────────────────────

/** How a play world starts: the same object for the editor's Play, `runPlaytest` and `fuzz`. */
export type PlayOptions<G = unknown> = {
  /** Start here instead of the game's spawn, cast onto the first surface below; refused inside a solid. */
  at?: Vec2;
  /** Advances time-driven systems (followers) by this much before tick 0. */
  timeOffsetMs?: number;
  /** The game's own options (the platformer's abilities), parsed by its `play.options`. */
  game?: G;
  /** Seeds `EngineContext.random`; omitted, `defaultSeed(gameId, sceneName)`. */
  seed?: number | string;
};

/** One input edge: at the start of `tick`, `action` goes down (1) or up (0). */
export type InputEdge = [tick: number, action: string, pressed: 0 | 1];

// ─── Input scripts ───────────────────────────────────────

/** The engine's `event` predicate: an event type, or a type with the entity ids it must name. */
export type EventMatch = string | { type: string; entityId?: string; other?: string };

/** The engine's `persist` predicate: the value at a JSON Pointer into `ctx.persist` equals, or is at least or at most, a value. */
export type PersistMatch = { pointer: string; eq?: JsonValue; gte?: number; lte?: number };

/**
 * When a step ends early: every key must hold (AND). `event`, `tick` (an
 * absolute tick, reached or passed), `exists`, `count`, `scene` and
 * `persist` are the engine's; the rest are the game's `play.predicates`.
 */
export type UntilClause = {
  event?: EventMatch;
  tick?: number;
  /** True while the entity exists and is enabled; `{ id, enabled: false }` while it exists at all. */
  exists?: ExistsMatch;
  /** The number of entities matching a selector keeps `min`, `max` or `eq`. */
  count?: CountMatch;
  /** Holds once the main scene is this scene. */
  scene?: AssetId;
  persist?: PersistMatch;
  [predicate: string]: unknown;
};

/**
 * How long a step runs: `for` ticks, `forMs` milliseconds (rounded to ticks at
 * the run's rate), or `until`, capped by `max` ticks. Lengths count input
 * slots, which an idle turns or event game skips without simulating.
 */
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
  | { wait: number }
  /** One slot that sends a game command, holding what the step before held. */
  | { command: string; args?: unknown }
  /** One slot that sends `@elapsed { ms }` (the game needs `time.catchUp`), holding what the step before held. */
  | { elapse: number };

export type InputScript<G = unknown> = {
  $schema?: string;
  v: 1;
  /** The scene this was written for; the CLI checks it against the scene it runs. */
  scene?: string;
  /** Play from here; omitted plays from the game's spawn. */
  at?: Pt;
  timeOffsetMs?: number;
  game?: G;
  /** Seeds `EngineContext.random` for the run, as `PlayOptions.seed`. */
  seed?: number | string;
  /** The run ends as `timeout` after this many simulated ticks (default 1800). */
  maxTicks?: number;
  steps: InputScriptStep[];
};

/**
 * A v2 step: v1's, plus `set` (axis values and vector pairs held for the
 * step, alone or with `hold`), `pointer`, and a seat's `join` and `leave`.
 */
export type InputScriptStepV2 =
  | ({ hold: string[]; set?: AnalogSet } & StepDuration)
  | ({ set: AnalogSet } & StepDuration)
  | ({ pointer: ScriptPointer } & StepDuration)
  | { press: string | string[] }
  | { wait: number }
  | { command: string; args?: unknown }
  | { elapse: number }
  /** A device for the track's seat. */
  | { join: DeviceId }
  | { leave: DeviceId };

/** One seat's steps, run concurrently with the other tracks from slot 0. */
export type InputScriptTrack = { player: number; steps: InputScriptStepV2[] };

/**
 * A v2 script: exactly one of `steps` (one track for seat 0, v1's form) or
 * `tracks`. It ends (`script-end`) when every track's steps ran out.
 */
export type InputScriptV2<G = unknown> = Omit<InputScript<G>, "v" | "steps"> & {
  v: 2;
  /** Seats the run has; default the game's. */
  players?: number;
} & (
    | { steps: InputScriptStepV2[]; tracks?: never }
    | { tracks: InputScriptTrack[]; steps?: never }
  );

/** A step with its duration in ticks and its held set resolved. */
export type CompiledStep = {
  /** Index into the script's `steps`. */
  index: number;
  hold: string[];
  /** Fixed length in slots (ticks, for a fixed game); absent when the step waits on `until`. */
  ticks?: number;
  until?: UntilClause;
  /** With `until`: the most slots the step may run. */
  max?: number;
  /** Sent on the step's one slot, args parsed. */
  commands?: GameCommand[];
};

export type CompiledInputScript = {
  /** The script's `scene`: a playtest of any other scene is refused. */
  scene?: string;
  steps: CompiledStep[];
  maxTicks: number;
  play: PlayOptions;
  /**
   * Seat 0's button edges before `maxTicks`, stamped with its slot, when no step waits
   * on `until`; otherwise edges are only known by running. Nothing is
   * released after the last step. For a fixed game these are the ticks played.
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
  /** Needed only for a scene whose physics resolves to Rapier; omitted or null, that scene's load fails. */
  rapier?: RapierModule | null;
  game?: GameDefinition<S, G> | null;
  /** Built from `game` when omitted. */
  registry?: Registry;
  /** Validated (errors block), hashed and expanded the way Play does. */
  scene: SceneDefinition;
  /** The prefabs the scene's instances name. */
  prefabs?: PrefabLibrary;
  /** Every prefab the game's `ctx.instantiate` may place, as `loadHeadless` returns it; default `prefabs`. */
  library?: PrefabLibrary;
  script: InputScript<G> | InputScriptV2<G> | CompiledInputScript;
  /** Cap on `events`; default 1000. */
  maxEvents?: number;
  /** Cap on `trail.pts`; default 2000. */
  maxTrail?: number;
  /** Freeze the played definition, as the editor's Play does in dev. */
  dev?: boolean;
  /** The project's data the game reads as `EngineContext.project`; null without one. */
  project?: ProjectRuntimeView | null;
  /** The listed scenes: with it the run follows flow requests on the same script; without it a request ends the run as `flow`. */
  flow?: SceneLibrary;
};

/** How one scene's part of a run ended: the request that left it (`flow`, with `to`), or the run's own end. */
export type PlaytestSegmentEnd = { result: RunResult; tick: number; to?: AssetId; entry?: string };

/** One scene a run visited: its ticks and its own recording, which replays alone. */
export type PlaytestSegment = {
  scene: AssetId;
  ticks: number;
  recording: RunRecording;
  end: PlaytestSegmentEnd;
};

/** How one script step went. */
export type PlaytestStep = {
  /** Index into the script's steps, or into its track's steps. */
  index: number;
  /** The track's seat, for a script written with tracks; absent for one written with steps. */
  player?: number;
  /** The slot it started on: its tick, for a fixed game. */
  start: number;
  /** Slots it ran: ticks, for a fixed game; a turns or event game may skip some. */
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
  /** With `result: "flow"`: the scene the request that ended the run went to. */
  to?: AssetId;
};

/**
 * How a playtest went. In a run that followed flow requests, `ticks`,
 * `slots`, `outcome.tick`, `steps`, `inputs`, `commands`, `events` and
 * `trail` cover every scene, ticks counted from the run's start; `scene`,
 * `sceneHash`, `stream` and `recording` are the first scene's, and
 * `segments` has each scene's own.
 */
export type PlaytestReport<S = unknown> = {
  blocked: false;
  scene: string;
  sceneHash: SceneHash;
  /** `probeConfigHash` of the game. */
  configHash: string;
  /** The run's ticks per second. */
  tickRate: number;
  outcome: PlaytestOutcomeReport;
  /** Ticks simulated. */
  ticks: number;
  /** Input slots the script used, skipped ones included; equal to `ticks` for a fixed game. */
  slots: number;
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
  /** The commands legal after the last tick (`GamePlayDef.commands`), at most 64; absent when the game declares none. */
  legal?: GameCommand[];
  /** True when `legal` was cut at 64 entries. */
  legalTruncated?: boolean;
  /**
   * Seat 0's button edges actually played, `until` steps resolved, as v1 held them.
   * @deprecated Read `stream`, which holds every seat's input.
   */
  inputs: InputEdge[];
  /** Every seat's input and the system events, as a v2 recording holds them; the first scene's. */
  stream: RecordingStream;
  /** The commands stepped, oldest first, stamped with the tick that stepped them. */
  commands: RecordingCommand[];
  /** Warnings and info the scene had; errors block instead. */
  issues: SceneIssue[];
  /** The run as a recording: `replayRecording` plays it again tick for tick; the first segment's in a multi-scene run. */
  recording: RunRecording;
  /** Each scene the run visited, in order; present when the run was given `flow`. */
  segments?: PlaytestSegment[];
};

/**
 * A playtest that didn't finish: the script didn't compile, the scene has
 * errors, it didn't load, or an `EngineError` ended the run (`run`, its code
 * in `issues`).
 */
export type PlaytestBlocked = {
  blocked: true;
  stage: "script" | "scene" | "load" | "run";
  scene: string;
  issues: SceneIssue[];
  scriptIssues: ScriptIssue[];
  /** The load failure, for `stage: "load"`. */
  load?: LoadReport;
};

export type PlaytestRun<S = unknown> = PlaytestReport<S> | PlaytestBlocked;

// ─── Fuzz ────────────────────────────────────────────────

export type FuzzOptions<S = unknown, G = unknown> = {
  /** Needed only for a scene whose physics resolves to Rapier. */
  rapier?: RapierModule | null;
  game?: GameDefinition<S, G> | null;
  registry?: Registry;
  scene: SceneDefinition;
  /** The prefabs the scene's instances name. */
  prefabs?: PrefabLibrary;
  /** Every prefab the game's `ctx.instantiate` may place, as `loadHeadless` returns it; default `prefabs`. */
  library?: PrefabLibrary;
  /** Seeds the generator; the same seed gives the same report (timing aside). */
  seed: number | string;
  /** Default 100. */
  rollouts?: number;
  /** Input slots per rollout, simulated or skipped; default 600. */
  ticks?: number;
  play?: PlayOptions<G>;
  dev?: boolean;
  /** The project's data the game reads as `EngineContext.project`; its `engine` block resolves the scene's settings and the clock. */
  project?: ProjectRuntimeView | null;
  /** Start every rollout from this save (`restoreSave`) instead of the scene's fresh load. */
  fromSave?: SaveStart;
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
  /** For a game that lists its commands and has no macro of its own: what the command macros did. */
  legal?: FuzzLegal;
  /** Measured, so it differs run to run; compare reports without it. */
  timing: { elapsedMs: number; ticksPerSecond: number };
};

/** The command macros of a fuzz over a game's legal commands, over every rollout. */
export type FuzzLegal = {
  /** Commands sent, each picked from the legal list of its slot. */
  sent: number;
  /** Command macros that found the list empty and held nothing for their slot. */
  empty: number;
};

/** A fuzz that never ran: the scene has errors (`scene`) or doesn't load (`load`). */
export type FuzzRun = FuzzReport | PlaytestBlocked;
