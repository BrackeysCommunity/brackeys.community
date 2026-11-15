import { formatMs, runStats, type InputScript, type StatsReport } from "@jams/engine/headless";

import { failure, gameFlag, isToolResult, openScene, usage, type Tool } from "../context";
import { projectRuntime } from "../projects";
import { rapierFor } from "./step";

export type StatsInput = {
  scene?: string;
  /** Ticks to measure; the tool's default when omitted. */
  ticks?: string;
  game?: string;
  /** Ticks played first and left out of the measurements; the perf runner's, not a CLI flag. */
  warmup?: number;
};

export const STATS_USAGE = "stats <scene|file> [--ticks n] [--game id] [--json]";

export const DEFAULT_STATS_TICKS = 600;
/** One input script's longest run. */
const MAX_STATS_TICKS = 36_000;

const ms = (value: number) => formatMs(value).padStart(8);

/** The report as text: counts first, then this machine's numbers. */
export function statsLines(report: StatsReport): string[] {
  const { counts, wall } = report;
  const behaviors = Object.entries(counts.behaviors)
    .map(([name, n]) => `${name} ${n}`)
    .join(", ");
  const slowest = (from: Readonly<Record<string, { mean: number; max: number }>>) =>
    Object.entries(from)
      .sort(([, a], [, b]) => b.mean - a.mean)
      .slice(0, 5);
  return [
    `${report.scene}: ${report.ticks} ticks`,
    `  counts: ${counts.entities} entities, ${counts.bodies} bodies, ${counts.colliders} colliders, ${counts.events} events, ${counts.spawned} spawned, ${counts.destroyed} destroyed`,
    `  behaviors: ${behaviors || "none"}`,
    `  wall clock (${wall.machine.arch}, ${wall.machine.runtime}; differs between runs): ${Math.round(wall.ticksPerSecond)} ticks/s`,
    "    phase              mean ms   worst ms",
    ...Object.entries(wall.timings.phases).map(
      ([p, s]) => `    ${p.padEnd(16)} ${ms(s.mean)}  ${ms(s.max)}`,
    ),
    ...slowest(wall.timings.systems).map(
      ([n, s]) => `    system ${n}: mean ${ms(s.mean)}  worst ${ms(s.max)}`,
    ),
    ...slowest(wall.timings.behaviors).map(
      ([n, s]) => `    behavior ${n}: mean ${ms(s.mean)}  worst ${ms(s.max)}`,
    ),
  ];
}

/** A scene's deterministic counts and this machine's ticks per second and per-phase timings. */
export const stats: Tool<StatsInput> = async (input, ctx) => {
  let ticks = DEFAULT_STATS_TICKS;
  if (input.ticks !== undefined) {
    const n = Number(input.ticks);
    if (!Number.isInteger(n) || n < 1 || n > MAX_STATS_TICKS)
      return usage(`--ticks takes a whole number from 1 to ${MAX_STATS_TICKS}`);
    ticks = n;
  }
  const under = input.game === undefined ? undefined : gameFlag(ctx, input.game);
  if (isToolResult(under)) return under;
  const loaded = await openScene(ctx, input.scene, STATS_USAGE, under);
  if (!loaded.ok) return loaded.result;
  const { registry } = loaded;
  const project = loaded.project ? await projectRuntime(loaded.project, registry) : null;
  const warmup = Math.min(Math.max(0, Math.floor(input.warmup ?? 0)), MAX_STATS_TICKS - ticks);
  const script: InputScript = {
    v: 1,
    maxTicks: warmup + ticks,
    steps: [{ wait: warmup + ticks }],
  };
  let report: StatsReport;
  try {
    report = await runStats({
      rapier: await rapierFor(ctx, loaded.def, registry, project?.engine),
      game: registry.game,
      registry,
      scene: loaded.def,
      prefabs: loaded.prefabs,
      project,
      script,
      ticks,
      warmup,
    });
  } catch (err) {
    return failure(err instanceof Error ? err.message : String(err));
  }
  return {
    exitCode: 0,
    data: { game: registry.game?.id ?? null, ...report },
    text: statsLines(report).join("\n"),
  };
};
