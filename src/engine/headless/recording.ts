import type { GameDefinition, Registry } from "../game/types";
import {
  createRunRecorder,
  physicsBuild,
  probeConfigHash,
  recordingEdges,
} from "../runtime/recorder";
import { resolveGame } from "../runtime/runtime";
import { parseRecording, type RunRecording } from "../scene/recording-schema";
import type { PrefabLibrary, SceneDefinition } from "../scene/types";
import type { RapierModule } from "../types";
import { ENGINE_VERSION } from "../version";
import { unknownActionError } from "./headless";
import { blockedRun, prepareRun, runLoop, startRun, type InputSource } from "./play-loop";
import type { PlaytestBlocked, PlayOptions, ScriptIssue } from "./playtest-types";

export type ReplayOptions<S = unknown> = {
  rapier: RapierModule;
  game?: GameDefinition<S> | null;
  registry?: Registry;
  /** Validated, hashed and expanded the way Play does. */
  scene: SceneDefinition;
  /** The prefabs the scene's instances name. */
  prefabs?: PrefabLibrary;
  /** A recording, or its JSON (text or parsed), checked by `parseRecording`. */
  recording: RunRecording | unknown;
  dev?: boolean;
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
  rapier: RapierModule,
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
  if (recording.engine.version !== ENGINE_VERSION)
    out.push(`recorded on engine ${recording.engine.version}, replayed on ${ENGINE_VERSION}`);
  else if (recording.configHash !== probeConfigHash(game))
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
 * recorded edge is stepped on its tick, in order. The run ends where the
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
  if (actionIssues.length > 0) return blockedRun("script", name, [], actionIssues);

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

  const prepared = prepareRun(opts.scene, registry, opts.dev, opts.prefabs);
  if (!prepared.ok) return prepared.blocked;
  const started = startRun({
    rapier: opts.rapier,
    game,
    registry,
    scene: prepared.scene,
    play,
    dev: opts.dev,
  });
  if (!started.ok) return blockedRun("load", name, prepared.issues, [], started.load);
  const { runtime } = started;

  try {
    const byTick = recordingEdges(rec);
    const inputEnds = rec.outcome.result === "quit" || rec.outcome.result === "script-end";
    const input: InputSource = {
      done: () => false,
      edges: (tick) => byTick.get(tick) ?? [],
    };
    if (inputEnds) {
      let next = 0;
      input.done = () => next >= rec.ticks;
      input.after = () => void next++;
    }
    const recorder = createRunRecorder({
      rapier: opts.rapier,
      game,
      scene: name,
      sceneHash: prepared.hash,
      start: play,
    });
    const end = runLoop({
      runtime,
      game,
      maxTicks: rec.ticks,
      input,
      stuck: rec.outcome.result === "stuck",
      onTick: (state, focus, edges) => recorder.tick(state, edges, focus),
    });
    if (end.result === "script-end" && rec.outcome.result === "quit") end.result = "quit";
    const final = runtime.snapshot() as S | null;
    const recording = recorder.finish(end, final);
    const divergence = recordingDivergence(rec, recording);
    return {
      blocked: false,
      stale: rec.sceneHash !== prepared.hash,
      warnings: replayWarnings(rec, name, prepared.hash, game, opts.rapier),
      matches: divergence === null,
      divergence,
      recording,
      final,
    };
  } finally {
    runtime.destroy();
  }
}
