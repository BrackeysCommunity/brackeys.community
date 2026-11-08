import type { GameDefinition, PlayState, ScriptPredicate } from "../game/types";
import { TICK_RATE } from "../physics";
import { createRunRecorder, trailPoint } from "../runtime/recorder";
import { createSceneRuntime, resolveGame } from "../runtime/runtime";
import type { StepEvent } from "../runtime/types";
import type { Pt } from "../scene/types";
import { compileInputScript } from "./compile-input-script";
import { probeConfigHash } from "./headless";
import { blockedRun, prepareRun, runLoop, type InputSource } from "./play-loop";
import type {
  CompiledInputScript,
  EventMatch,
  InputEdge,
  InputScript,
  PlaytestOptions,
  PlaytestReport,
  PlaytestRun,
  PlaytestStep,
  UntilClause,
} from "./playtest-types";

const DEFAULT_MAX_EVENTS = 1000;
const DEFAULT_MAX_TRAIL = 2000;
const TRAIL_EVERY = 4;

function isCompiled(script: InputScript | CompiledInputScript): script is CompiledInputScript {
  return (
    typeof script === "object" &&
    script !== null &&
    !("v" in script) &&
    "play" in script &&
    "maxTicks" in script
  );
}

function eventMatches(match: EventMatch, e: StepEvent): boolean {
  if (typeof match === "string") return e.type === match;
  return (
    e.type === match.type &&
    (match.entityId === undefined || e.entityId === match.entityId) &&
    (match.other === undefined || e.other === match.other)
  );
}

/** Whether every key of `until` holds after this tick. */
function untilHolds(
  until: UntilClause,
  state: PlayState,
  predicates: Readonly<Record<string, ScriptPredicate>>,
): boolean {
  for (const [key, arg] of Object.entries(until)) {
    if (key === "event") {
      if (!state.events.some((e) => eventMatches(arg as EventMatch, e))) return false;
    } else if (key === "tick") {
      if (state.tick < (arg as number)) return false;
    } else if (!predicates[key]?.test(arg, state)) {
      return false;
    }
  }
  return true;
}

/** Plays a compiled script step by step, logging how each step went. */
function scriptInput(
  script: CompiledInputScript,
  predicates: Readonly<Record<string, ScriptPredicate>>,
): InputSource & { log(): PlaytestStep[] } {
  const { steps } = script;
  const log: PlaytestStep[] = [];
  let at = 0;
  let ran = 0;
  let start = 0;
  return {
    done: () => at >= steps.length,
    held(tick) {
      if (ran === 0) start = tick;
      return steps[at]!.hold;
    },
    after(state) {
      const step = steps[at]!;
      ran++;
      let end: PlaytestStep["end"] | null = null;
      if (step.ticks !== undefined) {
        if (ran >= step.ticks) end = "done";
      } else if (untilHolds(step.until!, state, predicates)) end = "until";
      else if (ran >= step.max!) end = "max";
      if (end) {
        log.push({ index: step.index, start, ticks: ran, end });
        at++;
        ran = 0;
      }
    },
    log: () =>
      ran > 0 ? [...log, { index: steps[at]!.index, start, ticks: ran, end: "run" }] : log,
  };
}

/**
 * Plays an input script on a scene headless, starting the run the way the
 * editor's Play does (validation errors block, the document is cloned and
 * expanded, `at` is cast with the game's spawn shape), and reports how it
 * ended: the game's outcome, else `stuck`, `script-end` or `timeout`.
 * Deterministic: the same scene, game and script give the same report.
 */
export function runPlaytest<S = unknown, G = unknown>(opts: PlaytestOptions<S, G>): PlaytestRun<S> {
  const { registry, game } = resolveGame({
    game: opts.game as GameDefinition | null | undefined,
    registry: opts.registry,
  });
  const name = opts.scene.name;

  let script: CompiledInputScript;
  if (isCompiled(opts.script)) script = opts.script;
  else {
    const compiled = compileInputScript(opts.script, registry);
    if (!compiled.ok) return blockedRun("script", name, [], compiled.issues);
    script = compiled.script;
  }
  if (script.scene !== undefined && script.scene !== name) {
    return blockedRun(
      "script",
      name,
      [],
      [
        {
          path: "/scene",
          message: `the script is for scene ${JSON.stringify(script.scene)}, not ${JSON.stringify(name)}`,
          expected: JSON.stringify(name),
          got: JSON.stringify(script.scene),
          hint: "Change or remove the script's `scene` to run it here.",
        },
      ],
    );
  }

  const prepared = prepareRun(opts.scene, registry, opts.dev, opts.prefabs);
  if (!prepared.ok) return prepared.blocked as PlaytestRun<S>;
  const runtime = createSceneRuntime({
    rapier: opts.rapier,
    view: null,
    game,
    registry,
    dev: opts.dev,
    project: opts.project,
  });
  const load = runtime.load(prepared.scene, script.play);
  if (!load.ok) {
    runtime.destroy();
    return blockedRun("load", name, prepared.issues, [], load);
  }

  try {
    const maxEvents = opts.maxEvents ?? DEFAULT_MAX_EVENTS;
    const maxTrail = opts.maxTrail ?? DEFAULT_MAX_TRAIL;
    const events: StepEvent[] = [];
    let eventsTruncated = false;
    const pts: Pt[] = [];
    let trailTruncated = false;
    const inputs: InputEdge[] = [];
    const input = scriptInput(script, game?.play?.predicates ?? {});
    const recorder = createRunRecorder({
      rapier: opts.rapier,
      game,
      scene: name,
      sceneHash: prepared.hash,
      start: script.play,
      maxTrail,
    });

    const end = runLoop({
      runtime,
      game,
      maxTicks: script.maxTicks,
      input,
      record: inputs,
      onTick(state, focus, edges) {
        recorder.tick(state, edges, focus);
        for (const e of state.events) {
          if (events.length < maxEvents) events.push(e);
          else eventsTruncated = true;
        }
        if (focus && state.tick % TRAIL_EVERY === 0) {
          if (pts.length < maxTrail) pts.push(trailPoint(focus));
          else trailTruncated = true;
        }
      },
    });

    const final = runtime.snapshot() as S | null;
    const focus = game?.play?.focus && final !== null ? game.play.focus(final) : null;
    const outcome: PlaytestReport<S>["outcome"] = {
      result: end.result,
      tick: end.tick,
      at: focus ? { x: focus.x, y: focus.y } : null,
    };
    if (end.cause !== undefined) outcome.cause = end.cause;
    if (end.entityId !== undefined) outcome.entityId = end.entityId;
    const steps = input.log();

    return {
      blocked: false,
      scene: name,
      sceneHash: prepared.hash,
      configHash: probeConfigHash(game),
      tickRate: TICK_RATE,
      outcome,
      ticks: end.ticks,
      events,
      truncated: eventsTruncated,
      trail: { every: TRAIL_EVERY, pts, truncated: trailTruncated },
      stepsReached: steps.length,
      steps,
      final,
      inputs,
      issues: prepared.issues,
      recording: recorder.finish(end, final),
    };
  } finally {
    runtime.destroy();
  }
}
