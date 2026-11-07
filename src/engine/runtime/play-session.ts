import { ENGINE_RUN_RESULTS, type GameOutcome, type Registry } from "../game/types";
import type { InputEdge } from "../headless/playtest-types";
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
  inputAction,
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

/** Freezes `value` and everything it holds, so a system that writes to its definition throws. */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

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
  opts: { dev?: boolean; prefabs?: PrefabLibrary } = {},
): PreparedPlay {
  const parsed = parseScene(structuredClone(doc), registry);
  if (!parsed.ok) return { ok: false, issues: parsed.issues };
  const def = parsed.def;
  const { prefabs } = opts;
  const issues = validateScene(def, registry, { prefabs });
  if (issues.some((i) => i.severity === "error")) return { ok: false, issues };
  let scene: ExpandedScene;
  try {
    scene = expandScene(def, registry, { prefabs });
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
  /** Play this recording's edges instead of the keyboard's, and end where it ended. */
  replay?: RunRecording;
};

/** Records one Play to Stop in the browser, or replays a recording into it. */
export type SessionRecording = {
  /** What to step on `tick`: the replay's edges while replaying, else what the keyboard gave. */
  actions(tick: number, polled: InputAction[]): InputAction[];
  /**
   * After each step, with the game's first verdict when this tick produced
   * it. Returns the recording when this tick finished it: the verdict, or a
   * replay's last tick.
   */
  stepped(
    result: StepResult,
    actions: readonly InputAction[],
    verdict: GameOutcome | null,
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
  const play = opts.game?.play;
  const replay = opts.replay ?? null;
  const fed = replay ? recordingEdges(replay) : null;
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
        inputAction(action, pressed === 1, t),
      );
    },
    stepped(result, actions, verdict) {
      if (done) return null;
      last = result.tick;
      final = result.game;
      const edges: InputEdge[] = actions.map((a) => [result.tick, a.action, a.pressed ? 1 : 0]);
      const focus = play?.focus ? play.focus(result.game) : null;
      recorder.tick(
        { tick: result.tick, snapshot: result.game, events: result.events },
        edges,
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
