/**
 * Records a run as it is stepped, in the browser or headless: every input
 * edge and command, the focus every few ticks, the game's markers, and how
 * it ended.
 */
import { resolveTime, type ResolvedTime } from "../game/time";
import type { GameCommand, GameDefinition, PlayState, RunResult } from "../game/types";
import type { InputEdge, PlayOptions } from "../headless/playtest-types";
import { hashText } from "../scene/hash";
import {
  RECORDING_TRAIL_EVERY,
  RECORDING_VERSION,
  type RecordingCommand,
  type RecordingMarker,
  type RunRecording,
} from "../scene/recording-schema";
import type { Pt, ResolvedSettings, SceneHash } from "../scene/types";
import type { InputAction, RapierModule, Vec2 } from "../types";
import { ENGINE_VERSION } from "../version";

const DEFAULT_MAX_MARKERS = 1000;
const DEFAULT_MAX_TRAIL = 2000;

const round2 = (v: number) => Math.round(v * 100) / 100;
export const trailPoint = (p: Vec2): Pt => [round2(p.x), round2(p.y)];

/** The engine default's clock, for an input stamped without a run's. */
const DEFAULT_CLOCK = resolveTime({});

/** The game's own clock, before a project's `engine.tickRate`: what a run without one plays at. */
export function gameTime(game?: GameDefinition | null): ResolvedTime {
  return resolveTime({ game: game?.time });
}

/**
 * Hashes what a run's outcome depends on besides the scene, so a report or
 * recording from another engine version, tick rate or game tuning can be told
 * apart. `time` is the run's clock; omitted, the game's own.
 */
export function probeConfigHash(
  game?: GameDefinition | null,
  time: Pick<ResolvedTime, "rate"> = gameTime(game),
): string {
  return hashText(
    JSON.stringify({
      engine: ENGINE_VERSION,
      tickRate: time.rate,
      game: game?.id ?? null,
      config: game?.configHash ?? null,
    }),
  );
}

/** One input edge as the runtime takes it, stamped at its tick's start on `time`'s clock (default the engine's). */
export function inputAction(
  action: string,
  pressed: boolean,
  tick: number,
  time: Pick<ResolvedTime, "tickMs"> = DEFAULT_CLOCK,
): InputAction {
  return { action, pressed, tick, timestamp: tick * time.tickMs };
}

/** The physics build a recording names, e.g. `rapier 0.19.3`; `none` for a run without Rapier. */
export function physicsBuild(rapier: RapierModule | null): string {
  if (!rapier) return "none";
  const version = (rapier as { version?: () => string }).version?.();
  return version ? `rapier ${version}` : "rapier";
}

/** The Rapier a run of `scene` steps on, for its recording: `null` when the scene's physics resolves to none, loaded or not. */
export function recordingRapier(
  scene: { settings: Pick<ResolvedSettings, "physics"> },
  rapier: RapierModule | null | undefined,
): RapierModule | null {
  return scene.settings.physics === "rapier" ? (rapier ?? null) : null;
}

/** A command as recordings and reports list it, stepped on `tick`. */
export function recordedCommand(tick: number, command: GameCommand): RecordingCommand {
  return command.args === undefined
    ? [tick, command.name]
    : [tick, command.name, structuredClone(command.args)];
}

/** A digest of the game's snapshot, which a replay must reproduce. */
export function snapshotDigest(snapshot: unknown): string {
  return hashText(JSON.stringify(snapshot ?? null));
}

export type RecorderOptions = {
  rapier: RapierModule | null;
  game: GameDefinition | null;
  scene: string;
  sceneHash: SceneHash;
  /** The start as Play was asked for it; a replay casts `at` again the same way. */
  start: PlayOptions;
  /** The run's clock (`runtime.ctx.time`); omitted, the game's own. */
  time?: ResolvedTime;
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
  /** After each simulated tick, with the edges and commands it stepped, in order. */
  tick(
    state: PlayState,
    edges: readonly InputEdge[],
    focus: Vec2 | null,
    commands?: readonly GameCommand[],
  ): void;
  /** The recording so far, ended as `end` with the game's snapshot after its last tick. */
  finish(end: RecordingEnd, final: unknown): RunRecording;
};

export function createRunRecorder(opts: RecorderOptions): RunRecorder {
  const { game } = opts;
  const time = opts.time ?? gameTime(game);
  const play = game?.play;
  const marks = play?.markers ? new Set(play.markers) : null;
  const maxMarkers = opts.maxMarkers ?? DEFAULT_MAX_MARKERS;
  const maxTrail = opts.maxTrail ?? DEFAULT_MAX_TRAIL;

  const actions: string[] = [];
  const index = new Map<string, number>();
  const inputs: RunRecording["inputs"] = [];
  const commands: RecordingCommand[] = [];
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
    tick(state, edges, focus, stepped = []) {
      for (const [t, action, pressed] of edges) inputs.push([t, actionIndex(action), pressed]);
      for (const c of stepped) commands.push(recordedCommand(state.tick, c));
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
        configHash: probeConfigHash(game, time),
        tickRate: time.rate,
        start: structuredClone(start),
        actions: [...actions],
        inputs: inputs.map((e) => [...e] as (typeof inputs)[number]),
        ...(commands.length > 0
          ? { commands: commands.map((c) => structuredClone(c) as RecordingCommand) }
          : {}),
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

/** The recording's commands by tick, in the order they were stepped. */
export function recordingCommands(recording: RunRecording): Map<number, GameCommand[]> {
  const byTick = new Map<number, GameCommand[]>();
  for (const [tick, name, args] of recording.commands ?? []) {
    const list = byTick.get(tick) ?? [];
    list.push(args === undefined ? { name } : { name, args: structuredClone(args) });
    byTick.set(tick, list);
  }
  return byTick;
}
