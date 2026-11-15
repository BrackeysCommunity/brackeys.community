/**
 * The engine's speed budget: each case plays `ticks` ticks `runs` times
 * through `scene stats` and is judged on its median ticks per second against
 * this runner's baseline (`${arch}/node${major}`). Below 80% fails, below
 * 90% warns; a runner or case with no baseline passes with a notice.
 *
 *   vp run engine:perf            # judge against the baseline
 *   vp run engine:perf --update   # (or UPDATE_PERF_BASELINE=1) record this runner's key
 *   vp run engine:perf --json     # also write engine-perf.json
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { generateLargeScene } from "../packages/engine/__tests__/fixtures/generate-scene";
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
  ticks: 600;
  runs: 5;
};

export type PerfBaseline = Readonly<
  Record<`${string}/${string}`, Readonly<Record<string, { ticksPerSecond: number; at: string }>>>
>;

/** Every case, one row each. */
export const PERF_CASES: readonly PerfCase[] = [
  { id: "kitchen-sink", scene: "kitchen-sink", ticks: 600, runs: 5 },
  { id: "large-5k", scene: () => generateLargeScene(5000), ticks: 600, runs: 5 },
  {
    id: "large-5k-geometry",
    scene: () => generateLargeScene(5000, undefined, "none"),
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

export const runnerKey = (arch = process.arch, node = process.versions.node) =>
  `${arch}/node${node.split(".")[0]}` as const;

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

/** The real runner: `scene stats` on the case's scene, a generated one written to a file first. */
async function cliRunner(): Promise<{ runner: PerfRunner; close(): Promise<void> }> {
  const { defaultToolContext } = await import("./scene/default-context");
  const { stats } = await import("./scene/tools/stats");
  const ctx = await defaultToolContext();
  const dir = await mkdtemp(join(tmpdir(), "engine-perf-"));
  const files = new Map<string, string>();
  return {
    async runner(c) {
      let scene = typeof c.scene === "string" ? c.scene : files.get(c.id);
      if (scene === undefined && typeof c.scene === "function") {
        scene = join(dir, `${c.id}.json`);
        await writeFile(scene, JSON.stringify(c.scene()));
        files.set(c.id, scene);
      }
      const r = await stats({ scene, ticks: String(c.ticks) }, ctx);
      if (r.exitCode !== 0) throw new Error(`${c.id}: ${r.text}`);
      return (r.data as { wall: { ticksPerSecond: number } }).wall.ticksPerSecond;
    },
    close: () => rm(dir, { recursive: true, force: true }),
  };
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
    const { report, baseline } = await runPerf({
      runner: deps.runner ?? real!.runner,
      baseline: await readBaseline(baselinePath),
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
