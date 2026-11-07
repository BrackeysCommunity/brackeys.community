/**
 * Records a run as it is stepped, in the browser or headless: every input
 * edge, the focus every few ticks, the game's markers, and how it ended.
 */
import type { GameDefinition, PlayState, RunResult } from "../game/types";
import type { InputEdge, PlayOptions } from "../headless/playtest-types";
import { TICK_RATE } from "../physics";
import { hashText } from "../scene/hash";
import {
  RECORDING_TRAIL_EVERY,
  RECORDING_VERSION,
  type RecordingMarker,
  type RunRecording,
} from "../scene/recording-schema";
import type { Pt, SceneHash } from "../scene/types";
import type { InputAction, RapierModule, Vec2 } from "../types";
import { ENGINE_VERSION } from "../version";

const TICK_MS = 1000 / TICK_RATE;
const DEFAULT_MAX_MARKERS = 1000;
const DEFAULT_MAX_TRAIL = 2000;

const round2 = (v: number) => Math.round(v * 100) / 100;
export const trailPoint = (p: Vec2): Pt => [round2(p.x), round2(p.y)];

/**
 * Hashes what a run's outcome depends on besides the scene, so a report or
 * recording from another engine version or other game tuning can be told apart.
 */
export function probeConfigHash(game?: GameDefinition | null): string {
  return hashText(
    JSON.stringify({
      engine: ENGINE_VERSION,
      tickRate: TICK_RATE,
      game: game?.id ?? null,
      config: game?.configHash ?? null,
    }),
  );
}

/** One input edge as the runtime takes it, stamped at its tick's start. */
export function inputAction(action: string, pressed: boolean, tick: number): InputAction {
  return { action, pressed, tick, timestamp: tick * TICK_MS };
}

/** The physics build a recording names, e.g. `rapier 0.19.3`. */
export function physicsBuild(rapier: RapierModule): string {
  const version = (rapier as { version?: () => string }).version?.();
  return version ? `rapier ${version}` : "rapier";
}

/** A digest of the game's snapshot, which a replay must reproduce. */
export function snapshotDigest(snapshot: unknown): string {
  return hashText(JSON.stringify(snapshot ?? null));
}

export type RecorderOptions = {
  rapier: RapierModule;
  game: GameDefinition | null;
  scene: string;
  sceneHash: SceneHash;
  /** The start as Play was asked for it; a replay casts `at` again the same way. */
  start: PlayOptions;
  maxMarkers?: number;
  maxTrail?: number;
};

export type RecordingEnd = {
  result: RunResult;
  /** The last tick simulated. */
  tick: number;
  /** Ticks simulated. */
  ticks: number;
  cause?: string;
  entityId?: string;
};

export type RunRecorder = {
  /** After each simulated tick, with the edges it stepped, in order. */
  tick(state: PlayState, edges: readonly InputEdge[], focus: Vec2 | null): void;
  /** The recording so far, ended as `end` with the game's snapshot after its last tick. */
  finish(end: RecordingEnd, final: unknown): RunRecording;
};

export function createRunRecorder(opts: RecorderOptions): RunRecorder {
  const { game } = opts;
  const play = game?.play;
  const marks = play?.markers ? new Set(play.markers) : null;
  const maxMarkers = opts.maxMarkers ?? DEFAULT_MAX_MARKERS;
  const maxTrail = opts.maxTrail ?? DEFAULT_MAX_TRAIL;

  const actions: string[] = [];
  const index = new Map<string, number>();
  const inputs: RunRecording["inputs"] = [];
  const markers: RecordingMarker[] = [];
  const pts: Pt[] = [];
  let trailTruncated = false;

  const start: RunRecording["start"] = {};
  if (opts.start.at) start.at = [opts.start.at.x, opts.start.at.y];
  if (opts.start.timeOffsetMs) start.timeOffsetMs = opts.start.timeOffsetMs;
  if (opts.start.game !== undefined) start.game = structuredClone(opts.start.game);

  function actionIndex(name: string): number {
    let i = index.get(name);
    if (i === undefined) {
      i = actions.length;
      actions.push(name);
      index.set(name, i);
    }
    return i;
  }

  return {
    tick(state, edges, focus) {
      for (const [t, action, pressed] of edges) inputs.push([t, actionIndex(action), pressed]);
      for (const e of state.events) {
        if (marks && !marks.has(e.type)) continue;
        if (markers.length >= maxMarkers) break;
        const m: RecordingMarker = { tick: e.tick, type: e.type, at: trailPoint(e.at) };
        if (e.entityId !== undefined) m.entityId = e.entityId;
        if (e.other !== undefined) m.other = e.other;
        markers.push(m);
      }
      if (focus && state.tick % RECORDING_TRAIL_EVERY === 0) {
        if (pts.length < maxTrail) pts.push(trailPoint(focus));
        else trailTruncated = true;
      }
    },
    finish(end, final) {
      const focus = play?.focus && final !== null ? play.focus(final) : null;
      const outcome: RunRecording["outcome"] = {
        result: end.result,
        tick: end.tick,
        at: focus ? trailPoint(focus) : null,
      };
      if (end.cause !== undefined) outcome.cause = end.cause;
      if (end.entityId !== undefined) outcome.entityId = end.entityId;
      const recording: RunRecording = {
        v: RECORDING_VERSION,
        engine: { version: ENGINE_VERSION, physics: physicsBuild(opts.rapier) },
        scene: opts.scene,
        sceneHash: opts.sceneHash,
        game: game?.id ?? null,
        configHash: probeConfigHash(game),
        tickRate: TICK_RATE,
        start: structuredClone(start),
        actions: [...actions],
        inputs: inputs.map((e) => [...e] as (typeof inputs)[number]),
        ticks: end.ticks,
        outcome,
        markers: markers.map((m) => ({ ...m })),
        end: snapshotDigest(final),
      };
      if (play?.focus)
        recording.trail = {
          every: RECORDING_TRAIL_EVERY,
          pts: [...pts],
          truncated: trailTruncated,
        };
      return recording;
    },
  };
}

/** The recording's edges by tick, action names resolved. */
export function recordingEdges(recording: RunRecording): Map<number, InputEdge[]> {
  const byTick = new Map<number, InputEdge[]>();
  for (const [tick, action, pressed] of recording.inputs) {
    const list = byTick.get(tick) ?? [];
    list.push([tick, recording.actions[action]!, pressed]);
    byTick.set(tick, list);
  }
  return byTick;
}
