import { flowIssue, type FlowRequest, type SceneLibrary } from "../game/flow";
import { resolveTime } from "../game/time";
import type { GameDefinition, JsonValue, PlayState, Registry } from "../game/types";
import { sameValue } from "../project/canonical";
import { parseJsonPointer } from "../project/json-edit";
import type { ProjectRuntimeView } from "../project/runtime-view";
import type { AssetId } from "../project/types";
import { recordLiveSwaps } from "../runtime/live";
import { gamePersistCell } from "../runtime/persist";
import {
  createRunRecorder,
  recordedCommand,
  recordingRapier,
  trailPoint,
  type RecordingHost,
} from "../runtime/recorder";
import { resolveGame } from "../runtime/runtime";
import type { SceneRuntimeHandle, StepEvent } from "../runtime/types";
import type { CountMatch, ExistsMatch, NearMatch } from "../scene/input-script";
import { makeIssue } from "../scene/issues";
import type { RecordingCommand, RunRecording } from "../scene/recording-schema";
import type { PrefabLibrary, Pt, SceneDefinition, SceneIssue } from "../scene/types";
import { compileInputScript, scriptSource, type ScriptSource } from "./compile-input-script";
import { probeConfigHash } from "./headless";
import { legalCommands, startState } from "./legal";
import {
  blockedRun,
  listedSceneId,
  nextScenePlay,
  prepareRun,
  runBlocked,
  runLibrary,
  runLoop,
  standingInput,
  startRun,
  type InputSource,
  type PreparedRun,
  type RunEnd,
  type SaveStart,
  type StandingInput,
} from "./play-loop";
import type {
  CompiledInputScript,
  CompileResult,
  EventMatch,
  InputEdge,
  InputScript,
  InputScriptV2,
  PlaytestOptions,
  PlaytestReport,
  PersistMatch,
  PlaytestRun,
  PlaytestSegment,
  PlayOptions,
  ScriptIssue,
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

/**
 * Entity `id`'s pose is within `within` metres of `to`, a point or another
 * entity's pose. A missing pose on either side doesn't hold, as does a
 * world that reads no poses.
 */
function nearHolds(match: NearMatch, state: PlayState): boolean {
  const world = state.world;
  const at = world.pose?.(match.id);
  if (!at) return false;
  let tx: number;
  let ty: number;
  if (typeof match.to === "string") {
    const other = world.pose?.(match.to);
    if (!other) return false;
    tx = other.x;
    ty = other.y;
  } else [tx, ty] = match.to;
  const dx = at.x - tx;
  const dy = at.y - ty;
  return dx * dx + dy * dy <= match.within * match.within;
}

function countHolds(match: CountMatch, state: PlayState): boolean {
  const { min, max, eq, ...sel } = match;
  const n = state.world.count(sel);
  if (eq !== undefined) return n === eq;
  return (min === undefined || n >= min) && (max === undefined || n <= max);
}

/** The value at `pointer` in `value`; undefined when the pointer is malformed or names nothing. */
function atPointer(value: JsonValue | undefined, pointer: string): JsonValue | undefined {
  const tokens = parseJsonPointer(pointer);
  if (!tokens) return undefined;
  let at: JsonValue | undefined = value;
  for (const token of tokens) {
    if (Array.isArray(at)) at = /^(0|[1-9]\d*)$/.test(token) ? at[Number(token)] : undefined;
    else if (at !== null && typeof at === "object" && Object.hasOwn(at, token)) at = at[token];
    else return undefined;
  }
  return at;
}

/** Every bound holds on the value at the pointer; `gte` and `lte` hold only on a number. */
function persistHolds(match: PersistMatch, state: PlayState): boolean {
  const at = atPointer(state.persist, match.pointer);
  if (at === undefined) return false;
  if (match.eq !== undefined && !sameValue(at, match.eq)) return false;
  if (match.gte === undefined && match.lte === undefined) return true;
  if (typeof at !== "number") return false;
  return (
    (match.gte === undefined || at >= match.gte) && (match.lte === undefined || at <= match.lte)
  );
}

/**
 * Whether every key of `until` holds on `state` (AND): the engine's `event`,
 * `tick`, `exists`, `count`, `near`, `scene` (the main scene is `scene`, the run's
 * listed id for it; never without one) and `persist`, then `registry`'s
 * game predicates. A key no predicate answers doesn't hold. `reaches` checks
 * judge `expect` with it too.
 */
export function untilHolds(
  until: UntilClause,
  state: PlayState,
  registry: Registry,
  scene: AssetId | null = null,
): boolean {
  const predicates = registry.game?.play?.predicates ?? {};
  for (const [key, arg] of Object.entries(until)) {
    if (arg === undefined) continue;
    let holds: boolean;
    if (key === "event") holds = state.events.some((e) => eventMatches(arg as EventMatch, e));
    else if (key === "tick") holds = state.tick >= (arg as number);
    else if (key === "exists") holds = existsHolds(arg as ExistsMatch, state);
    else if (key === "count") holds = countHolds(arg as CountMatch, state);
    else if (key === "near") holds = nearHolds(arg as NearMatch, state);
    else if (key === "scene") holds = scene !== null && arg === scene;
    else if (key === "persist") holds = persistHolds(arg as PersistMatch, state);
    else holds = predicates[key]?.test(arg, state) ?? false;
    if (!holds) return false;
  }
  return true;
}

export type PlaytestHooks = {
  /** After the run, with its last simulated tick's state while its world is still live; not called when no tick ran. */
  onLastTick?(state: PlayState): void;
  /**
   * After the run, with the last scene's runtime between ticks and before
   * it is destroyed: what `captureSave` takes. Not called for a blocked run.
   */
  onEnd?(runtime: SceneRuntimeHandle): void;
};

/** Where a run starts: the scene's fresh load, or a save of it. */
export type PlaytestStart = {
  /**
   * Start from this save of the scene (`restoreSave`) instead of its fresh
   * load; the first scene's recording names it as `fromSave`, and the
   * script plays from the save's moment. A save of another scene is refused.
   */
  fromSave?: SaveStart;
};

/** One scene of a run, ready to load. */
type SegmentStart = {
  /** The listed id; the scene's name when the run has no library. */
  id: AssetId;
  def: SceneDefinition;
  prefabs?: PrefabLibrary;
  library?: PrefabLibrary;
  entry: string | null;
  play: PlayOptions;
  prepared: Extract<PreparedRun, { ok: true }>;
};

/** `source` for one scene of a run: slots and ticks counted from the run's start, as `until` and the step log read them. */
function segmentSource(source: InputSource, base: { slots: number; ticks: number }): InputSource {
  return {
    done: () => source.done(),
    tick: (slot) => source.tick!(base.slots + slot),
    after: (state) => source.after?.({ ...state, tick: base.ticks + state.tick }),
    skipped: (slot) => source.skipped?.(base.slots + slot),
  };
}

/**
 * Compiles `script` as `runPlaytest` plays it: at the rate the project's
 * `engine` block and the game give, its seats and pointer bindings the
 * project input map's over the game's.
 */
export function compilePlaytestScript(
  script: InputScript | InputScriptV2,
  registry: Registry,
  project?: ProjectRuntimeView | null,
): CompileResult {
  return compileInputScript(
    script,
    registry,
    resolveTime({ project: project?.engine, game: registry.time }),
    project?.inputMap?.players,
    project?.inputMap,
  );
}

/** The issue when `script` names a scene other than `name`, the one playing; null when it fits. */
export function scriptSceneIssue(
  script: Pick<CompiledInputScript, "scene">,
  name: string,
): ScriptIssue | null {
  if (script.scene === undefined || script.scene === name) return null;
  return {
    path: "/scene",
    message: `the script is for scene ${JSON.stringify(script.scene)}, not ${JSON.stringify(name)}`,
    expected: JSON.stringify(name),
    got: JSON.stringify(script.scene),
    hint: "Change or remove the script's `scene` to run it here.",
  };
}

/**
 * Plays an input script on a scene headless, starting the run the way the
 * editor's Play does (validation errors block, the document is cloned and
 * expanded, `at` is cast with the game's spawn shape), and reports how it
 * ended: the game's outcome, else `stuck`, `script-end` or `timeout`. Its
 * tracks drive the seats the run has, the project input map's over the
 * game's (`scriptSeatLimit`). A game that lists its commands gets `legal`
 * after the last tick, else at the start (`legalCommands`), as `runProbe`
 * does. A flow request game code makes ends the run as `flow`; with
 * `flow`, the run follows it instead: after the tick the next listed scene
 * loads in a fresh runtime (persist carried, the request's `persist` and
 * `entry` applied, the keys still held pressed again) and the same script
 * goes on, each scene recorded on its own in `segments`. With `fromSave`
 * the first scene starts where the save left off. Deterministic: the same
 * scenes, game, save and script give the same report.
 */
export function runPlaytest<S = unknown, G = unknown>(
  opts: PlaytestOptions<S, G> & PlaytestStart & PlaytestHooks & RecordingHost,
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
    const compiled = compilePlaytestScript(opts.script, registry, opts.project);
    if (!compiled.ok) return blockedRun("script", name, [], compiled.issues);
    script = compiled.script;
  }
  const otherScene = scriptSceneIssue(script, name);
  if (otherScene) return blockedRun("script", name, [], [otherScene]);

  const flow = opts.flow ?? null;
  const prepare = (def: SceneDefinition, prefabs?: PrefabLibrary, library?: PrefabLibrary) =>
    prepareRun(def, registry, opts.dev, prefabs, engine, {
      project: opts.project,
      library: runLibrary({ prefabs, library }),
    });
  const first = prepare(opts.scene, opts.prefabs, opts.library);
  if (!first.ok) return first.blocked as PlaytestRun<S>;
  const persist = gamePersistCell(game, true);

  const maxEvents = opts.maxEvents ?? DEFAULT_MAX_EVENTS;
  const maxTrail = opts.maxTrail ?? DEFAULT_MAX_TRAIL;
  const events: StepEvent[] = [];
  let eventsTruncated = false;
  const pts: Pt[] = [];
  let trailTruncated = false;
  const inputs: InputEdge[] = [];
  const commands: RecordingCommand[] = [];
  const issues = [...first.issues];
  const segments: PlaytestSegment[] = [];
  const base = { slots: 0, ticks: 0 };

  let current: SegmentStart = {
    id: (flow && listedSceneId(flow, opts.scene)) ?? name,
    def: opts.scene,
    ...(opts.prefabs ? { prefabs: opts.prefabs } : {}),
    ...(opts.library ? { library: opts.library } : {}),
    entry: null,
    play: script.play,
    prepared: first,
  };
  let source: ScriptSource | null = null;
  let standing: StandingInput | null = null;
  let firstRecording: RunRecording | null = null;

  let fromSave = opts.fromSave ?? null;
  if (fromSave && fromSave.file.scene.id !== current.id) {
    return blockedRun("load", name, [
      ...issues,
      makeIssue("schema", {
        message: `the save is of "${fromSave.file.scene.id}", not the scene played, "${current.id}"`,
        path: "/scene/id",
        got: fromSave.file.scene.id,
        expected: current.id,
      }),
    ]);
  }

  for (;;) {
    const seg = current;
    const segName = seg.def.name;
    const saved = fromSave;
    fromSave = null;
    let persistAtLoad: JsonValue | undefined;
    try {
      persistAtLoad = game?.persist ? persist.value : undefined;
    } catch (err) {
      const blocked = runBlocked(err, segName, issues, registry);
      if (blocked) return blocked;
      throw err;
    }
    const started = startRun({
      rapier: opts.rapier,
      game,
      registry,
      scene: seg.prepared.scene,
      play: seg.play,
      dev: opts.dev,
      project: opts.project,
      ...(runLibrary(seg) ? { prefabs: runLibrary(seg) } : {}),
      persist,
      ...(flow ? { flow: { scene: seg.id, entry: seg.entry, library: flow } } : {}),
      ...(saved ? { fromSave: saved.file } : {}),
      ...(opts.timing ? { timing: opts.timing } : {}),
    });
    if (!started.ok)
      return blockedRun(
        "load",
        segName,
        started.issue ? [...issues, started.issue] : issues,
        [],
        started.load,
      );
    const { runtime } = started;
    issues.push(...(started.issues ?? []));
    if (saved && game?.persist) persistAtLoad = persist.value;

    try {
      const time = runtime.ctx.time;
      source ??= scriptSource(
        script,
        (until, state) => untilHolds(until, state, registry, current.id),
        time,
      );
      const carry = standing?.carry(runtime.ctx.input.players()) ?? null;
      standing ??= standingInput(runtime.ctx.input.players());
      const recorder = createRunRecorder({
        rapier: recordingRapier(seg.prepared.scene, opts.rapier),
        game,
        scene: segName,
        sceneHash: seg.prepared.hash,
        runHash: seg.prepared.runHash,
        start: seg.play,
        ...(persistAtLoad !== undefined ? { persist: persistAtLoad } : {}),
        entry: seg.entry,
        ...(saved ? { fromSave: { slot: saved.file.slot, sha256: saved.sha256 } } : {}),
        sceneVersion: runtime.ctx.live.version,
        time,
        players: runtime.ctx.input.players(),
        platform: opts.platform,
        projectRef: opts.projectRef,
        maxTrail,
        registry,
      });
      started.live.onApplied(recordLiveSwaps(recorder, started.live, runtime.ctx.tick));

      let last = null as PlayState | null;
      let end: RunEnd;
      try {
        end = runLoop({
          runtime,
          game,
          maxTicks: script.maxTicks - base.ticks,
          input: segmentSource(source, base),
          carry,
          live: started.live,
          onTick(state, focus, edges, stepped, tickInput) {
            last = state;
            const at = base.ticks + state.tick;
            standing!.step(tickInput);
            recorder.tick(state, tickInput, focus);
            for (const [, action, pressed] of edges) inputs.push([at, action, pressed]);
            for (const c of stepped) commands.push(recordedCommand(at, c));
            for (const e of state.events) {
              if (events.length < maxEvents) events.push(base.ticks ? { ...e, tick: at } : e);
              else eventsTruncated = true;
            }
            if (focus && at % TRAIL_EVERY === 0) {
              if (pts.length < maxTrail) pts.push(trailPoint(focus));
              else trailTruncated = true;
            }
          },
        });
      } catch (err) {
        const blocked = runBlocked(err, segName, issues, registry);
        if (blocked) return blocked;
        throw err;
      }

      const request = end.request;
      const final = runtime.snapshot() as S | null;
      const next = request
        ? { scene: request.to, ...(request.entry !== undefined ? { entry: request.entry } : {}) }
        : undefined;
      const recording = recorder.finish({ ...end, ...(next ? { next } : {}) }, final);
      firstRecording ??= recording;
      const segmentEnd: PlaytestSegment["end"] = { result: end.result, tick: end.tick };
      if (next) segmentEnd.to = next.scene;
      if (next?.entry !== undefined) segmentEnd.entry = next.entry;
      segments.push({ scene: seg.id, ticks: end.ticks, recording, end: segmentEnd });
      base.slots += end.slots;
      base.ticks += end.ticks;

      if (request && flow) {
        const following = followRequest(request, flow, prepare);
        if (!following.ok) return blockedRun("run", segName, [...issues, following.issue]);
        issues.push(...following.prepared.issues);
        if (request.persist !== undefined) persist.set(request.persist);
        current = {
          id: request.to,
          def: following.def,
          prefabs: following.prefabs,
          ...(opts.library ? { library: opts.library } : {}),
          entry: request.entry ?? null,
          play: nextScenePlay(script.play),
          prepared: following.prepared,
        };
        continue;
      }

      if (last) opts.onLastTick?.(last);
      opts.onEnd?.(runtime);
      const legal = legalCommands(game?.play, last ?? startState(runtime));
      const focus = game?.play?.focus && final !== null ? game.play.focus(final) : null;
      const outcome: PlaytestReport<S>["outcome"] = {
        result: end.result,
        tick: base.ticks - 1,
        at: focus ? { x: focus.x, y: focus.y } : null,
      };
      if (end.cause !== undefined) outcome.cause = end.cause;
      if (end.entityId !== undefined) outcome.entityId = end.entityId;
      if (request) outcome.to = request.to;
      const steps = source.log();
      const { actions, commands: commandNames, inputs: seatStreams, system } = firstRecording;

      const report: PlaytestReport<S> = {
        blocked: false,
        scene: name,
        sceneHash: first.hash,
        configHash: probeConfigHash(game, time),
        tickRate: time.rate,
        outcome,
        ticks: base.ticks,
        slots: base.slots,
        events,
        truncated: eventsTruncated,
        trail: { every: TRAIL_EVERY, pts, truncated: trailTruncated },
        stepsReached: steps.length,
        steps,
        final,
        ...legal,
        inputs,
        stream: structuredClone({ actions, commands: commandNames, inputs: seatStreams, system }),
        commands,
        issues,
        recording: firstRecording,
      };
      if (flow) report.segments = segments;
      return report;
    } finally {
      runtime.destroy();
    }
  }
}

/**
 * The scene a followed request loads, judged as a `go` by `flowIssue`
 * (unlisted or a sublevel is `scene-unlisted`; a listed scene the library
 * holds nothing for is `asset-missing`) and prepared as Play prepares one
 * (its errors refuse it).
 */
function followRequest(
  request: FlowRequest,
  flow: SceneLibrary,
  prepare: (def: SceneDefinition, prefabs?: PrefabLibrary) => PreparedRun,
):
  | {
      ok: true;
      def: SceneDefinition;
      prefabs: PrefabLibrary;
      prepared: Extract<PreparedRun, { ok: true }>;
    }
  | { ok: false; issue: SceneIssue } {
  const refused = flowIssue(flow.list, request.to, "go");
  if (refused) return { ok: false, issue: refused };
  const listed = flow.scenes.get(request.to);
  if (!listed)
    return {
      ok: false,
      issue: makeIssue("asset-missing", {
        message: `"${request.to}" is in the scene list, but the run holds no scene for it`,
        entityIds: [request.to],
      }),
    };
  const prepared = prepare(listed.def, listed.prefabs);
  if (!prepared.ok) {
    const error = prepared.blocked.issues.find((i) => i.severity === "error");
    return {
      ok: false,
      issue: error
        ? { ...error, message: `"${request.to}": ${error.message}` }
        : makeIssue("schema", {
            message: `"${request.to}" can't be played`,
            entityIds: [request.to],
          }),
    };
  }
  return { ok: true, def: listed.def, prefabs: listed.prefabs, prepared };
}
