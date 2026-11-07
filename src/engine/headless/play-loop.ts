/**
 * The run loop `runPlaytest` and `fuzz` share: a play world started the way
 * the editor's Play starts one, stepped at 60 Hz from a source of held
 * actions, ended by the game's outcome, `stuck`, `script-end` or `timeout`.
 */
import type { GameDefinition, PlayState, Registry, RunResult } from "../game/types";
import { TICK_RATE } from "../physics";
import { preparePlay } from "../runtime/play-session";
import { createSceneRuntime } from "../runtime/runtime";
import type { LoadReport, SceneRuntimeHandle } from "../runtime/types";
import type { ExpandedScene, PrefabLibrary, SceneDefinition, SceneIssue } from "../scene/types";
import type { RapierModule, Vec2 } from "../types";
import { heldEdges } from "./compile-input-script";
import { inputAction } from "./headless";
import type { InputEdge, PlaytestBlocked, PlayOptions, ScriptIssue } from "./playtest-types";

const TICK_MS = 1000 / TICK_RATE;

/** Holding a movement action with the focus moving under `STUCK_PX` over `STUCK_TICKS` ticks is `stuck`. */
export const STUCK_TICKS = 120;
export const STUCK_PX = 4;

export function blockedRun(
  stage: PlaytestBlocked["stage"],
  scene: string,
  issues: SceneIssue[],
  scriptIssues: ScriptIssue[] = [],
  load?: LoadReport,
): PlaytestBlocked {
  const out: PlaytestBlocked = { blocked: true, stage, scene, issues, scriptIssues };
  if (load) out.load = load;
  return out;
}

export type PreparedRun =
  | { ok: true; scene: ExpandedScene; hash: string; issues: SceneIssue[] }
  | { ok: false; blocked: PlaytestBlocked };

/** Play's first half (parse, validate, clone, freeze in dev, expand, hash); errors block. */
export function prepareRun(
  doc: SceneDefinition,
  registry: Registry,
  dev = false,
  prefabs?: PrefabLibrary,
): PreparedRun {
  const prepared = preparePlay(doc, registry, { dev, prefabs });
  if (!prepared.ok) return { ok: false, blocked: blockedRun("scene", doc.name, prepared.issues) };
  return { ok: true, scene: prepared.scene, hash: prepared.hash, issues: prepared.issues };
}

export type StartOptions = {
  rapier: RapierModule;
  game: GameDefinition | null;
  registry: Registry;
  scene: ExpandedScene;
  play: PlayOptions;
  dev?: boolean;
};

/** A fresh headless play world for one run; the caller destroys the runtime. */
export function startRun(
  opts: StartOptions,
): { ok: true; runtime: SceneRuntimeHandle } | { ok: false; load: LoadReport } {
  const runtime = createSceneRuntime({
    rapier: opts.rapier,
    view: null,
    game: opts.game,
    registry: opts.registry,
    dev: opts.dev,
  });
  const load = runtime.load(opts.scene, opts.play);
  if (load.ok) return { ok: true, runtime };
  runtime.destroy();
  return { ok: false, load };
}

/** What a run plays: the actions held on each tick, or the exact edges a recording stepped. */
export type InputSource = {
  /** True when the input has run out; the run ends as `script-end`. */
  done(): boolean;
  /** Every action held during `tick`; called once per simulated tick, in order. */
  held?(tick: number): readonly string[];
  /** The edges to step on `tick`, in order, instead of `held`'s difference from the tick before. */
  edges?(tick: number): readonly InputEdge[];
  /** After each tick, with what it produced. */
  after?(state: PlayState): void;
};

export type RunEnd = {
  result: RunResult;
  /** The last tick simulated. */
  tick: number;
  /** Ticks simulated. */
  ticks: number;
  cause?: string;
  entityId?: string;
};

export type RunLoopOptions = {
  runtime: SceneRuntimeHandle;
  game: GameDefinition | null;
  maxTicks: number;
  input: InputSource;
  /** Every edge played is appended here. */
  record?: InputEdge[];
  /** False skips `stuck`, for replaying a run that ended some other way. Default true. */
  stuck?: boolean;
  /** After each tick, with the edges it stepped, before the run decides whether it is over. */
  onTick?(state: PlayState, focus: Vec2 | null, edges: readonly InputEdge[]): void;
};

/** `held` after `edges`: a down adds its action, an up removes it. */
function applyEdges(held: readonly string[], edges: readonly InputEdge[]): string[] {
  const next = [...held];
  for (const [, action, pressed] of edges) {
    const at = next.indexOf(action);
    if (pressed === 1 && at < 0) next.push(action);
    else if (pressed === 0 && at >= 0) next.splice(at, 1);
  }
  return next;
}

/** Tracks the focus while a movement action is held; true once it has moved under `STUCK_PX` in `STUCK_TICKS` ticks. */
function stuckDetector(): (moving: boolean, focus: Vec2 | null) => boolean {
  const window = STUCK_TICKS + 1;
  const xs = new Float64Array(window);
  const ys = new Float64Array(window);
  let streak = 0;
  return (moving, focus) => {
    if (!moving || !focus) {
      streak = 0;
      return false;
    }
    xs[streak % window] = focus.x;
    ys[streak % window] = focus.y;
    streak++;
    if (streak < window) return false;
    const then = streak % window;
    return Math.hypot(focus.x - xs[then]!, focus.y - ys[then]!) < STUCK_PX;
  };
}

/** Steps `runtime` until the game's outcome, `stuck`, the input running out, or `maxTicks`. */
export function runLoop(opts: RunLoopOptions): RunEnd {
  const { runtime, input, maxTicks } = opts;
  const play = opts.game?.play;
  const movement = play?.focus ? (play.movementActions ?? []) : [];
  const stuck = movement.length > 0 && opts.stuck !== false ? stuckDetector() : null;
  let held: readonly string[] = [];

  for (let tick = 0; ; tick++) {
    const last = { tick: tick - 1, ticks: tick };
    if (input.done()) return { result: "script-end", ...last };
    if (tick >= maxTicks) return { result: "timeout", ...last };

    let edges: readonly InputEdge[];
    if (input.edges) {
      edges = input.edges(tick);
      held = applyEdges(held, edges);
    } else {
      const next = input.held?.(tick) ?? [];
      edges = heldEdges(held, next, tick);
      held = next;
    }
    opts.record?.push(...edges);
    const result = runtime.step(
      TICK_MS,
      edges.map(([t, action, pressed]) => inputAction(action, pressed === 1, t)),
    );

    const state: PlayState = { tick, snapshot: result.game, events: result.events };
    const focus = play?.focus ? play.focus(result.game) : null;
    input.after?.(state);
    opts.onTick?.(state, focus, edges);

    const ended = { tick, ticks: tick + 1 };
    const verdict = play?.outcome?.(state);
    if (verdict) {
      const out: RunEnd = { result: verdict.result, ...ended };
      if (verdict.cause !== undefined) out.cause = verdict.cause;
      if (verdict.entityId !== undefined) out.entityId = verdict.entityId;
      return out;
    }
    if (
      stuck?.(
        held.some((a) => movement.includes(a)),
        focus,
      )
    ) {
      return {
        result: "stuck",
        ...ended,
        cause: `the focus moved under ${STUCK_PX}px in ${STUCK_TICKS} ticks while holding ${held.filter((a) => movement.includes(a)).join(", ")}`,
      };
    }
  }
}
