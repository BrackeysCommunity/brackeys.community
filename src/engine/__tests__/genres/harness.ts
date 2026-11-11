import { vi } from "vite-plus/test";

import { createRegistry } from "../../game/define";
import { resolveTime } from "../../game/time";
import type { GameCommand, GameDefinition } from "../../game/types";
import { compileInputScript } from "../../headless/compile-input-script";
import { probeConfigHash } from "../../headless/headless";
import {
  blockedRun,
  prepareRun,
  runBlocked,
  runLibrary,
  runLoop,
  startRun,
  type InputSource,
} from "../../headless/play-loop";
import { runPlaytest } from "../../headless/playtest";
import type {
  InputEdge,
  InputScript,
  InputScriptV2,
  PlaytestBlocked,
  PlaytestReport,
} from "../../headless/playtest-types";
import { replayRecording, type ReplayReport } from "../../headless/recording";
import type { PointerState } from "../../input/state";
import type { SeatChange, TickInput } from "../../input/stream";
import {
  createRunRecorder,
  emptyTick,
  recordedCommand,
  recordingRapier,
  trailPoint,
} from "../../runtime/recorder";
import { resolveGame } from "../../runtime/runtime";
import type { StepEvent } from "../../runtime/types";
import { scenePhysics } from "../../scene/expand";
import { hashText } from "../../scene/hash";
import type { RecordingCommand } from "../../scene/recording-schema";
import type { Pt, PrefabLibrary, SceneDefinition, SceneSettings } from "../../scene/types";
import type { InputAction, RapierModule } from "../../types";
import { loadCompatRapier } from "../fixtures/compat-rapier";

/** Plan 53's matrix rows, by id; matrix.ts maps each to the milestones that deliver it. */
export type GenreRow =
  | "platformer"
  | "top-down"
  | "twin-stick"
  | "puzzle"
  | "card-board"
  | "tactics"
  | "visual-novel"
  | "racing"
  | "physics-sandbox"
  | "rts"
  | "tower-defense"
  | "rhythm"
  | "roguelike"
  | "metroidvania"
  | "point-and-click"
  | "idle"
  | "endless-runner"
  | "fighting"
  | "local-multiplayer"
  | "online-multiplayer";

/** Another run of a probe: settings over the scene's own, and the seed `ctx.random` gets. */
export type ProbeVariant = {
  name: string;
  settings?: Partial<SceneSettings>;
  /** Overrides the script's `seed` (`PlayOptions.seed`); omitted, the script's or the default. */
  seed?: number | string;
};

export type GenreProbe<S = unknown> = {
  id: string;
  rows: readonly GenreRow[];
  /** Needs of those rows not yet delivered, with the milestone that will. */
  pending?: Partial<Record<GenreRow, string>>;
  game: GameDefinition<S>;
  /** Built in code from primitives and the probe's own types. */
  scene: SceneDefinition;
  /** Every prefab the run may place: the scene's instances and `ctx.instantiate` both draw on it. */
  prefabs?: PrefabLibrary;
  script: InputScript | InputScriptV2;
  /**
   * Input no script can say, such as a tap's sub-tick `offset`, fed in place
   * of the script's steps: the `TickInput` for each slot it names by `tick`,
   * nothing in the slots between. The script then holds only `wait` steps,
   * which set how many slots the input lasts, and its header (start, seed,
   * `maxTicks`) applies as ever. The run stamps each action's tick and time
   * and quantises values, as a scripted run's are.
   */
  ticks?: readonly TickInput[];
  expect: { result: string; maxTicks?: number };
  /** Settings the probe also runs under; the sweep needs gravity zero, sideways and physics none covered. */
  variants?: readonly ProbeVariant[];
  /** How long one run (play and replay) may take in a test; default `PROBE_TIMEOUT_MS`. */
  timeoutMs?: number;
};

export type ProbeRun = {
  report: PlaytestReport;
  replay: ReplayReport;
  digest: string;
  /** Whether a Rapier module was ever handed to the run. */
  usedRapier: boolean;
};

/** The name pins.ts files a probe's run without a variant under. */
export const DEFAULT_VARIANT = "default";

/** A probe run's test timeout when the probe names none. */
export const PROBE_TIMEOUT_MS = 60_000;

/** The test timeout for each of a probe's runs. */
export function probeTimeout(probe: GenreProbe): number {
  return probe.timeoutMs ?? PROBE_TIMEOUT_MS;
}

let compat: Promise<RapierModule> | null = null;

/** Loads the `-compat` Rapier build once; a spy, so a file can assert it never ran. */
export const loadRapier = vi.fn(() => (compat ??= loadCompatRapier()));

/** The probe's scene with the variant's settings over its own. */
export function variantScene(probe: GenreProbe, variant?: ProbeVariant): SceneDefinition {
  if (!variant?.settings) return probe.scene;
  return { ...probe.scene, settings: { ...probe.scene.settings, ...variant.settings } };
}

/** The backend a probe's run resolves to, before anything loads. */
export function probePhysics(probe: GenreProbe, variant?: ProbeVariant): "rapier" | "none" {
  const registry = createRegistry(probe.game as GameDefinition);
  return scenePhysics(variantScene(probe, variant), registry);
}

/** The probe's script with the variant's seed over its own. */
export function variantScript(
  probe: GenreProbe,
  variant?: ProbeVariant,
): InputScript | InputScriptV2 {
  if (variant?.seed === undefined) return probe.script;
  return { ...probe.script, seed: variant.seed };
}

/** An action for `tickInput`: its tick and time are stamped by the run. */
export type ProbeAction = Omit<InputAction, "tick" | "timestamp">;

/** One slot's input for a probe's `ticks`, from the parts it has. */
export function tickInput(
  tick: number,
  parts: {
    actions?: readonly ProbeAction[];
    commands?: readonly GameCommand[];
    pointers?: readonly (PointerState | undefined)[];
    joins?: readonly SeatChange[];
  } = {},
): TickInput {
  return {
    tick,
    actions: (parts.actions ?? []).map((a) => ({ ...a, tick, timestamp: 0 })),
    commands: [...(parts.commands ?? [])],
    pointers: [...(parts.pointers ?? [])],
    joins: [...(parts.joins ?? [])],
  };
}

/**
 * A probe's `ticks` by slot. Throws on a slot named twice or past the
 * script's waits, and on an `offset` when the game doesn't record sub-tick
 * offsets, since the run would drop it and the probe would judge something
 * it never fed.
 */
function tickSlots(
  ticks: readonly TickInput[],
  length: number,
  game: GameDefinition | null,
): Map<number, TickInput> {
  const subTick = game?.input?.subTick === true;
  const out = new Map<number, TickInput>();
  for (const t of ticks) {
    if (!Number.isInteger(t.tick) || t.tick < 0 || t.tick >= length)
      throw new Error(`a probe's tick input names slot ${t.tick}, outside the script's ${length}`);
    if (out.has(t.tick)) throw new Error(`a probe's tick inputs name slot ${t.tick} twice`);
    if (!subTick && t.actions.some((a) => a.offset !== undefined))
      throw new Error(
        `slot ${t.tick} carries a sub-tick offset, but the game doesn't set input.subTick`,
      );
    out.set(t.tick, t);
  }
  return out;
}

/** The slots a script of `wait` steps lasts: its longest track. Throws on any other step. */
function waitSlots(script: InputScript | InputScriptV2): number {
  const tracks =
    "tracks" in script && script.tracks ? script.tracks : [{ steps: script.steps ?? [] }];
  let longest = 0;
  for (const track of tracks) {
    let slots = 0;
    for (const step of track.steps as readonly object[]) {
      if (!("wait" in step) || typeof step.wait !== "number")
        throw new Error(
          `a probe that feeds ticks has only wait steps, not ${JSON.stringify(step)}`,
        );
      slots += step.wait;
    }
    longest = Math.max(longest, slots);
  }
  return longest;
}

const DEFAULT_MAX_EVENTS = 1000;
const DEFAULT_MAX_TRAIL = 2000;
const TRAIL_EVERY = 4;

export type TickRunOptions = {
  rapier: RapierModule | null;
  game: GameDefinition;
  scene: SceneDefinition;
  prefabs?: PrefabLibrary;
  library?: PrefabLibrary;
  /** Its header starts the run; its `wait` steps set how many slots the input lasts. */
  script: InputScript | InputScriptV2;
  ticks: readonly TickInput[];
};

/**
 * Plays `TickInput`s the way `runPlaytest` plays a script: the script's
 * header compiled the same way, then the same preparation, loop, recorder
 * and report, its `steps` empty. Its recording replays with
 * `replayRecording` like any other.
 */
export function playTicks(opts: TickRunOptions): PlaytestReport | PlaytestBlocked {
  const { registry, game } = resolveGame({ game: opts.game });
  const name = opts.scene.name;
  const length = waitSlots(opts.script);
  const slots = tickSlots(opts.ticks, length, game);
  const compiled = compileInputScript(opts.script, registry, resolveTime({ game: registry.time }));
  if (!compiled.ok) return blockedRun("script", name, [], compiled.issues);
  const { play, maxTicks, scene } = compiled.script;
  if (scene !== undefined && scene !== name)
    throw new Error(`the probe's script is for scene ${scene}, not ${name}`);

  const library = runLibrary(opts);
  const prepared = prepareRun(opts.scene, registry, false, opts.prefabs, undefined, { library });
  if (!prepared.ok) return prepared.blocked;
  const started = startRun({
    rapier: opts.rapier,
    game,
    registry,
    scene: prepared.scene,
    play,
    prefabs: library,
  });
  if (!started.ok) return blockedRun("load", name, prepared.issues, [], started.load);
  const { runtime } = started;

  try {
    const time = runtime.ctx.time;
    const events: StepEvent[] = [];
    let eventsTruncated = false;
    const pts: Pt[] = [];
    let trailTruncated = false;
    const inputs: InputEdge[] = [];
    const commands: RecordingCommand[] = [];
    let read = 0;
    const input: InputSource = {
      done: () => read >= length,
      tick: (slot) => {
        read = slot + 1;
        return slots.get(slot) ?? emptyTick(slot);
      },
    };
    const recorder = createRunRecorder({
      rapier: recordingRapier(prepared.scene, opts.rapier),
      game,
      scene: name,
      sceneHash: prepared.hash,
      runHash: prepared.runHash,
      start: play,
      time,
      players: runtime.ctx.input.players(),
    });

    let end: ReturnType<typeof runLoop>;
    try {
      end = runLoop({
        runtime,
        game,
        maxTicks,
        input,
        record: inputs,
        onTick(state, focus, _edges, stepped, tickInput) {
          recorder.tick(state, tickInput, focus);
          for (const c of stepped) commands.push(recordedCommand(state.tick, c));
          for (const e of state.events) {
            if (events.length < DEFAULT_MAX_EVENTS) events.push(e);
            else eventsTruncated = true;
          }
          if (focus && state.tick % TRAIL_EVERY === 0) {
            if (pts.length < DEFAULT_MAX_TRAIL) pts.push(trailPoint(focus));
            else trailTruncated = true;
          }
        },
      });
    } catch (err) {
      const blocked = runBlocked(err, name, prepared.issues, registry);
      if (blocked) return blocked;
      throw err;
    }

    const final = runtime.snapshot();
    const focus = game?.play?.focus && final !== null ? game.play.focus(final) : null;
    const outcome: PlaytestReport["outcome"] = {
      result: end.result,
      tick: end.tick,
      at: focus ? { x: focus.x, y: focus.y } : null,
    };
    if (end.cause !== undefined) outcome.cause = end.cause;
    if (end.entityId !== undefined) outcome.entityId = end.entityId;
    const recording = recorder.finish(end, final);
    const { actions, commands: commandNames, inputs: seatStreams, system } = recording;
    return {
      blocked: false,
      scene: name,
      sceneHash: prepared.hash,
      configHash: probeConfigHash(game, time),
      tickRate: time.rate,
      outcome,
      ticks: end.ticks,
      slots: end.slots,
      events,
      truncated: eventsTruncated,
      trail: { every: TRAIL_EVERY, pts, truncated: trailTruncated },
      stepsReached: 0,
      steps: [],
      final,
      inputs,
      stream: structuredClone({ actions, commands: commandNames, inputs: seatStreams, system }),
      commands,
      issues: prepared.issues,
      recording,
    };
  } finally {
    runtime.destroy();
  }
}

/** What a run is pinned by: how it ended, what it emitted, and the game's end state. */
function runDigest(report: PlaytestReport): string {
  return hashText(
    JSON.stringify([
      report.outcome,
      report.ticks,
      report.slots,
      report.recording.end,
      report.events,
      report.trail.pts,
    ]),
  );
}

function blockedMessage(
  what: string,
  run: { stage: string; issues: unknown; scriptIssues: unknown },
) {
  return `${what} blocked at ${run.stage}: ${JSON.stringify({ issues: run.issues, scriptIssues: run.scriptIssues })}`;
}

/**
 * Plays a probe headless (under a variant's settings and seed when given),
 * from its script or its `TickInput`s, replays its recording, and digests
 * the run. The probe's prefabs go to both
 * runs as the scene's and as the library `ctx.instantiate` draws on. Rapier is
 * loaded only when the scene's physics resolves to it; a physics-free run
 * gets `rapier: null`.
 */
export async function runGenreProbe<S>(
  probe: GenreProbe<S>,
  variant?: ProbeVariant,
): Promise<ProbeRun> {
  const p = probe as GenreProbe;
  const scene = variantScene(p, variant);
  const rapier = probePhysics(p, variant) === "none" ? null : await loadRapier();
  const label = `${probe.id} ${variant?.name ?? DEFAULT_VARIANT}`;

  const script = variantScript(p, variant);
  const runs = { rapier, game: p.game, scene, prefabs: p.prefabs, library: p.prefabs };
  const report = p.ticks
    ? playTicks({ ...runs, script, ticks: p.ticks })
    : runPlaytest({ ...runs, script });
  if (report.blocked) throw new Error(blockedMessage(`${label}: the playtest`, report));

  const replay = replayRecording({
    rapier,
    game: p.game,
    scene,
    prefabs: p.prefabs,
    library: p.prefabs,
    recording: report.recording,
  });
  if (replay.blocked) throw new Error(blockedMessage(`${label}: the replay`, replay));

  return {
    report: report as PlaytestReport,
    replay: replay as ReplayReport,
    digest: runDigest(report as PlaytestReport),
    usedRapier: rapier !== null,
  };
}

function isProbe(value: unknown): value is GenreProbe {
  if (!value || typeof value !== "object") return false;
  const p = value as Partial<GenreProbe>;
  return (
    typeof p.id === "string" &&
    Array.isArray(p.rows) &&
    !!p.game &&
    !!p.scene &&
    !!p.script &&
    typeof p.expect === "object"
  );
}

/**
 * The probes a `*.probe.ts` glob found, sorted by id: every exported probe of
 * each module. Throws on a duplicate id or a variant named twice or
 * `default`, since pins.ts files runs by those names.
 */
export function probesFrom(modules: Record<string, Record<string, unknown>>): GenreProbe[] {
  const probes = [
    ...new Set(Object.values(modules).flatMap((mod) => Object.values(mod).filter(isProbe))),
  ].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const [i, probe] of probes.entries()) {
    if (probes[i - 1]?.id === probe.id) throw new Error(`two genre probes are named ${probe.id}`);
    const names = new Set<string>([DEFAULT_VARIANT]);
    for (const v of probe.variants ?? []) {
      if (names.has(v.name)) throw new Error(`${probe.id}: variant name ${v.name} is taken`);
      names.add(v.name);
    }
  }
  return probes;
}

/** A probe's runs: its default, then each variant in order. */
export function probeRuns(probe: GenreProbe): { name: string; variant?: ProbeVariant }[] {
  return [
    { name: DEFAULT_VARIANT },
    ...(probe.variants ?? []).map((v) => ({ name: v.name, variant: v })),
  ];
}
