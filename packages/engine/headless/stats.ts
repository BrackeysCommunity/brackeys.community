import type { BehaviorName } from "../game/behaviors";
import {
  TICK_PHASES,
  type RuntimeTimings,
  type TickPhase,
  type TimingStat,
} from "../runtime/timings";
import type { SceneRuntimeHandle } from "../runtime/types";
import { ENTITY_DESTROYED, ENTITY_SPAWNED } from "../runtime/types";
import { runPlaytest } from "./playtest";
import type { CompiledInputScript, PlaytestOptions } from "./playtest-types";

/** What `runStats` measured over a scene's run. */
export type StatsReport = {
  scene: string;
  ticks: number;
  /** Deterministic: the same for every run of one input. */
  counts: {
    entities: number;
    bodies: number;
    colliders: number;
    behaviors: Readonly<Record<BehaviorName, number>>;
    events: number;
    spawned: number;
    destroyed: number;
  };
  /** Not deterministic: wall-clock measurements on this machine. */
  wall: {
    ticksPerSecond: number;
    timings: RuntimeTimings;
    machine: { arch: string; runtime: string };
  };
};

export type StatsOptions = PlaytestOptions & {
  ticks: number;
  /** Ticks run first and left out of the measurements. */
  warmup?: number;
};

type ProcessLike = { arch?: string; versions?: { node?: string; bun?: string } };

function machine(): StatsReport["wall"]["machine"] {
  const proc = (globalThis as { process?: ProcessLike }).process;
  const versions = proc?.versions;
  const runtime = versions?.bun
    ? `bun ${versions.bun}`
    : versions?.node
      ? `node ${versions.node}`
      : ((globalThis as { navigator?: { userAgent?: string } }).navigator?.userAgent ?? "unknown");
  return { arch: proc?.arch ?? "unknown", runtime };
}

function emptyTimings(): RuntimeTimings {
  const phases = {} as Record<TickPhase, TimingStat>;
  for (const phase of TICK_PHASES) phases[phase] = { mean: 0, max: 0 };
  return { ticks: 0, phases, systems: {}, behaviors: {} };
}

const whole = (n: number | undefined, min: number) =>
  Math.max(min, Math.floor(Number.isFinite(n) ? (n as number) : min));

/**
 * Plays the script for `warmup + ticks` ticks (fewer when the script or the
 * game ends it first) with timings on, then reports the scene's counts and
 * its speed here. `counts` covers the measured ticks and the world after the
 * last one; `wall` is the only part two runs of one input don't share.
 * Rejects when the run is blocked.
 */
export async function runStats(opts: StatsOptions): Promise<StatsReport> {
  const ticks = whole(opts.ticks, 1);
  const warmup = whole(opts.warmup, 0);
  const clock = opts.timings?.clock ?? (() => performance.now());
  let begun = 0;
  let startedAt = 0;
  let endedAt = 0;
  let world: ReturnType<SceneRuntimeHandle["stats"]> | null = null;
  let timings: RuntimeTimings | null = null;

  const script = { ...opts.script, maxTicks: warmup + ticks } as CompiledInputScript;
  const run = runPlaytest({
    ...opts,
    script,
    maxEvents: Number.MAX_SAFE_INTEGER,
    timings: {
      clock,
      window: ticks,
      partial: true,
      enabled: () => {
        const on = begun++ >= warmup;
        if (begun === warmup + 1) startedAt = clock();
        return on;
      },
    },
    onEnd(runtime) {
      endedAt = clock();
      world = runtime.stats();
      timings = runtime.timings();
    },
  });
  if (run.blocked) {
    const first = run.issues[0]?.message ?? run.scriptIssues[0]?.message ?? "no issue given";
    throw new Error(`scene ${run.scene} is blocked at ${run.stage}: ${first}`);
  }

  const measured = Math.max(0, run.ticks - warmup);
  const counted = run.events.filter((e) => e.tick >= warmup);
  const stats = world as ReturnType<SceneRuntimeHandle["stats"]> | null;
  const elapsed = endedAt - startedAt;
  return {
    scene: run.scene,
    ticks: measured,
    counts: {
      entities: stats?.entities ?? 0,
      bodies: stats?.bodies ?? 0,
      colliders: stats?.colliders ?? 0,
      behaviors: { ...stats?.behaviors },
      events: counted.length,
      spawned: counted.filter((e) => e.type === ENTITY_SPAWNED).length,
      destroyed: counted.filter((e) => e.type === ENTITY_DESTROYED).length,
    },
    wall: {
      ticksPerSecond: measured > 0 && elapsed > 0 ? (measured * 1000) / elapsed : 0,
      timings: timings ?? emptyTimings(),
      machine: machine(),
    },
  };
}
