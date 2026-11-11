import type { ResolvedTime } from "../game/time";
import type { GameDefinition, Registry } from "../game/types";
import type { TickInput } from "../input/stream";
import type { ProjectRuntimeView } from "../project/runtime-view";
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
import { resolveGame } from "../runtime/runtime";
import { checkCommand } from "../scene/input-script";
import { makeIssue } from "../scene/issues";
import {
  parseRecording,
  type RecordingPlatform,
  type RunRecording,
} from "../scene/recording-schema";
import type { PrefabLibrary, SceneDefinition, SceneIssue } from "../scene/types";
import type { RapierModule } from "../types";
import { ENGINE_VERSION } from "../version";
import { unknownActionError } from "./headless";
import {
  blockedRun,
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
};

export type ReplayReport<S = unknown> = {
  blocked: false;
  /**
   * What the run runs differs from what the recording ran (`runHash`; for a
   * recording migrated from v1, which has none, the scene's hash), so the
   * replay may not end the same way.
   */
  stale: boolean;
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
 * Replays a recording headless: the play world starts as it did (its start
 * and seed) and every recorded tick's input, read by `decodeStreams`, is
 * stepped on its tick, every tick simulated whatever the time model. The run
 * ends where the recording did (its outcome, or its last tick), so a
 * deterministic replay matches it exactly. A recording of an earlier format
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

  const library = runLibrary(opts);
  const prepared = prepareRun(opts.scene, registry, opts.dev, opts.prefabs, opts.project?.engine, {
    project: opts.project,
    library,
  });
  if (!prepared.ok) return prepared.blocked;
  const started = startRun({
    rapier: opts.rapier,
    game,
    registry,
    scene: prepared.scene,
    play,
    dev: opts.dev,
    project: opts.project,
    prefabs: library,
  });
  if (!started.ok) return blockedRun("load", name, prepared.issues, [], started.load);
  const { runtime } = started;
  const rapier = recordingRapier(prepared.scene, opts.rapier);
  const time = runtime.ctx.time;

  try {
    let fed: Map<number, TickInput>;
    try {
      fed = recordingTicks(rec, time, game);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return blockedRun("script", name, [], [scriptIssue("/inputs", message)]);
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
      scene: name,
      sceneHash: prepared.hash,
      runHash: prepared.runHash,
      start: play,
      time,
      players: runtime.ctx.input.players(),
      platform: opts.platform,
      projectRef: opts.projectRef,
    });
    let end: ReturnType<typeof runLoop>;
    try {
      end = runLoop({
        runtime,
        game,
        maxTicks: rec.ticks,
        input,
        stuck: rec.outcome.result === "stuck",
        everySlot: true,
        onTick: (state, focus, _edges, _commands, stepped) => recorder.tick(state, stepped, focus),
      });
    } catch (err) {
      const blocked = runBlocked(err, name, prepared.issues, registry);
      if (blocked) return blocked;
      throw err;
    }
    if (end.result === "script-end" && rec.outcome.result === "quit") end.result = "quit";
    const final = runtime.snapshot() as S | null;
    const recording = recorder.finish(end, final);
    const divergence = recordingDivergence(rec, recording);
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
      stale: stale !== null,
      warnings: replayWarnings(rec, name, stale, game, rapier, time),
      issues: platformIssues(rec, platform),
      matches: divergence === null,
      divergence,
      recording,
      final,
    };
    if (parsed.migratedFrom !== undefined) report.migratedFrom = parsed.migratedFrom;
    return report;
  } finally {
    runtime.destroy();
  }
}
