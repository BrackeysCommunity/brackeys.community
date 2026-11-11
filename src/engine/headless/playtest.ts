import { resolveTime } from "../game/time";
import type { GameDefinition, PlayState, Registry } from "../game/types";
import {
  createRunRecorder,
  recordedCommand,
  recordingRapier,
  trailPoint,
  type RecordingHost,
} from "../runtime/recorder";
import { createSceneRuntime, resolveGame } from "../runtime/runtime";
import type { StepEvent } from "../runtime/types";
import type { CountMatch, ExistsMatch } from "../scene/input-script";
import type { RecordingCommand } from "../scene/recording-schema";
import type { Pt } from "../scene/types";
import { compileInputScript, scriptSource } from "./compile-input-script";
import { probeConfigHash } from "./headless";
import { blockedRun, prepareRun, runBlocked, runLibrary, runLoop } from "./play-loop";
import type {
  CompiledInputScript,
  EventMatch,
  InputEdge,
  InputScript,
  InputScriptV2,
  PlaytestOptions,
  PlaytestReport,
  PlaytestRun,
  UntilClause,
} from "./playtest-types";

const DEFAULT_MAX_EVENTS = 1000;
const DEFAULT_MAX_TRAIL = 2000;
const TRAIL_EVERY = 4;

function isCompiled(
  script: InputScript | InputScriptV2 | CompiledInputScript,
): script is CompiledInputScript {
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

function existsHolds(match: ExistsMatch, state: PlayState): boolean {
  if (typeof match === "string") return state.world.exists(match);
  return state.world.exists(match.id, match.enabled === false ? { enabled: false } : undefined);
}

function countHolds(match: CountMatch, state: PlayState): boolean {
  const { min, max, eq, ...sel } = match;
  const n = state.world.count(sel);
  if (eq !== undefined) return n === eq;
  return (min === undefined || n >= min) && (max === undefined || n <= max);
}

/**
 * Whether every key of `until` holds on `state` (AND): the engine's `event`,
 * `tick`, `exists` and `count`, then `registry`'s game predicates. A key no
 * predicate answers doesn't hold. `reaches` checks judge `expect` with it too.
 */
export function untilHolds(until: UntilClause, state: PlayState, registry: Registry): boolean {
  const predicates = registry.game?.play?.predicates ?? {};
  for (const [key, arg] of Object.entries(until)) {
    if (arg === undefined) continue;
    let holds: boolean;
    if (key === "event") holds = state.events.some((e) => eventMatches(arg as EventMatch, e));
    else if (key === "tick") holds = state.tick >= (arg as number);
    else if (key === "exists") holds = existsHolds(arg as ExistsMatch, state);
    else if (key === "count") holds = countHolds(arg as CountMatch, state);
    else holds = predicates[key]?.test(arg, state) ?? false;
    if (!holds) return false;
  }
  return true;
}

export type PlaytestHooks = {
  /** After the run, with its last simulated tick's state while its world is still live; not called when no tick ran. */
  onLastTick?(state: PlayState): void;
};

/**
 * Plays an input script on a scene headless, starting the run the way the
 * editor's Play does (validation errors block, the document is cloned and
 * expanded, `at` is cast with the game's spawn shape), and reports how it
 * ended: the game's outcome, else `stuck`, `script-end` or `timeout`.
 * Deterministic: the same scene, game and script give the same report.
 */
export function runPlaytest<S = unknown, G = unknown>(
  opts: PlaytestOptions<S, G> & PlaytestHooks & RecordingHost,
): PlaytestRun<S> {
  const { registry, game } = resolveGame({
    game: opts.game as GameDefinition | null | undefined,
    registry: opts.registry,
  });
  const name = opts.scene.name;

  const engine = opts.project?.engine;
  let script: CompiledInputScript;
  if (isCompiled(opts.script)) script = opts.script;
  else {
    const compiled = compileInputScript(
      opts.script,
      registry,
      resolveTime({ project: engine, game: registry.time }),
    );
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

  const library = runLibrary(opts);
  const prepared = prepareRun(opts.scene, registry, opts.dev, opts.prefabs, engine, {
    project: opts.project,
    library,
  });
  if (!prepared.ok) return prepared.blocked as PlaytestRun<S>;
  const runtime = createSceneRuntime({
    rapier: opts.rapier,
    view: null,
    game,
    registry,
    dev: opts.dev,
    project: opts.project,
    prefabs: library,
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
    const commands: RecordingCommand[] = [];
    const time = runtime.ctx.time;
    const input = scriptSource(script, (until, state) => untilHolds(until, state, registry), time);
    const recorder = createRunRecorder({
      rapier: recordingRapier(prepared.scene, opts.rapier),
      game,
      scene: name,
      sceneHash: prepared.hash,
      runHash: prepared.runHash,
      start: script.play,
      time,
      players: runtime.ctx.input.players(),
      platform: opts.platform,
      projectRef: opts.projectRef,
      maxTrail,
    });

    let last = null as PlayState | null;
    let end: ReturnType<typeof runLoop>;
    try {
      end = runLoop({
        runtime,
        game,
        maxTicks: script.maxTicks,
        input,
        record: inputs,
        onTick(state, focus, _edges, stepped, tickInput) {
          last = state;
          recorder.tick(state, tickInput, focus);
          for (const c of stepped) commands.push(recordedCommand(state.tick, c));
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
    } catch (err) {
      const blocked = runBlocked(err, name, prepared.issues, registry);
      if (blocked) return blocked;
      throw err;
    }
    if (last) opts.onLastTick?.(last);

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
    const recording = recorder.finish(end, final);
    const { actions, commands: commandNames, inputs: seatStreams, system } = recording;

    return {
      blocked: false,
      scene: name,
      sceneHash: prepared.hash,
      configHash: probeConfigHash(game, time),
      tickRate: time.rate,
      outcome,
      ticks: end.ticks,
      slots: end.slots,
      events,
      truncated: eventsTruncated,
      trail: { every: TRAIL_EVERY, pts, truncated: trailTruncated },
      stepsReached: steps.length,
      steps,
      final,
      inputs,
      stream: structuredClone({ actions, commands: commandNames, inputs: seatStreams, system }),
      commands,
      issues: prepared.issues,
      recording,
    };
  } finally {
    runtime.destroy();
  }
}
