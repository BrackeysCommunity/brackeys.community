/**
 * The run loop `runPlaytest` and `fuzz` share: a play world started the way
 * the editor's Play starts one, stepped on the runtime's clock from a source
 * of held actions, ended by the game's outcome, `stuck`, `script-end` or
 * `timeout`. The input's slots stand in for wall time: a turns or event game
 * that nothing wakes skips the slot.
 */

import type { ResolvedTime } from "../game/time";
import {
  EngineError,
  type GameCommand,
  type GameDefinition,
  type PlayState,
  type Registry,
  type RunResult,
} from "../game/types";
import type { ProjectRuntimeView } from "../project/runtime-view";
import { playWorld, preparePlay } from "../runtime/play-session";
import { createSceneRuntime } from "../runtime/runtime";
import type { LoadReport, SceneRuntimeHandle } from "../runtime/types";
import { makeIssue } from "../scene/issues";
import type {
  ExpandedScene,
  IssueCode,
  PrefabLibrary,
  SceneDefinition,
  SceneIssue,
} from "../scene/types";
import type { RapierModule, Vec2 } from "../types";
import { heldEdges } from "./compile-input-script";
import { inputAction } from "./headless";
import type { InputEdge, PlaytestBlocked, PlayOptions, ScriptIssue } from "./playtest-types";

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

/**
 * A run that an `EngineError` thrown out of a step ended: blocked at `run`,
 * with the scene's issues and the error as an issue carrying its code. Null
 * for any other error, which the caller rethrows.
 */
export function runBlocked(
  err: unknown,
  scene: string,
  issues: SceneIssue[],
  registry: Registry,
): PlaytestBlocked | null {
  if (!(err instanceof EngineError)) return null;
  const code = err.code as IssueCode;
  const fields = { message: err.message, entityIds: err.entityId ? [err.entityId] : [] };
  const issue: SceneIssue = registry.issueCodes[code]
    ? makeIssue(code, fields, registry.issueCodes)
    : { severity: "error", code, ...fields };
  return blockedRun("run", scene, [...issues, issue]);
}

export type PreparedRun =
  | { ok: true; scene: ExpandedScene; hash: string; issues: SceneIssue[] }
  | { ok: false; blocked: PlaytestBlocked };

/**
 * Play's first half (parse, validate, clone, freeze in dev, expand, hash);
 * errors block. `engine` is the project's `engine` block, which settings
 * resolve through.
 */
export function prepareRun(
  doc: SceneDefinition,
  registry: Registry,
  dev = false,
  prefabs?: PrefabLibrary,
  engine?: Readonly<Record<string, unknown>>,
): PreparedRun {
  const prepared = preparePlay(doc, registry, { dev, prefabs, engine });
  if (!prepared.ok) return { ok: false, blocked: blockedRun("scene", doc.name, prepared.issues) };
  return { ok: true, scene: prepared.scene, hash: prepared.hash, issues: prepared.issues };
}

/**
 * The prefabs a run's `ctx.instantiate` places: `library` when given (a
 * loader's whole library), else `prefabs`. Hashing and validation read only
 * the prefabs the scene's instances name, so either may hold more, and a
 * prefab only `ctx.instantiate` places is outside the scene and config
 * hashes: a change to it shows on replay as a digest mismatch.
 */
export function runLibrary(opts: {
  prefabs?: PrefabLibrary;
  library?: PrefabLibrary;
}): PrefabLibrary | undefined {
  return opts.library ?? opts.prefabs;
}

export type StartOptions = {
  /** Needed only for a scene whose physics resolves to Rapier. */
  rapier?: RapierModule | null;
  game: GameDefinition | null;
  registry: Registry;
  scene: ExpandedScene;
  play: PlayOptions;
  dev?: boolean;
  /** The project's data the game reads as `EngineContext.project`; its `engine` block sets the clock. */
  project?: ProjectRuntimeView | null;
  /** What `ctx.instantiate` places. */
  prefabs?: PrefabLibrary;
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
    project: opts.project,
    ...(opts.prefabs ? { prefabs: opts.prefabs } : {}),
  });
  const load = runtime.load(opts.scene, opts.play);
  if (load.ok) return { ok: true, runtime };
  runtime.destroy();
  return { ok: false, load };
}

/**
 * What a run plays, one slot at a time: the actions held, or the exact edges
 * a recording stepped. A fixed game simulates every slot; a turns or event
 * game only the slots something wakes, so slot and tick numbers can differ.
 */
export type InputSource = {
  /** True when the input has run out; the run ends as `script-end`. */
  done(): boolean;
  /** Every action held during `slot`; called once per slot, in order. */
  held?(slot: number): readonly string[];
  /** The edges to play in `slot`, in order, instead of `held`'s difference from the slot before. */
  edges?(slot: number): readonly InputEdge[];
  /** The commands to step on `slot`, in order. A command wakes every model. */
  commands?(slot: number): readonly GameCommand[];
  /** After each simulated tick, with what it produced. */
  after?(state: PlayState): void;
  /** After a slot the clock skipped: nothing woke an idle turns or event game. */
  skipped?(slot: number): void;
};

export type RunEnd = {
  result: RunResult;
  /** The last tick simulated. */
  tick: number;
  /** Ticks simulated. */
  ticks: number;
  /** Input slots consumed, skipped ones included; equal to `ticks` for a fixed game. */
  slots: number;
  cause?: string;
  entityId?: string;
};

export type RunLoopOptions = {
  runtime: SceneRuntimeHandle;
  game: GameDefinition | null;
  /** Simulated ticks before `timeout`. */
  maxTicks: number;
  /** Slots before `timeout`, simulated or skipped; default unbounded. */
  maxSlots?: number;
  input: InputSource;
  /** Every edge played is appended here, stamped with the tick that stepped it. */
  record?: InputEdge[];
  /** False skips `stuck`, for replaying a run that ended some other way. Default true. */
  stuck?: boolean;
  /** Simulate every slot whatever the time model, as a replay of recorded ticks does. */
  everySlot?: boolean;
  /** After each tick, with the edges and commands it stepped, before the run decides whether it is over. */
  onTick?(
    state: PlayState,
    focus: Vec2 | null,
    edges: readonly InputEdge[],
    commands: readonly GameCommand[],
  ): void;
};

/**
 * Whether a slot's input wakes an idle game on `time`'s clock: a command
 * wakes every model, and an action edge wakes an event game. A fixed clock
 * never idles. Headless input has no pointer, so `wakeOnPointerMove` never
 * applies here.
 */
export function slotWakes(
  time: Pick<ResolvedTime, "kind">,
  edges: readonly InputEdge[],
  commands: readonly GameCommand[],
): boolean {
  if (time.kind === "fixed" || commands.length > 0) return true;
  return time.kind === "event" && edges.length > 0;
}

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

/**
 * Steps `runtime` until the game's outcome, `stuck`, the input running out,
 * `maxTicks` simulated ticks or `maxSlots` slots. A turns or event game
 * skips a slot nothing wakes while it isn't busy; that slot's edges are
 * played, in order, with the next simulated tick.
 */
export function runLoop(opts: RunLoopOptions): RunEnd {
  const { runtime, input, maxTicks } = opts;
  const maxSlots = opts.maxSlots ?? Infinity;
  const time = runtime.ctx.time;
  const play = opts.game?.play;
  const movement = play?.focus ? (play.movementActions ?? []) : [];
  const stuck = movement.length > 0 && opts.stuck !== false ? stuckDetector() : null;
  let held: readonly string[] = [];
  let carried: InputEdge[] = [];
  let tick = 0;
  const world = playWorld(runtime.ctx);

  for (let slot = 0; ; slot++) {
    const last = { tick: tick - 1, ticks: tick, slots: slot };
    if (input.done()) return { result: "script-end", ...last };
    if (tick >= maxTicks || slot >= maxSlots) return { result: "timeout", ...last };

    let slotEdges: readonly InputEdge[];
    if (input.edges) {
      slotEdges = input.edges(slot);
      held = applyEdges(held, slotEdges);
    } else {
      const next = input.held?.(slot) ?? [];
      slotEdges = heldEdges(held, next, slot);
      held = next;
    }
    const commands = input.commands?.(slot) ?? [];
    if (!opts.everySlot && !slotWakes(time, slotEdges, commands) && !runtime.busy()) {
      carried.push(...slotEdges);
      input.skipped?.(slot);
      continue;
    }

    const edges: InputEdge[] = [...carried, ...slotEdges].map(([, action, pressed]) => [
      tick,
      action,
      pressed,
    ]);
    carried = [];
    opts.record?.push(...edges);
    const result = runtime.step(
      time.tickMs,
      edges.map(([t, action, pressed]) => inputAction(action, pressed === 1, t, time)),
      commands,
    );

    const state: PlayState = { tick, snapshot: result.game, events: result.events, world };
    const focus = play?.focus ? play.focus(result.game) : null;
    input.after?.(state);
    opts.onTick?.(state, focus, edges, commands);

    const ended = { tick, ticks: tick + 1, slots: slot + 1 };
    tick++;
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
