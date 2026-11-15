/**
 * The engine's speed budget: each case plays `ticks` ticks `runs` times
 * through `scene stats`, after `warmup` ticks left out of the measurement,
 * and is judged on its median ticks per second against this runner's
 * baseline. The key is the arch and the runtime that ran it, `x64/bun1`
 * under Bun, `arm64/node26` under Node: Bun reports a Node version it is
 * compatible with, which a Bun upgrade moves. Below 80% fails, below 90%
 * warns; a runner or case with no baseline passes with a notice, loud on CI.
 *
 *   vp run engine:perf            # judge against the baseline
 *   vp run engine:perf --update   # (or UPDATE_PERF_BASELINE=1) record this runner's key
 *   vp run engine:perf --json     # also write engine-perf.json
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  generateLargeScene,
  generateTilemapScene,
  LARGE_5K,
  tilemapProject,
} from "../packages/engine/__tests__/fixtures/generate-scene";
import {
  RTS_PERF_GAME,
  rtsPerfScript,
  rtsProject,
  rtsScene,
} from "../packages/engine/__tests__/genres/rts.probe";
import type { GameDefinition } from "../packages/engine/game/types";
import type { InputScript } from "../packages/engine/headless/playtest-types";
import type { ProjectRuntimeView } from "../packages/engine/project/runtime-view";
import type { SceneDefinition } from "../packages/engine/scene/types";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** Re-exported so scripts/scene tests can build the same scenes without reaching into the engine. */
export { generateLargeScene };

export const BASELINE_PATH = join(REPO, "packages/engine/__tests__/perf/baseline.json");
export const REPORT_PATH = join(REPO, "engine-perf.json");

export const FAIL_RATIO = 0.8;
export const WARN_RATIO = 0.9;

export type PerfCase = {
  id: "kitchen-sink" | "large-5k" | (string & {});
  /** A project scene's id, or a generated scene the runner writes to a file. */
  scene: string | (() => SceneDefinition);
  /** The in-memory project a generated scene loads against (its tilesets and textures); played without the CLI. */
  project?: () => ProjectRuntimeView;
  /** The game a generated scene plays under; default the scene's own, as the CLI resolves it. */
  game?: GameDefinition;
  /** What the run plays, warm-up included, `warmup + ticks` long; default waiting. */
  script?: (ticks: number) => InputScript;
  ticks: 600;
  runs: 5;
};

/** Ticks each run plays first and leaves out, so JIT warm-up isn't in the median. */
export const PERF_WARMUP_TICKS = 60;

export type PerfBaseline = Readonly<
  Record<`${string}/${string}`, Readonly<Record<string, { ticksPerSecond: number; at: string }>>>
>;

/** Every case, one row each. */
export const PERF_CASES: readonly PerfCase[] = [
  { id: "kitchen-sink", scene: "kitchen-sink", ticks: 600, runs: 5 },
  { id: "large-5k", scene: () => generateLargeScene(1, LARGE_5K), ticks: 600, runs: 5 },
  {
    id: "large-5k-geometry",
    scene: () => generateLargeScene(1, LARGE_5K, "none"),
    ticks: 600,
    runs: 5,
  },
  {
    id: "tilemap-512",
    scene: () => generateTilemapScene(1),
    project: tilemapProject,
    ticks: 600,
    runs: 5,
  },
  {
    id: "rts-500",
    scene: rtsScene,
    project: rtsProject,
    game: RTS_PERF_GAME,
    script: rtsPerfScript,
    ticks: 600,
    runs: 5,
  },
];

/** One run of a case: its ticks per second. */
export type PerfRunner = (c: PerfCase) => Promise<number>;

export type PerfVerdict = "pass" | "warn" | "fail" | "new";

export type PerfResult = {
  id: string;
  samples: number[];
  median: number;
  baseline: number | null;
  /** `median / baseline`; null with no baseline. */
  ratio: number | null;
  verdict: PerfVerdict;
};

export type PerfReport = { key: string; results: PerfResult[]; ok: boolean; updated: boolean };

type RuntimeVersions = { node?: string; bun?: string };

export const runnerKey = (
  arch: string = process.arch,
  versions: RuntimeVersions = process.versions,
): `${string}/${string}` =>
  versions.bun
    ? `${arch}/bun${versions.bun.split(".")[0]}`
    : `${arch}/node${(versions.node ?? "0").split(".")[0]}`;

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return 0;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A median against its baseline, or `new` when there is none. */
export function judge(value: number, baseline: number | null): PerfVerdict {
  if (baseline === null || !(baseline > 0)) return "new";
  const ratio = value / baseline;
  return ratio < FAIL_RATIO ? "fail" : ratio < WARN_RATIO ? "warn" : "pass";
}

export function resultLine(r: PerfResult, key: string): string {
  const tps = `${Math.round(r.median)} ticks/s`;
  if (r.verdict === "new") return `notice ${r.id}: ${tps}; no baseline for ${key}, passing`;
  const pct = `${Math.round(r.ratio! * 100)}% of ${Math.round(r.baseline!)}`;
  return `${r.verdict === "pass" ? "ok" : r.verdict} ${r.id}: ${tps}, ${pct}`;
}

export type PerfOptions = {
  runner: PerfRunner;
  cases?: readonly PerfCase[];
  baseline: PerfBaseline;
  key?: string;
  update?: boolean;
  now?: () => Date;
  log?: (line: string) => void;
};

/** Runs every case and judges it; with `update`, the returned baseline holds this runner's medians. */
export async function runPerf(
  opts: PerfOptions,
): Promise<{ report: PerfReport; baseline: PerfBaseline }> {
  const key = opts.key ?? runnerKey();
  const log = opts.log ?? (() => {});
  const known = opts.baseline[key as `${string}/${string}`] ?? null;
  if (!known && !opts.update) log(`notice: no baseline for ${key}; every case passes`);
  const results: PerfResult[] = [];
  for (const c of opts.cases ?? PERF_CASES) {
    const samples: number[] = [];
    for (let i = 0; i < c.runs; i++) samples.push(await opts.runner(c));
    const m = median(samples);
    const base = known?.[c.id]?.ticksPerSecond ?? null;
    const result: PerfResult = {
      id: c.id,
      samples,
      median: m,
      baseline: base,
      ratio: base && base > 0 ? m / base : null,
      verdict: judge(m, base),
    };
    results.push(result);
    log(resultLine(result, key));
  }
  let baseline = opts.baseline;
  if (opts.update) {
    const at = (opts.now?.() ?? new Date()).toISOString();
    baseline = {
      ...opts.baseline,
      [key]: Object.fromEntries(
        results.map((r) => [r.id, { ticksPerSecond: Math.round(r.median), at }]),
      ),
    };
    log(`updated the baseline for ${key}`);
  }
  const ok = opts.update || results.every((r) => r.verdict !== "fail");
  return { report: { key, results, ok, updated: opts.update === true }, baseline };
}

/**
 * The real runner: `scene stats` on the case's scene, a generated one written
 * to a file first. A case with its own project has no file a project holds,
 * so it goes to the same `runStats` the CLI calls, with that project.
 */
async function cliRunner(): Promise<{ runner: PerfRunner; close(): Promise<void> }> {
  const { defaultToolContext } = await import("./scene/default-context");
  const { stats } = await import("./scene/tools/stats");
  const { runStats } = await import("@jams/engine/headless");
  const ctx = await defaultToolContext();
  const dir = await mkdtemp(join(tmpdir(), "engine-perf-"));
  const files = new Map<string, string>();
  const scenes = new Map<string, SceneDefinition>();
  return {
    async runner(c) {
      if (c.project && typeof c.scene === "function") {
        let def = scenes.get(c.id);
        if (!def) scenes.set(c.id, (def = c.scene()));
        const ticks = PERF_WARMUP_TICKS + c.ticks;
        const report = await runStats({
          rapier: await ctx.loadRapier(),
          ...(c.game ? { game: c.game } : {}),
          scene: def,
          project: c.project(),
          script: c.script?.(ticks) ?? { v: 1, maxTicks: ticks, steps: [{ wait: ticks }] },
          ticks: c.ticks,
          warmup: PERF_WARMUP_TICKS,
        });
        return report.wall.ticksPerSecond;
      }
      let scene = typeof c.scene === "string" ? c.scene : files.get(c.id);
      if (scene === undefined && typeof c.scene === "function") {
        scene = join(dir, `${c.id}.json`);
        await writeFile(scene, JSON.stringify(c.scene()));
        files.set(c.id, scene);
      }
      const r = await stats({ scene, ticks: String(c.ticks), warmup: PERF_WARMUP_TICKS }, ctx);
      if (r.exitCode !== 0) throw new Error(`${c.id}: ${r.text}`);
      return (r.data as { wall: { ticksPerSecond: number } }).wall.ticksPerSecond;
    },
    close: () => rm(dir, { recursive: true, force: true }),
  };
}

/** What CI prints when the baseline has no key for its runner: the job then checks nothing. */
export function missingKeyNotice(key: string): string {
  const rule = "=".repeat(72);
  return [
    rule,
    `engine:perf: NO BASELINE for ${key}. Every case passes, so this job checks nothing.`,
    `Record one from this job's engine-perf.json, or run \`vp run engine:perf --update\` on ${key}.`,
    rule,
  ].join("\n");
}

export async function readBaseline(path = BASELINE_PATH): Promise<PerfBaseline> {
  return JSON.parse(await readFile(path, "utf8")) as PerfBaseline;
}

export async function main(
  argv: readonly string[],
  env: Record<string, string | undefined> = process.env,
  deps: { runner?: PerfRunner; baselinePath?: string; reportPath?: string } = {},
): Promise<number> {
  const update = argv.includes("--update") || env.UPDATE_PERF_BASELINE === "1";
  const json = argv.includes("--json");
  const baselinePath = deps.baselinePath ?? BASELINE_PATH;
  const real = deps.runner ? null : await cliRunner();
  try {
    const known = await readBaseline(baselinePath);
    const key = runnerKey();
    if (env.CI && !update && !known[key]) console.error(missingKeyNotice(key));
    const { report, baseline } = await runPerf({
      runner: deps.runner ?? real!.runner,
      baseline: known,
      key,
      update,
      log: (line) => console.log(line),
    });
    if (update) await writeFile(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
    if (json)
      await writeFile(deps.reportPath ?? REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
    if (!report.ok)
      console.error(`engine:perf: a case fell below ${FAIL_RATIO * 100}% of its baseline`);
    return report.ok ? 0 : 1;
  } finally {
    await real?.close();
  }
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
