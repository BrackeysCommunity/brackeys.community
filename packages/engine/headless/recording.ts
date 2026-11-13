import type { SceneLibrary } from "../game/flow";
import { parseSaveFile, type SaveFile } from "../game/save-file";
import type { ResolvedTime } from "../game/time";
import { EngineError, type GameDefinition, type Registry } from "../game/types";
import type { TickInput } from "../input/stream";
import type { ProjectRuntimeView } from "../project/runtime-view";
import type { AssetId, Sha256 } from "../project/types";
import type { FlowIdentity } from "../runtime/flow";
import {
  createSwapReplay,
  preparedVersion,
  recordedVersion,
  recordLiveSwaps,
  stageIssue,
  type PreparedVersion,
} from "../runtime/live";
import { gamePersistCell } from "../runtime/persist";
import {
  createRunRecorder,
  hostPlatform,
  physicsBuild,
  probeConfigHash,
  recordingRapier,
  recordingStart,
  recordingTicks,
  emptyTick,
  REPLAY_ACROSS_PLATFORMS,
  type RecordingHost,
} from "../runtime/recorder";
import { resolveGame, saveHostOf } from "../runtime/runtime";
import type { SceneRuntimeHandle } from "../runtime/types";
import { checkCommand } from "../scene/input-script";
import { errorText, leadIssue, makeIssue } from "../scene/issues";
import {
  parseRecording,
  type RecordingPlatform,
  type RunRecording,
} from "../scene/recording-schema";
import type { PrefabLibrary, SceneDefinition, SceneIssue } from "../scene/types";
import type { RapierModule, StagedVersion } from "../types";
import { ENGINE_VERSION } from "../version";
import { unknownActionError } from "./headless";
import {
  blockedRun,
  listedSceneId,
  prepareRun,
  runBlocked,
  runLibrary,
  runLoop,
  startRun,
  type InputSource,
} from "./play-loop";
import type { PlaytestBlocked, ScriptIssue } from "./playtest-types";

export type ReplayOptions<S = unknown> = RecordingHost & {
  /** Needed only for a scene whose physics resolves to Rapier. */
  rapier?: RapierModule | null;
  game?: GameDefinition<S> | null;
  registry?: Registry;
  /** Validated, hashed and expanded the way Play does. */
  scene: SceneDefinition;
  /** The prefabs the scene's instances name. */
  prefabs?: PrefabLibrary;
  /** Every prefab `ctx.instantiate` may place, as `loadHeadless` returns it; default `prefabs`. */
  library?: PrefabLibrary;
  /** A `RunRecording` in any format version, or its JSON (text or parsed), read by `parseRecording`. */
  recording: unknown;
  dev?: boolean;
  /** The project's data the game reads as `EngineContext.project`; its `engine` block resolves the scene's settings and the clock. */
  project?: ProjectRuntimeView | null;
  /** The listed scenes the recorded run had, which the replay keeps for `ctx.flow`; it never follows a request. */
  flow?: SceneLibrary;
  /** The scene's listed id (`ctx.flow.scene`); default the library's id for it, else its name. */
  sceneId?: AssetId;
  /**
   * Save fixtures by the hash of their bytes, as files or parsed: a
   * recording that began from a save (`fromSave`) replays from the one
   * with its hash, and without it is blocked with `asset-missing`.
   */
  saves?: ReadonlyMap<Sha256, SaveFile | string>;
  /**
   * The scene versions the recording names, by id (a host holding several
   * looks one up with `findSceneVersion`); null for one it doesn't have. A
   * recording that starts on a version it can't find doesn't replay, and a
   * swap to one stops the replay at its tick, both with
   * `scene-version-removed`.
   */
  versions?: (id: Sha256) => StagedVersion | null;
};

/**
 * The save a recording began from, found by its hash in `saves`: null for
 * a recording that began at the scene's load; `asset-missing` (detail
 * `kind: "save"`) when no fixture has the hash; the save's own issues when
 * its text doesn't parse for `game`.
 */
function recordedSave(
  rec: RunRecording,
  saves: ReplayOptions["saves"],
  registry: Registry,
): { ok: true; file: SaveFile | null } | { ok: false; issues: SceneIssue[] } {
  const from = rec.fromSave;
  if (!from) return { ok: true, file: null };
  const given = saves?.get(from.sha256);
  if (given === undefined) {
    return {
      ok: false,
      issues: [
        makeIssue("asset-missing", {
          message: `the recording began from the save in slot "${from.slot}" (sha256 ${from.sha256}), and no save fixture with that hash was given`,
          hint: "Replay it beside the .save.json fixture it was played from, or play the script again from a fixture you have.",
          path: "/fromSave/sha256",
          got: from.sha256,
          detail: { kind: "save", slot: from.slot, sha256: from.sha256 },
        }),
      ],
    };
  }
  if (typeof given !== "string") return { ok: true, file: given };
  const parsed = parseSaveFile(given, registry.game ?? undefined);
  return parsed.ok ? { ok: true, file: parsed.file } : { ok: false, issues: parsed.issues };
}

const EMPTY_LIBRARY: SceneLibrary = Object.freeze({ list: [], scenes: new Map() });

/**
 * The flow identity a replay loads its scene with, so the game reads the
 * same `ctx.flow` as the recorded run: whenever the replay names a library
 * or an id, or the recording is one scene of a run that followed flow.
 */
function replayIdentity(
  opts: Pick<ReplayOptions, "flow" | "sceneId" | "scene">,
  rec: RunRecording,
): FlowIdentity | undefined {
  const flowed = rec.start.entry !== undefined || rec.next !== undefined;
  if (!opts.flow && opts.sceneId === undefined && !flowed) return undefined;
  const library = opts.flow ?? EMPTY_LIBRARY;
  return {
    scene: opts.sceneId ?? listedSceneId(library, opts.scene) ?? opts.scene.name,
    entry: rec.start.entry ?? null,
    library,
  };
}

export type ReplayReport<S = unknown> = {
  blocked: false;
  /**
   * What the run runs differs from what the recording ran (`runHash`; for a
   * recording migrated from v1, which has none, the scene's hash), so the
   * replay may not end the same way. Judged per part of the run: the start
   * against the start, and each swap against what the replayed swap made.
   */
  stale: boolean;
  /** The tick of the first swap the replay made differently (strategy, run hash, or not at all), from which it is stale. */
  staleFrom?: number;
  /** Why this replay may differ: a stale run, other tuning, another engine version or physics build. */
  warnings: string[];
  /** Coded warnings beside `warnings`: `recording-other-platform`. */
  issues: SceneIssue[];
  /** The format version the recording was migrated from, when it was. */
  migratedFrom?: 1;
  /** Same result, tick and end digest as the recording. */
  matches: boolean;
  /** How it differs from the recording, when it doesn't match. */
  divergence: string | null;
  /** The replay, recorded again. */
  recording: RunRecording;
  /** The game's snapshot after the last tick; `null` without a game. */
  final: S | null;
};

export type ReplayRun<S = unknown> = ReplayReport<S> | PlaytestBlocked;

const scriptIssue = (path: string, message: string): ScriptIssue => ({ path, message });

const physicsName = (physics: string | null): string => physics ?? "none";

/** Why a replay of `recording` may not reproduce it here. */
function replayWarnings(
  recording: RunRecording,
  scene: string,
  stale: string | null,
  game: GameDefinition | null,
  rapier: RapierModule | null,
  time: ResolvedTime,
): string[] {
  const out: string[] = [];
  if (recording.scene !== scene)
    out.push(
      `the recording is of scene ${JSON.stringify(recording.scene)}, not ${JSON.stringify(scene)}`,
    );
  if (stale) out.push(stale);
  if (recording.game !== (game?.id ?? null))
    out.push(
      `the recording is of game ${JSON.stringify(recording.game)}, not ${JSON.stringify(game?.id ?? null)}`,
    );
  const sameEngine = recording.engine.version === ENGINE_VERSION;
  if (!sameEngine)
    out.push(`recorded on engine ${recording.engine.version}, replayed on ${ENGINE_VERSION}`);
  if (recording.time.rate !== time.rate)
    out.push(`recorded at ${recording.time.rate} ticks a second, replayed at ${time.rate}`);
  else if (sameEngine && recording.configHash !== probeConfigHash(game, time))
    out.push("the game's tuning changed since it was recorded (config hash differs)");
  if (recording.time.kind !== time.kind)
    out.push(`recorded on a ${recording.time.kind} clock, replayed on a ${time.kind} one`);
  const physics = physicsBuild(rapier);
  if (physicsName(recording.engine.physics) !== physics)
    out.push(`recorded on ${physicsName(recording.engine.physics)}, replayed on ${physics}`);
  return out;
}

/**
 * `recording-other-platform` when a Rapier recording made on a known
 * architecture is replayed on another, unless `acrossPlatforms`
 * (`REPLAY_ACROSS_PLATFORMS`) says Rapier replays identically across them.
 * An `unknown` architecture on either side never warns.
 */
export function platformIssues(
  recording: Pick<RunRecording, "engine" | "platform">,
  here: Pick<RecordingPlatform, "arch">,
  acrossPlatforms: boolean = REPLAY_ACROSS_PLATFORMS,
): SceneIssue[] {
  const physics = recording.engine.physics;
  if (acrossPlatforms || physics === null || physics === "none") return [];
  const { arch } = recording.platform;
  if (arch === "unknown" || here.arch === "unknown" || arch === here.arch) return [];
  return [
    makeIssue("recording-other-platform", {
      message: `recorded on ${arch} with ${recording.engine.physics}, replayed on ${here.arch}: Rapier may step differently on another architecture`,
    }),
  ];
}

/** The first way `b` differs from `a`, or null when it ends the same way. */
export function recordingDivergence(a: RunRecording, b: RunRecording): string | null {
  if (a.outcome.result !== b.outcome.result)
    return `ended as ${b.outcome.result}, not ${a.outcome.result}`;
  if (a.ticks !== b.ticks) return `ran ${b.ticks} ticks, not ${a.ticks}`;
  if (a.end !== b.end) return `the game's end state differs (digest ${b.end}, recorded ${a.end})`;
  const to = (r: RunRecording) => r.next?.scene ?? null;
  if (to(a) !== to(b))
    return to(b) === null
      ? `requested no scene, not "${to(a)}"`
      : `requested "${to(b)}", not ${to(a) === null ? "none" : `"${to(a)}"`}`;
  return null;
}

/** The recording's commands the game doesn't know or whose args don't parse, by where they sit. */
function commandIssues(registry: Registry, rec: RunRecording): ScriptIssue[] {
  const out: ScriptIssue[] = [];
  rec.inputs.forEach((stream, seat) =>
    stream.forEach((event, i) => {
      if (event[1] !== "c") return;
      const name = rec.commands[event[2]];
      if (name === undefined) {
        out.push(
          scriptIssue(
            `/inputs/${seat}/${i}/2`,
            `command index ${event[2]} is outside \`commands\``,
          ),
        );
        return;
      }
      const checked = checkCommand(registry, { name, args: event[3] });
      if (!checked.ok)
        out.push(
          scriptIssue(`/inputs/${seat}/${i}/${checked.at === "name" ? 2 : 3}`, checked.message),
        );
    }),
  );
  rec.system.forEach((event, i) => {
    if (event[1] !== "w") return;
    const checked = checkCommand(registry, { name: "@elapsed", args: { ms: event[2] } });
    if (!checked.ok) out.push(scriptIssue(`/system/${i}/2`, checked.message));
  });
  return out;
}

/**
 * Replays a recording headless: the play world starts as it did (its start,
 * seed, persistent value and flow entry) and every recorded tick's input,
 * read by `decodeStreams`, is stepped on its tick, every tick simulated
 * whatever the time model. The run ends where the recording did (its
 * outcome, its last tick, or the flow request at its `next`, which it
 * never follows), so a deterministic replay matches it exactly. One that
 * began from a save starts from the fixture `saves` holds under its hash
 * (`recordedSave`). A recording of an earlier format
 * migrates on read; a stale run, other tuning or another platform is a
 * warning, not a block.
 */
export function replayRecording<S = unknown>(opts: ReplayOptions<S>): ReplayRun<S> {
  const { registry, game } = resolveGame({
    game: opts.game as GameDefinition | null | undefined,
    registry: opts.registry,
  });
  const name = opts.scene.name;
  const parsed = parseRecording(opts.recording, registry);
  if (!parsed.ok) {
    return blockedRun(
      "script",
      name,
      [],
      parsed.issues.map((i) => scriptIssue(i.path, i.message)),
    );
  }
  const rec = parsed.recording;
  const actionIssues = rec.actions.flatMap((action, i) => {
    const error = unknownActionError(action, registry.actionNames);
    return error ? [scriptIssue(`/actions/${i}`, error)] : [];
  });
  const refused = [...actionIssues, ...commandIssues(registry, rec)];
  if (refused.length > 0) return blockedRun("script", name, [], refused);

  const play = recordingStart(rec.start, rec.seed);
  if (rec.start.game !== undefined) {
    const options = game?.play?.options;
    const checked = options
      ? options.safeParse(rec.start.game)
      : { success: true, data: rec.start.game };
    if (!checked.success)
      return blockedRun(
        "script",
        name,
        [],
        [scriptIssue("/start/game", "the game's play options don't parse")],
      );
    play.game = checked.data;
  }

  const persist = gamePersistCell(game, true);
  if (rec.start.persist !== undefined) {
    try {
      persist.set(rec.start.persist);
    } catch (err) {
      if (!(err instanceof EngineError)) throw err;
      return blockedRun("script", name, [], [scriptIssue("/start/persist", err.message)]);
    }
  }

  const saved = recordedSave(rec, opts.saves, registry);
  if (!saved.ok) return blockedRun("load", name, saved.issues);

  const engine = opts.project?.engine;
  /** A version the recording names, read for play; `scene-version-removed` at `path` when the host doesn't have it. */
  const resolveVersion = (
    id: Sha256,
    path: string,
    scene: AssetId,
    tick?: number,
  ): { ok: true; prepared: PreparedVersion } | { ok: false; issues: SceneIssue[] } => {
    const found = recordedVersion(opts.versions, scene, id, tick);
    if (found.ok) return preparedVersion(found.staged, registry, game, engine);
    return { ok: false, issues: [{ ...found.issue, path }] };
  };

  let flow = replayIdentity(opts, rec);
  let version: PreparedVersion | undefined;
  if (rec.sceneVersion !== undefined) {
    const found = resolveVersion(rec.sceneVersion, "/sceneVersion", flow?.scene ?? rec.scene);
    if (!found.ok) return blockedRun("load", name, found.issues);
    version = found.prepared;
    flow ??= {
      scene: version.version.scene,
      entry: rec.start.entry ?? null,
      library: opts.flow ?? EMPTY_LIBRARY,
    };
  }
  const runName = version?.def.name ?? name;
  const startId = flow?.scene ?? runName;

  const library = runLibrary(opts) ?? version?.prefabs;
  const prepared = prepareRun(
    version?.def ?? opts.scene,
    registry,
    opts.dev,
    version?.prefabs ?? opts.prefabs,
    engine,
    { project: opts.project, library },
  );
  if (!prepared.ok) return prepared.blocked;

  const swaps = rec.swaps ?? [];
  let staleFrom: number | undefined;
  const swapWarnings: string[] = [];
  let playing: SceneRuntimeHandle | null = null;
  let replaySwaps: ReturnType<typeof createSwapReplay> | null = null;
  const started = startRun({
    rapier: opts.rapier,
    game,
    registry,
    scene: prepared.scene,
    play,
    dev: opts.dev,
    project: opts.project,
    prefabs: library,
    persist,
    ...(flow ? { flow } : {}),
    ...(saved.file ? { fromSave: saved.file } : {}),
    ...(version ? { version } : {}),
    release: (id) =>
      id === startId
        ? { def: opts.scene, prefabs: opts.prefabs ?? new Map() }
        : (opts.flow?.scenes.get(id) ?? null),
    beforeLoad(live) {
      replaySwaps = createSwapReplay({
        live,
        swaps,
        scene: () => (playing && saveHostOf(playing.ctx)?.sceneId()) ?? runName,
        resolve: (id, scene, at, tick) => resolveVersion(id, `/swaps/${at}/version`, scene, tick),
        stale(tick, why) {
          staleFrom ??= tick;
          swapWarnings.push(`stale from tick ${tick}: ${why}`);
        },
      });
      const stop = replaySwaps.atLoad(saved.file?.world?.tick ?? 0);
      if (!stop) return null;
      return leadIssue(stop.issues) ?? stageIssue(stop.scene, "its version didn't read");
    },
  });
  if (!started.ok)
    return blockedRun(
      "load",
      runName,
      started.issue ? [...prepared.issues, started.issue] : prepared.issues,
      [],
      started.load,
    );
  const { runtime, live } = started;
  playing = runtime;
  const rapier = recordingRapier(prepared.scene, opts.rapier);
  const time = runtime.ctx.time;

  try {
    let fed: Map<number, TickInput>;
    try {
      fed = recordingTicks(rec, time, game);
    } catch (err) {
      return blockedRun("script", runName, [], [scriptIssue("/inputs", errorText(err))]);
    }
    const inputEnds = rec.outcome.result === "quit" || rec.outcome.result === "script-end";
    const input: InputSource = {
      done: () => false,
      tick: (slot) => fed.get(slot) ?? emptyTick(slot),
    };
    if (inputEnds) {
      let next = 0;
      input.done = () => next >= rec.ticks;
      input.after = () => void next++;
    }
    const platform = { ...hostPlatform(), ...opts.platform };
    const recorder = createRunRecorder({
      rapier,
      game,
      scene: runName,
      sceneHash: prepared.hash,
      runHash: prepared.runHash,
      start: play,
      ...(rec.start.persist !== undefined ? { persist: rec.start.persist } : {}),
      entry: rec.start.entry ?? null,
      ...(rec.fromSave ? { fromSave: { ...rec.fromSave } } : {}),
      sceneVersion: runtime.ctx.live.version,
      time,
      players: runtime.ctx.input.players(),
      platform: opts.platform,
      projectRef: opts.projectRef,
    });
    // The other listed scenes' live versions, which this load's sublevels attach, as the shell records them.
    live.onApplied(recordLiveSwaps(recorder, live, runtime.ctx.tick));

    let stopped: SceneIssue[] = [];
    /** Applies every swap recorded before the tick about to step, through the live layer as the recorded run did. */
    const beforeTick = (): string | null => {
      const stop = replaySwaps!.before(runtime.ctx.tick);
      if (!stop) return null;
      stopped = stop.issues;
      const first = leadIssue(stop.issues);
      return `the swap at tick ${stop.tick} can't be replayed: ${first?.message ?? "its version didn't read"}`;
    };

    let end: ReturnType<typeof runLoop>;
    try {
      end = runLoop({
        runtime,
        game,
        maxTicks: rec.ticks,
        input,
        stuck: rec.outcome.result === "stuck",
        everySlot: true,
        ...(swaps.length > 0 ? { live: { beforeTick } } : {}),
        onTick: (state, focus, _edges, _commands, stepped) => recorder.tick(state, stepped, focus),
      });
    } catch (err) {
      const blocked = runBlocked(err, runName, prepared.issues, registry);
      if (blocked) return blocked;
      throw err;
    }
    const halted = stopped.length > 0;
    if (!halted && end.result === "script-end" && rec.outcome.result === "quit")
      end.result = "quit";
    const final = runtime.snapshot() as S | null;
    const next = end.request && {
      scene: end.request.to,
      ...(end.request.entry !== undefined ? { entry: end.request.entry } : {}),
    };
    const recording = recorder.finish({ ...end, ...(next ? { next } : {}) }, final);
    const divergence = halted
      ? `stopped before tick ${end.ticks}: ${end.cause}`
      : recordingDivergence(rec, recording);
    const stale =
      parsed.migratedFrom === 1
        ? rec.sceneHash !== prepared.hash
          ? `stale: the scene changed since it was recorded (hash ${rec.sceneHash}, now ${prepared.hash})`
          : null
        : rec.runHash !== prepared.runHash
          ? `stale: what the run runs changed since it was recorded (run hash ${rec.runHash}, now ${prepared.runHash})`
          : null;
    const report: ReplayReport<S> = {
      blocked: false,
      stale: stale !== null || staleFrom !== undefined,
      warnings: [...replayWarnings(rec, runName, stale, game, rapier, time), ...swapWarnings],
      issues: [...platformIssues(rec, platform), ...stopped],
      matches: divergence === null,
      divergence,
      recording,
      final,
    };
    if (staleFrom !== undefined) report.staleFrom = staleFrom;
    if (parsed.migratedFrom !== undefined) report.migratedFrom = parsed.migratedFrom;
    return report;
  } finally {
    runtime.destroy();
  }
}
