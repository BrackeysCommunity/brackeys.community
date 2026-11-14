import { resolveClips, type ResolvedClip } from "../anim/clips";
import { ANIM } from "../game/behaviors/anim";
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
import { clipSourceIn } from "../project/clip-source";
import { createKindRegistry } from "../project/kinds";
import { ANIMATION_KIND } from "../project/kinds/animation";
import { DATA_TABLE_KIND } from "../project/kinds/data-table";
import { byCodeUnit, isPlainObject } from "../project/kinds/define";
import { GAME_SETTINGS_KIND } from "../project/kinds/game-settings";
import { INPUT_MAP_KIND } from "../project/kinds/input-map";
import { SCENE_LIST_KIND } from "../project/kinds/scene-list";
import type { ProjectRuntimeView } from "../project/runtime-view";
import type { AssetKindName } from "../project/types";
import { expandScene } from "../scene/expand";
import { hashText } from "../scene/hash";
import { parseScene } from "../scene/parse";
import { sceneHashWith } from "../scene/prefab";
import type { RecordedSwap, RunRecording } from "../scene/recording-schema";
import type {
  ExpandedScene,
  Prefab,
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
 * declares in name order, the input map, every other `sim` kind's docs in
 * kind then id order, and the clips `anim` plays: those of every animation
 * doc and of every source an `anim` block in the scene or a prefab names,
 * resolved against their atlases' frames, durations and tags) and every
 * prefab the run's `ctx.instantiate` may place, in id order. The other
 * `sim` docs and the clips each join under a key written only when there
 * is one, so a project without any keeps the hash it had before; `view`
 * kinds and the scene list never join. File text and paths never reach it,
 * so a re-format or a move that leaves the expanded scene equal leaves it
 * equal, while a changed table row, prefab or atlas timing changes it. A
 * doc's `$schema` points at a schema file's location, not at anything the
 * run reads, so moving the schema leaves it equal too.
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
  const docs = view ? simDocs(view, registry) : [];
  const prefabs = [...(library ?? new Map<string, Prefab>())].sort(([a], [b]) => byCodeUnit(a, b));
  const anims = view ? animClips(view, time, [scene.entities, prefabs]) : [];
  const data = view
    ? {
        settings: withoutSchemaPointer(view.settings),
        engine: view.engine,
        tables,
        inputMap: withoutSchemaPointer(view.inputMap),
        ...(docs.length > 0 ? { docs } : {}),
        ...(anims.length > 0 ? { anims } : {}),
      }
    : null;
  return hashText(stableJson({ scene, time, project: data, prefabs }));
}

/** Kinds the run hash reads through their own fields, or (the scene list) not at all. */
function hashedByName(kind: AssetKindName): boolean {
  switch (kind) {
    case GAME_SETTINGS_KIND:
    case DATA_TABLE_KIND:
    case INPUT_MAP_KIND:
    case SCENE_LIST_KIND:
      return true;
    default:
      return false;
  }
}

/** Each other `sim` kind's docs, in registration order, that has any: `[kind, [id, doc][]]` in id order. */
function simDocs(view: ProjectRuntimeView, registry: Registry): [AssetKindName, unknown[]][] {
  if (!view.docs || !view.doc) return [];
  const out: [AssetKindName, unknown[]][] = [];
  for (const def of createKindRegistry(registry.game).list()) {
    if (def.storage !== "doc" || def.runtime !== "sim" || hashedByName(def.kind)) continue;
    const ids = [...view.docs(def.kind)].sort(byCodeUnit);
    if (ids.length === 0) continue;
    out.push([
      def.kind,
      ids.map((id) => [id, withoutSchemaPointer(view.doc!(def.kind, id) ?? null)]),
    ]);
  }
  return out;
}

const ANIM_SOURCE_PATH = `behaviors.${ANIM.name}.source`;

/**
 * Every `anim` source `values` name: an `anim` block's, and an override's,
 * a param map's or a param default's whose path ends at a block's source.
 */
function animSources(values: unknown, out: Set<string>): Set<string> {
  if (Array.isArray(values)) {
    for (const v of values) animSources(v, out);
    return out;
  }
  if (!isPlainObject(values)) return out;
  const block = isPlainObject(values.behaviors) ? values.behaviors[ANIM.name] : undefined;
  if (isPlainObject(block) && typeof block.source === "string") out.add(block.source);
  const targets = Array.isArray(values.targets) ? values.targets : [];
  if (typeof values.default === "string" && targets.some((t) => endsAtSource(t)))
    out.add(values.default);
  for (const [key, value] of Object.entries(values)) {
    if (endsAtSource(key)) {
      if (typeof value === "string") out.add(value);
      else if (isPlainObject(value))
        for (const mapped of Object.values(value)) if (typeof mapped === "string") out.add(mapped);
    }
    animSources(value, out);
  }
  return out;
}

const endsAtSource = (path: unknown) =>
  typeof path === "string" && (path === ANIM_SOURCE_PATH || path.endsWith(`.${ANIM_SOURCE_PATH}`));

/**
 * The clips the `anim` system resolves at the run's rate for every
 * animation doc and every source `content` names, by source in id order:
 * `[source, [name, clip][]]`, empty for a source with no atlas.
 */
function animClips(
  view: ProjectRuntimeView,
  time: ResolvedTime,
  content: unknown,
): [string, [string, ResolvedClip][]][] {
  const sources = animSources(content, new Set(view.docs?.(ANIMATION_KIND) ?? []));
  return [...sources].sort(byCodeUnit).map((id) => {
    const found = clipSourceIn(view, id);
    const clips = found
      ? resolveClips(found.source, found.atlas, time).clips
      : new Map<string, ResolvedClip>();
    return [id, [...clips]];
  });
}

function withoutSchemaPointer<T>(doc: T): T {
  if (doc === null || typeof doc !== "object" || !("$schema" in doc)) return doc;
  const { $schema: _, ...rest } = doc as Record<string, unknown>;
  return rest as T;
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
  /** After a swap was applied between ticks; ignored once the recording finished. */
  swap(entry: RecordedSwap): void;
  /** Finishes it as `quit` unless it already finished; null when it had. */
  stop(): RunRecording | null;
  /** The finished recording, else what `stop()` would give now, without finishing it. */
  soFar(): RunRecording;
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
    swap(entry) {
      if (!done) recorder.swap(entry);
    },
    stop() {
      if (done) return null;
      return finish({ result: "quit", tick: last, ticks: last + 1 });
    },
    soFar() {
      return done ?? recorder.finish({ result: "quit", tick: last, ticks: last + 1 }, final);
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
  ctx: Pick<EngineContext, "exists" | "enabled" | "query" | "get" | "poses" | "grid" | "project">,
): PlayWorld {
  return {
    exists: (id, opts) => (opts?.enabled === false ? ctx.exists(id) : ctx.enabled(id)),
    count: (sel) => ctx.query.count(sel),
    select: (sel) => ctx.query.select(sel),
    get: (id) => ctx.get(id),
    pose: (id) => ctx.poses.get(id),
    get grid() {
      return ctx.grid;
    },
    get project() {
      return ctx.project;
    },
  };
}
