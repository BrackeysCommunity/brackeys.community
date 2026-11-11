import type { ResolvedTime } from "../game/time";
import type { GameDefinition, Registry } from "../game/types";
import type { ProjectRuntimeView } from "../project/runtime-view";
import {
  createRunRecorder,
  physicsBuild,
  probeConfigHash,
  recordingCommands,
  recordingEdges,
  recordingRapier,
} from "../runtime/recorder";
import { resolveGame } from "../runtime/runtime";
import { checkCommand } from "../scene/input-script";
import { parseRecording, type RunRecording } from "../scene/recording-schema";
import type { PrefabLibrary, SceneDefinition } from "../scene/types";
import type { RapierModule } from "../types";
import { ENGINE_VERSION } from "../version";
import { unknownActionError } from "./headless";
import { blockedRun, prepareRun, runLoop, startRun, type InputSource } from "./play-loop";
import type { PlaytestBlocked, PlayOptions, ScriptIssue } from "./playtest-types";

export type ReplayOptions<S = unknown> = {
  /** Needed only for a scene whose physics resolves to Rapier. */
  rapier?: RapierModule | null;
  game?: GameDefinition<S> | null;
  registry?: Registry;
  /** Validated, hashed and expanded the way Play does. */
  scene: SceneDefinition;
  /** The prefabs the scene's instances name. */
  prefabs?: PrefabLibrary;
  /** A recording, or its JSON (text or parsed), checked by `parseRecording`. */
  recording: RunRecording | unknown;
  dev?: boolean;
  /** The project's data the game reads as `EngineContext.project`; its `engine` block resolves the scene's settings and the clock. */
  project?: ProjectRuntimeView | null;
};

export type ReplayReport<S = unknown> = {
  blocked: false;
  /** The scene's hash differs from the recording's, so the replay may not end the same way. */
  stale: boolean;
  /** Why this replay may differ: a stale scene, other tuning, another engine version or physics build. */
  warnings: string[];
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

/** Why a replay of `recording` may not reproduce it here. */
function replayWarnings(
  recording: RunRecording,
  scene: string,
  hash: string,
  game: GameDefinition | null,
  rapier: RapierModule | null,
  time: ResolvedTime,
): string[] {
  const out: string[] = [];
  if (recording.scene !== scene)
    out.push(
      `the recording is of scene ${JSON.stringify(recording.scene)}, not ${JSON.stringify(scene)}`,
    );
  if (recording.sceneHash !== hash)
    out.push(
      `stale: the scene changed since it was recorded (hash ${recording.sceneHash}, now ${hash})`,
    );
  if (recording.game !== (game?.id ?? null))
    out.push(
      `the recording is of game ${JSON.stringify(recording.game)}, not ${JSON.stringify(game?.id ?? null)}`,
    );
  const sameEngine = recording.engine.version === ENGINE_VERSION;
  if (!sameEngine)
    out.push(`recorded on engine ${recording.engine.version}, replayed on ${ENGINE_VERSION}`);
  if (recording.tickRate !== time.rate)
    out.push(`recorded at ${recording.tickRate} ticks a second, replayed at ${time.rate}`);
  else if (sameEngine && recording.configHash !== probeConfigHash(game, time))
    out.push("the game's tuning changed since it was recorded (config hash differs)");
  const physics = physicsBuild(rapier);
  if (recording.engine.physics !== physics)
    out.push(`recorded on ${recording.engine.physics}, replayed on ${physics}`);
  return out;
}

/** The first way `b` differs from `a`, or null when it ends the same way. */
export function recordingDivergence(a: RunRecording, b: RunRecording): string | null {
  if (a.outcome.result !== b.outcome.result)
    return `ended as ${b.outcome.result}, not ${a.outcome.result}`;
  if (a.ticks !== b.ticks) return `ran ${b.ticks} ticks, not ${a.ticks}`;
  if (a.end !== b.end) return `the game's end state differs (digest ${b.end}, recorded ${a.end})`;
  return null;
}

/**
 * Replays a recording headless: the play world starts as it did and every
 * recorded edge and command is stepped on its tick, in order, every tick
 * simulated whatever the time model. The run ends where the
 * recording did (its outcome, or its last tick), so a deterministic replay
 * matches it exactly; a stale scene or other tuning is a warning, not a block.
 */
export function replayRecording<S = unknown>(opts: ReplayOptions<S>): ReplayRun<S> {
  const { registry, game } = resolveGame({
    game: opts.game as GameDefinition | null | undefined,
    registry: opts.registry,
  });
  const name = opts.scene.name;
  const parsed = parseRecording(opts.recording);
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
  const commandIssues = (rec.commands ?? []).flatMap(([, command, args], i) => {
    const checked = checkCommand(registry, { name: command, args });
    if (checked.ok) return [];
    return [scriptIssue(`/commands/${i}/${checked.at === "name" ? 1 : 2}`, checked.message)];
  });
  const refused = [...actionIssues, ...commandIssues];
  if (refused.length > 0) return blockedRun("script", name, [], refused);

  const play: PlayOptions = {};
  if (rec.start.at) play.at = { x: rec.start.at[0], y: rec.start.at[1] };
  if (rec.start.timeOffsetMs !== undefined) play.timeOffsetMs = rec.start.timeOffsetMs;
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

  const prepared = prepareRun(opts.scene, registry, opts.dev, opts.prefabs, opts.project?.engine);
  if (!prepared.ok) return prepared.blocked;
  const started = startRun({
    rapier: opts.rapier,
    game,
    registry,
    scene: prepared.scene,
    play,
    dev: opts.dev,
    project: opts.project,
  });
  if (!started.ok) return blockedRun("load", name, prepared.issues, [], started.load);
  const { runtime } = started;
  const rapier = recordingRapier(prepared.scene, opts.rapier);

  try {
    const byTick = recordingEdges(rec);
    const commandsByTick = recordingCommands(rec);
    const inputEnds = rec.outcome.result === "quit" || rec.outcome.result === "script-end";
    const input: InputSource = {
      done: () => false,
      edges: (tick) => byTick.get(tick) ?? [],
      commands: (tick) => commandsByTick.get(tick) ?? [],
    };
    if (inputEnds) {
      let next = 0;
      input.done = () => next >= rec.ticks;
      input.after = () => void next++;
    }
    const recorder = createRunRecorder({
      rapier,
      game,
      scene: name,
      sceneHash: prepared.hash,
      start: play,
      time: runtime.ctx.time,
    });
    const end = runLoop({
      runtime,
      game,
      maxTicks: rec.ticks,
      input,
      stuck: rec.outcome.result === "stuck",
      everySlot: true,
      onTick: (state, focus, edges, commands) => recorder.tick(state, edges, focus, commands),
    });
    if (end.result === "script-end" && rec.outcome.result === "quit") end.result = "quit";
    const final = runtime.snapshot() as S | null;
    const recording = recorder.finish(end, final);
    const divergence = recordingDivergence(rec, recording);
    return {
      blocked: false,
      stale: rec.sceneHash !== prepared.hash,
      warnings: replayWarnings(rec, name, prepared.hash, game, rapier, runtime.ctx.time),
      matches: divergence === null,
      divergence,
      recording,
      final,
    };
  } finally {
    runtime.destroy();
  }
}
