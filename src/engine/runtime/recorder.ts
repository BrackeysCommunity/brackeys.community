/**
 * Records a run as it is stepped, in the browser or headless: every seat's
 * input and the system events as streams, the focus every few ticks, the
 * game's markers, and how it ended.
 */
import { resolveTime, type ResolvedTime } from "../game/time";
import type {
  DeviceId,
  GameCommand,
  GameDefinition,
  PlayerInfo,
  PlayState,
  RunResult,
} from "../game/types";
import type { PlayOptions } from "../headless/playtest-types";
import type { PointerState } from "../input/state";
import { decodeStreams, encodeTick, type TickInput } from "../input/stream";
import { hashText } from "../scene/hash";
import {
  RECORDING_TRAIL_EVERY,
  RECORDING_VERSION,
  type RecordingCommand,
  type RecordingMarker,
  type RecordingPlatform,
  type RecordingStream,
  type RunRecording,
  type SeatEvent,
  type SystemEvent,
} from "../scene/recording-schema";
import type { Pt, ResolvedSettings, SceneHash } from "../scene/types";
import type { InputAction, RapierModule, Vec2 } from "../types";
import { ENGINE_VERSION } from "../version";
import { defaultSeed } from "./seed";

const DEFAULT_MAX_MARKERS = 1000;
const DEFAULT_MAX_TRAIL = 2000;
const ELAPSED = "@elapsed";

/**
 * Whether a Rapier recording replays on another CPU architecture without a
 * warning. True since the cross-platform determinism check held on x86_64;
 * when false, a replay whose recorded `arch` is known and differs from here
 * carries `recording-other-platform`.
 */
export const REPLAY_ACROSS_PLATFORMS = true;

/** What a host knows about where it runs, beyond what the engine reads itself. */
export type RecordingHost = {
  /**
   * Overrides what the engine finds: `arch` and `runtime` default to this
   * process's (`"unknown"` and `"browser"` without one), and `flavour`, the
   * Rapier package, defaults to null since a module doesn't name its package.
   */
  platform?: Partial<RecordingPlatform>;
  /** The project the run plays in and its snapshot hash, when the host has them; default null. */
  projectRef?: { id: string; snapshot: string | null } | null;
};

type ProcessLike = { arch?: unknown; versions?: Record<string, unknown> };

/** This process's architecture and runtime, as a recording names them. */
export function hostPlatform(): Pick<RecordingPlatform, "arch" | "runtime"> {
  const proc = (globalThis as { process?: ProcessLike }).process;
  const versions = proc?.versions ?? {};
  const arch = typeof proc?.arch === "string" ? proc.arch : "unknown";
  const named = (["bun", "deno", "node"] as const).find((k) => typeof versions[k] === "string");
  return { arch, runtime: named ? `${named} ${String(versions[named])}` : "browser" };
}

/** The platform a recording names: the host's values over this process's; no flavour without Rapier. */
export function recordingPlatform(
  rapier: RapierModule | null,
  host?: Partial<RecordingPlatform>,
): RecordingPlatform {
  const here = hostPlatform();
  return {
    arch: host?.arch ?? here.arch,
    runtime: host?.runtime ?? here.runtime,
    flavour: rapier ? (host?.flavour ?? null) : null,
  };
}

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

/** The physics build a report names, e.g. `rapier 0.19.3`; `none` for a run without Rapier. */
export function physicsBuild(rapier: RapierModule | null): string {
  if (!rapier) return "none";
  const version = (rapier as { version?: () => string }).version?.();
  return version ? `rapier ${version}` : "rapier";
}

/** `physicsBuild` as a recording's `engine.physics` holds it: null for a run without Rapier. */
export function recordingPhysics(rapier: RapierModule | null): string | null {
  return rapier ? physicsBuild(rapier) : null;
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

/**
 * The play options a recording asks for, so a replay starts the world the
 * same way: its `start` and its `seed` (a start that names its own seed, as
 * one read from an older recording may, counts when `seed` is omitted).
 * `game` is passed through unparsed.
 */
export function recordingStart(
  start: RunRecording["start"] & { seed?: number | string },
  seed?: number | string,
): PlayOptions {
  const play: PlayOptions = {};
  if (start.at) play.at = { x: start.at[0], y: start.at[1] };
  if (start.timeOffsetMs !== undefined) play.timeOffsetMs = start.timeOffsetMs;
  if (start.game !== undefined) play.game = start.game;
  const s = seed ?? start.seed;
  if (s !== undefined) play.seed = s;
  return play;
}

/** A digest of the game's snapshot, which a replay must reproduce. */
export function snapshotDigest(snapshot: unknown): string {
  return hashText(JSON.stringify(snapshot ?? null));
}

/** A tick with no input. */
export const emptyTick = (tick: number): TickInput => ({
  tick,
  actions: [],
  commands: [],
  pointers: [],
  joins: [],
});

/**
 * A recording's input by tick, the one way every replay reads it:
 * `decodeStreams` on the run's clock, with sub-tick offsets when the game
 * records them.
 */
export function recordingTicks(
  recording: RecordingStream,
  time: Pick<ResolvedTime, "tickMs">,
  game?: GameDefinition | null,
): Map<number, TickInput> {
  return decodeStreams(recording, { tickMs: time.tickMs, subTick: game?.input?.subTick === true });
}

export type RecorderOptions = RecordingHost & {
  rapier: RapierModule | null;
  game: GameDefinition | null;
  scene: string;
  sceneHash: SceneHash;
  /** `preparePlay`'s hash of what the run runs; a replay is stale when its own differs. */
  runHash: string;
  /** The start as Play was asked for it; a replay casts `at` again the same way. */
  start: PlayOptions;
  /** The run's clock (`runtime.ctx.time`); omitted, the game's own. */
  time?: ResolvedTime;
  /** The seats as the run loaded (`runtime.ctx.input.players()`); devices they take later come from the joins recorded. */
  players?: readonly PlayerInfo[];
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
  /** After each simulated tick, with the input it stepped, in the order the runtime took it. */
  tick(state: PlayState, input: TickInput, focus: Vec2 | null): void;
  /** The recording so far, ended as `end` with the game's snapshot after its last tick. */
  finish(end: RecordingEnd, final: unknown): RunRecording;
};

/** Lifecycle events, which a game spawning bullets raises by the thousand, mark only when named. */
const LIFECYCLE_PREFIX = "entity:";

/**
 * Whether a recording keeps an event of `type` as a marker: the types
 * `play.markers` names; without that list, every type but `entity:*`.
 */
function marksEvent(type: string, markers: ReadonlySet<string> | null): boolean {
  return markers ? markers.has(type) : !type.startsWith(LIFECYCLE_PREFIX);
}

const samePointer = (a: PointerState, b: PointerState): boolean =>
  a.x === b.x && a.y === b.y && a.buttons === b.buttons && a.over === b.over;

/** A name's index in `table`, appended on first use. */
function indexer(table: string[]): (name: string) => void {
  const seen = new Set<string>();
  return (name) => {
    if (seen.has(name)) return;
    seen.add(name);
    table.push(name);
  };
}

/**
 * Records a run in the current format: each tick's input through
 * `encodeTick`, a seat's pointer only when it changed since the last one
 * written, and every seed, the default one when the run named none.
 */
export function createRunRecorder(opts: RecorderOptions): RunRecorder {
  const { game } = opts;
  const time = opts.time ?? gameTime(game);
  const play = game?.play;
  const marks = play?.markers ? new Set(play.markers) : null;
  const maxMarkers = opts.maxMarkers ?? DEFAULT_MAX_MARKERS;
  const maxTrail = opts.maxTrail ?? DEFAULT_MAX_TRAIL;
  const subTick = game?.input?.subTick === true;

  const actions: string[] = [];
  const commands: string[] = [];
  const useAction = indexer(actions);
  const useCommand = indexer(commands);
  const inputs: SeatEvent[][] = [];
  const system: SystemEvent[] = [];
  const written: (PointerState | undefined)[] = [];
  const seats = new Map<number, DeviceId[]>();
  const markers: RecordingMarker[] = [];
  const pts: Pt[] = [];
  let trailTruncated = false;

  const seatDevices = (player: number): DeviceId[] => {
    let devices = seats.get(player);
    if (!devices) {
      devices = [];
      seats.set(player, devices);
    }
    return devices;
  };
  for (const p of opts.players ?? []) {
    if (!p.joined && p.devices.length === 0) continue;
    const devices = seatDevices(p.index);
    for (const d of p.devices) if (!devices.includes(d)) devices.push(d);
  }

  const start: RunRecording["start"] = {};
  if (opts.start.at) start.at = [opts.start.at.x, opts.start.at.y];
  if (opts.start.timeOffsetMs) start.timeOffsetMs = opts.start.timeOffsetMs;
  if (opts.start.game !== undefined) start.game = structuredClone(opts.start.game);
  const seed = opts.start.seed ?? defaultSeed(game?.id ?? null, opts.scene);

  return {
    tick(state, input, focus) {
      for (const a of input.actions) useAction(a.action);
      for (const c of input.commands) if (c.name !== ELAPSED) useCommand(c.name);
      const pointers = input.pointers.map((p, seat) => {
        if (!p) return undefined;
        const last = written[seat];
        if (last && samePointer(last, p)) return undefined;
        written[seat] = { ...p };
        return p;
      });
      const encoded = encodeTick(
        { ...input, tick: state.tick, pointers },
        { actions, commands },
        { subTick },
      );
      encoded.seats.forEach((events, seat) => {
        while (inputs.length <= seat) inputs.push([]);
        inputs[seat]!.push(...events);
      });
      system.push(...encoded.system);
      for (const change of input.joins) {
        if (!change.joined) continue;
        const devices = seatDevices(change.player);
        if (!devices.includes(change.device)) devices.push(change.device);
      }

      for (const e of state.events) {
        if (!marksEvent(e.type, marks)) continue;
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
      const players = [...seats]
        .sort(([a], [b]) => a - b)
        .map(([index, devices]) => ({ index, devices: [...devices] }));
      const streams = inputs.map((events) => events.map((e) => structuredClone(e)));
      const seatCount = players.reduce((n, p) => Math.max(n, p.index + 1), 1);
      while (streams.length < seatCount) streams.push([]);
      const recording: RunRecording = {
        v: RECORDING_VERSION,
        engine: { version: ENGINE_VERSION, physics: recordingPhysics(opts.rapier) },
        platform: recordingPlatform(opts.rapier, opts.platform),
        game: game?.id ?? null,
        scene: opts.scene,
        sceneHash: opts.sceneHash,
        runHash: opts.runHash,
        project: opts.projectRef ? { ...opts.projectRef } : null,
        configHash: probeConfigHash(game, time),
        time: { kind: time.kind, rate: time.rate },
        seed,
        start: structuredClone(start),
        players,
        actions: [...actions],
        commands: [...commands],
        inputs: streams,
        system: system.map((e) => [...e] as SystemEvent),
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
