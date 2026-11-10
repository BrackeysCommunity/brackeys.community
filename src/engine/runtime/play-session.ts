import {
  ENGINE_RUN_RESULTS,
  type GameCommand,
  type GameOutcome,
  type Registry,
} from "../game/types";
import type { InputEdge } from "../headless/playtest-types";
import { deepFreeze } from "../project/canonical";
import { expandScene } from "../scene/expand";
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
  gameTime,
  inputAction,
  recordingCommands,
  recordingEdges,
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
      hash: SceneHash;
      /** Warnings and info; they don't block. */
      issues: SceneIssue[];
    }
  | { ok: false; issues: SceneIssue[] };

/**
 * The first half of Play, shared by the shell, `runPlaytest` and `fuzz`:
 * parse and validate the document (any error blocks and is returned), clone
 * it so nothing played can reach the document, expand it with its prefabs
 * for a fresh runtime, and in dev freeze both, so a system that writes to
 * its definition throws. The hash covers the prefabs the scene uses, so a
 * recording goes stale when one of them changes.
 */
export function preparePlay(
  doc: SceneDefinition,
  registry: Registry,
  opts: {
    dev?: boolean;
    prefabs?: PrefabLibrary;
    /** The project's `engine` block, which settings resolve through. */
    engine?: Readonly<Record<string, unknown>>;
  } = {},
): PreparedPlay {
  const parsed = parseScene(structuredClone(doc), registry);
  if (!parsed.ok) return { ok: false, issues: parsed.issues };
  const def = parsed.def;
  const { prefabs, engine } = opts;
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
  if (opts.dev) {
    deepFreeze(def);
    deepFreeze(scene);
  }
  return { ok: true, def, scene, hash: sceneHashWith(def, prefabs), issues };
}

// ─── Recording a browser session ─────────────────────────

export type SessionRecordingOptions = RecorderOptions & {
  /** Play this recording's edges and commands instead of the keyboard's and the host's, and end where it ended. */
  replay?: RunRecording;
};

/** Records one Play to Stop in the browser, or replays a recording into it. */
export type SessionRecording = {
  /** What to step on `tick`: the replay's edges while replaying, else what the keyboard gave. */
  actions(tick: number, polled: InputAction[]): InputAction[];
  /**
   * The commands to step on `tick`: the replay's while replaying (what the
   * host queued is dropped), else what the host queued.
   */
  commands(tick: number, queued: readonly GameCommand[]): readonly GameCommand[];
  /**
   * After each step, with the game's first verdict when this tick produced
   * it. Returns the recording when this tick finished it: the verdict, or a
   * replay's last tick.
   */
  stepped(
    result: StepResult,
    actions: readonly InputAction[],
    verdict: GameOutcome | null,
    commands?: readonly GameCommand[],
  ): RunRecording | null;
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
  const fed = replay ? recordingEdges(replay) : null;
  const fedCommands = replay ? recordingCommands(replay) : null;
  let done: RunRecording | null = null;
  let last = -1;
  let final: unknown = null;

  function finish(end: RecordingEnd): RunRecording {
    done = recorder.finish(end, final);
    return done;
  }

  return {
    actions(tick, polled) {
      if (!fed || done) return polled;
      return (fed.get(tick) ?? []).map(([t, action, pressed]) =>
        inputAction(action, pressed === 1, t, time),
      );
    },
    commands(tick, queued) {
      if (!fedCommands || done) return queued;
      return fedCommands.get(tick) ?? [];
    },
    stepped(result, actions, verdict, commands) {
      if (done) return null;
      last = result.tick;
      final = result.game;
      const edges: InputEdge[] = actions.map((a) => [result.tick, a.action, a.pressed ? 1 : 0]);
      const focus = play?.focus ? play.focus(result.game) : null;
      recorder.tick(
        { tick: result.tick, snapshot: result.game, events: result.events },
        edges,
        focus,
        commands,
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
