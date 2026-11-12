import type { FlowRequest } from "../game/flow";
import { resolveTime, type ResolvedTime } from "../game/time";
import {
  ENGINE_RUN_RESULTS,
  type EngineContext,
  type GameCommand,
  type GameOutcome,
  type PlayWorld,
  type Registry,
} from "../game/types";
import type { TickInput } from "../input/stream";
import { deepFreeze, stableJson } from "../project/canonical";
import { byCodeUnit } from "../project/kinds/define";
import type { ProjectRuntimeView } from "../project/runtime-view";
import { expandScene } from "../scene/expand";
import { hashText } from "../scene/hash";
import { parseScene } from "../scene/parse";
import { sceneHashWith } from "../scene/prefab";
import type { RunRecording } from "../scene/recording-schema";
import type {
  ExpandedScene,
  PrefabLibrary,
  SceneDefinition,
  SceneHash,
  SceneIssue,
} from "../scene/types";
import { validateScene } from "../scene/validate";
import type { InputAction } from "../types";
import {
  createRunRecorder,
  emptyTick,
  gameTime,
  recordingTicks,
  type RecorderOptions,
  type RecordingEnd,
} from "./recorder";
import type { StepResult } from "./types";

export type PreparedPlay =
  | {
      ok: true;
      /** A clone of the document, deep-frozen when `dev`. */
      def: SceneDefinition;
      /** What the systems spawn from; deep-frozen with `def` when `dev`. */
      scene: ExpandedScene;
      /** The document's hash with the prefabs it uses: what a recording shows. */
      hash: SceneHash;
      /** `runHash` of what this run runs: what a replay's staleness is judged on. */
      runHash: string;
      /** Warnings and info; they don't block. */
      issues: SceneIssue[];
    }
  | { ok: false; issues: SceneIssue[] };

/**
 * What a run ran, hashed: the expanded scene, the resolved clock, the
 * project view's data (its settings, engine block, the tables the game
 * declares in name order, and the input map) and every prefab the run's
 * `ctx.instantiate` may place, in id order. File text never reaches it, so
 * a re-format that leaves the expanded scene equal leaves it equal, while a
 * changed table row or prefab changes it.
 */
export function runHash(
  scene: ExpandedScene,
  time: ResolvedTime,
  registry: Registry,
  project?: ProjectRuntimeView | null,
  library?: PrefabLibrary,
): string {
  const view = project ?? null;
  const tables = Object.keys(registry.game?.tables ?? {})
    .sort(byCodeUnit)
    .map((name) => [name, view ? view.table(name) : []]);
  const data = view
    ? { settings: view.settings, engine: view.engine, tables, inputMap: view.inputMap }
    : null;
  const prefabs = [...(library ?? new Map())].sort(([a], [b]) => byCodeUnit(a, b));
  return hashText(stableJson({ scene, time, project: data, prefabs }));
}

/**
 * The first half of Play, shared by the shell, `runPlaytest` and `fuzz`:
 * parse and validate the document (any error blocks and is returned), clone
 * it so nothing played can reach the document, expand it with its prefabs
 * for a fresh runtime, and in dev freeze both, so a system that writes to
 * its definition throws. `hash` covers the prefabs the scene uses; `runHash`
 * covers what the run runs, computed once here.
 */
export function preparePlay(
  doc: SceneDefinition,
  registry: Registry,
  opts: {
    dev?: boolean;
    prefabs?: PrefabLibrary;
    /** Every prefab the run's `ctx.instantiate` may place; default `prefabs`. */
    library?: PrefabLibrary;
    /** The project's data the run reads; its `engine` block resolves the settings and the clock. */
    project?: ProjectRuntimeView | null;
    /** The project's `engine` block, when there is no `project`. */
    engine?: Readonly<Record<string, unknown>>;
  } = {},
): PreparedPlay {
  const parsed = parseScene(structuredClone(doc), registry);
  if (!parsed.ok) return { ok: false, issues: parsed.issues };
  const def = parsed.def;
  const { prefabs } = opts;
  const engine = opts.project?.engine ?? opts.engine;
  const issues = validateScene(def, registry, { prefabs, engine });
  if (issues.some((i) => i.severity === "error")) return { ok: false, issues };
  let scene: ExpandedScene;
  try {
    scene = expandScene(def, registry, { prefabs, engine });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      issues: [{ severity: "error", code: "schema", message, entityIds: [] }, ...issues],
    };
  }
  const time = resolveTime({ project: engine, game: registry.time });
  const run = runHash(scene, time, registry, opts.project, opts.library ?? prefabs);
  if (opts.dev) {
    deepFreeze(def);
    deepFreeze(scene);
  }
  return { ok: true, def, scene, hash: sceneHashWith(def, prefabs), runHash: run, issues };
}

// ─── Recording a browser session ─────────────────────────

export type SessionRecordingOptions = RecorderOptions & {
  /** Play this recording's input instead of the devices' and the host's, and end where it ended. */
  replay?: RunRecording;
  /** The session's live world, `playWorld(runtime.ctx)`, which every tick's `PlayState` carries. */
  world: PlayWorld;
};

/** Records one Play to Stop in the browser, or replays a recording into it. */
export type SessionRecording = {
  /**
   * What to step on `tick`: the replay's input while replaying (its
   * actions, pointers, seat changes and commands; what the devices and the
   * host gave is dropped), else `live`.
   */
  input(tick: number, live: TickInput): TickInput;
  /** @deprecated `input(tick, live).actions`. */
  actions(tick: number, polled: InputAction[]): InputAction[];
  /** @deprecated `input(tick, live).commands`. */
  commands(tick: number, queued: readonly GameCommand[]): readonly GameCommand[];
  /**
   * After each step, with the input it stepped and the game's first verdict
   * when this tick produced it. Returns the recording when this tick
   * finished it: the verdict, or a replay's last tick. 0.x's action array
   * (with `commands`) is recorded as seat 0's input.
   */
  stepped(
    result: StepResult,
    input: TickInput | readonly InputAction[],
    verdict: GameOutcome | null,
    commands?: readonly GameCommand[],
  ): RunRecording | null;
  /**
   * After the tick that made `req`: the editor's Play doesn't change scene,
   * so the request finishes it as `flow`, written with `next`. Null when it
   * had already finished.
   */
  requested(req: Pick<FlowRequest, "to" | "entry">): RunRecording | null;
  /** Finishes it as `quit` unless it already finished; null when it had. */
  stop(): RunRecording | null;
  /** The finished recording, once there is one. */
  readonly done: RunRecording | null;
  /** True while a replay still has ticks to play. */
  readonly replaying: boolean;
};

export function createSessionRecording(opts: SessionRecordingOptions): SessionRecording {
  const recorder = createRunRecorder(opts);
  const time = opts.time ?? gameTime(opts.game);
  const play = opts.game?.play;
  const replay = opts.replay ?? null;
  const { world } = opts;
  const fed = replay ? recordingTicks(replay, time, opts.game) : null;
  let done: RunRecording | null = null;
  let last = -1;
  let final: unknown = null;

  function finish(end: RecordingEnd): RunRecording {
    done = recorder.finish(end, final);
    return done;
  }

  function input(tick: number, live: TickInput): TickInput {
    if (!fed || done) return live;
    const recorded = fed.get(tick);
    return recorded ? structuredClone(recorded) : emptyTick(tick);
  }

  return {
    input,
    actions(tick, polled) {
      if (!fed || done) return polled;
      return input(tick, emptyTick(tick)).actions;
    },
    commands(tick, queued) {
      if (!fed || done) return queued;
      return input(tick, emptyTick(tick)).commands;
    },
    stepped(result, stepped, verdict, commands) {
      if (done) return null;
      last = result.tick;
      final = result.game;
      const tickInput: TickInput = Array.isArray(stepped)
        ? { ...emptyTick(result.tick), actions: [...stepped], commands: [...(commands ?? [])] }
        : (stepped as TickInput);
      const focus = play?.focus ? play.focus(result.game) : null;
      recorder.tick(
        { tick: result.tick, snapshot: result.game, events: result.events, world },
        tickInput,
        focus,
      );
      const ticks = result.tick + 1;
      if (verdict) {
        const end: RecordingEnd = { result: verdict.result, tick: result.tick, ticks };
        if (verdict.cause !== undefined) end.cause = verdict.cause;
        if (verdict.entityId !== undefined) end.entityId = verdict.entityId;
        return finish(end);
      }
      if (replay && ticks >= replay.ticks) {
        // The game's own result only counts when the game decides it again.
        const engineEnd = (ENGINE_RUN_RESULTS as readonly string[]).includes(replay.outcome.result);
        return finish({
          result: engineEnd ? replay.outcome.result : "timeout",
          tick: result.tick,
          ticks,
        });
      }
      return null;
    },
    requested(req) {
      if (done) return null;
      const next = { scene: req.to, ...(req.entry !== undefined ? { entry: req.entry } : {}) };
      return finish({ result: "flow", tick: last, ticks: last + 1, next });
    },
    stop() {
      if (done) return null;
      return finish({ result: "quit", tick: last, ticks: last + 1 });
    },
    get done() {
      return done;
    },
    get replaying() {
      return replay !== null && done === null;
    },
  };
}

/**
 * What `PlayState.world` answers, read live from `ctx`: an entity exists
 * while it is enabled unless asked with `enabled: false`, counts and
 * selections go through the query index, and the grid and project are
 * whatever `ctx` holds at the time of the read.
 */
export function playWorld(
  ctx: Pick<EngineContext, "exists" | "enabled" | "query" | "get" | "grid" | "project">,
): PlayWorld {
  return {
    exists: (id, opts) => (opts?.enabled === false ? ctx.exists(id) : ctx.enabled(id)),
    count: (sel) => ctx.query.count(sel),
    select: (sel) => ctx.query.select(sel),
    get: (id) => ctx.get(id),
    get grid() {
      return ctx.grid;
    },
    get project() {
      return ctx.project;
    },
  };
}
