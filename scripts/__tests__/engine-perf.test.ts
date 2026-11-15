// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { runStats } from "../../packages/engine/headless/stats";
import type { SceneDefinition } from "../../packages/engine/scene/types";
import {
  BASELINE_PATH,
  main,
  median,
  PERF_CASES,
  runnerKey,
  runPerf,
  type PerfBaseline,
  type PerfCase,
  type PerfRunner,
} from "../engine-perf";

const KEY = "x64/node24";
const CASE: PerfCase = { id: "large-5k", scene: "large-5k", ticks: 600, runs: 5 };
const baseline: PerfBaseline = {
  [KEY]: { "large-5k": { ticksPerSecond: 1000, at: "2026-11-15" } },
};

/** Five runs around `tps`, so the median is exactly `tps`. */
const fake = (tps: number): PerfRunner => {
  const spread = [tps - 40, tps + 30, tps, tps - 10, tps + 50];
  let i = 0;
  return async () => spread[i++ % spread.length]!;
};

const judged = async (tps: number, key = KEY) =>
  (await runPerf({ runner: fake(tps), cases: [CASE], baseline, key })).report;

describe("runPerf", () => {
  it("fails a 25% drop", async () => {
    const report = await judged(750);
    expect(report.results[0]).toMatchObject({ verdict: "fail", median: 750, ratio: 0.75 });
    expect(report.ok).toBe(false);
  });

  it("fails just past a 20% drop and only warns just short of it", async () => {
    const past = await judged(790);
    expect(past.results[0]).toMatchObject({ verdict: "fail", ratio: 0.79 });
    expect(past.ok).toBe(false);
    const short = await judged(810);
    expect(short.results[0]).toMatchObject({ verdict: "warn", ratio: 0.81 });
    expect(short.ok).toBe(true);
  });

  it("warns at a 15% drop and still passes", async () => {
    const report = await judged(850);
    expect(report.results[0]!.verdict).toBe("warn");
    expect(report.ok).toBe(true);
  });

  it("passes at the baseline", async () => {
    expect((await judged(990)).results[0]!.verdict).toBe("pass");
  });

  it("passes a runner key with no baseline, and a case missing under a key, with a notice", async () => {
    const lines: string[] = [];
    const { report } = await runPerf({
      runner: fake(10),
      cases: [CASE],
      baseline,
      key: "arm64/node26",
      log: (l) => lines.push(l),
    });
    expect(report.ok).toBe(true);
    expect(report.results[0]!.verdict).toBe("new");
    expect(lines.join("\n")).toContain("no baseline for arm64/node26");

    const other = await runPerf({
      runner: fake(10),
      cases: [{ ...CASE, id: "kitchen-sink" }],
      baseline,
      key: KEY,
    });
    expect(other.report.results[0]!.verdict).toBe("new");
    expect(other.report.ok).toBe(true);
  });

  it("passes a new case under a present key with a notice, and still judges the rest", async () => {
    const lines: string[] = [];
    const { report } = await runPerf({
      runner: fake(500),
      cases: [CASE, { ...CASE, id: "tilemap-512" }],
      baseline,
      key: KEY,
      log: (l) => lines.push(l),
    });
    expect(report.results.map((r) => r.verdict)).toEqual(["fail", "new"]);
    expect(lines[1]).toBe(`notice tilemap-512: 500 ticks/s; no baseline for ${KEY}, passing`);
    expect(lines.join("\n")).not.toContain("every case passes");
  });

  it("--update writes this runner's key and keeps the others", async () => {
    const { baseline: next, report } = await runPerf({
      runner: fake(700),
      cases: [CASE],
      baseline,
      key: "arm64/node26",
      update: true,
      now: () => new Date("2026-11-15T00:00:00Z"),
    });
    expect(report.ok).toBe(true);
    expect(next).toEqual({
      ...baseline,
      "arm64/node26": { "large-5k": { ticksPerSecond: 700, at: "2026-11-15T00:00:00.000Z" } },
    });
  });
});

describe("main", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "engine-perf-test-"));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("writes the baseline with --update (or UPDATE_PERF_BASELINE=1) and the report with --json", async () => {
    const baselinePath = join(dir, "baseline.json");
    const reportPath = join(dir, "engine-perf.json");
    await writeFile(baselinePath, "{}\n");
    const deps = { runner: fake(500), baselinePath, reportPath };
    expect(await main(["--json"], {}, deps)).toBe(0);
    expect(JSON.parse(await readFile(baselinePath, "utf8"))).toEqual({});
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    expect(report.key).toBe(runnerKey());
    expect(report.results).toHaveLength(PERF_CASES.length);

    expect(await main([], { UPDATE_PERF_BASELINE: "1" }, deps)).toBe(0);
    const written = JSON.parse(await readFile(baselinePath, "utf8"));
    expect(Object.keys(written[runnerKey()])).toEqual(PERF_CASES.map((c) => c.id));

    expect(await main([], {}, { ...deps, runner: fake(300) })).toBe(1);
  });
});

describe("the cases and the committed baseline", () => {
  it("runs the kitchen sink, large-5k, its physics-free twin, tilemap-512 and rts-500, 600 ticks five times", () => {
    expect(PERF_CASES.map((c) => c.id)).toEqual([
      "kitchen-sink",
      "large-5k",
      "large-5k-geometry",
      "tilemap-512",
      "rts-500",
    ]);
    for (const c of PERF_CASES) expect([c.ticks, c.runs]).toEqual([600, 5]);
  });

  it("plays tilemap-512 on a generated 512 × 512 map with its own tileset", () => {
    const c = PERF_CASES.find((p) => p.id === "tilemap-512")!;
    expect(typeof c.scene).toBe("function");
    const def = (c.scene as () => SceneDefinition)();
    const map = (def.entities ?? []).find((e) => e.type === "tilemap")!;
    const keys = Object.keys(map.cells as object);
    expect(keys).toHaveLength(256);
    expect(keys).toContain("15,15");
    const project = c.project!();
    expect(project.doc?.("tileset", map.tileset as string)).toMatchObject({ kind: "tileset" });
  });

  it("marches rts-500's 500 occupants across a tilemap for every measured tick", async () => {
    const c = PERF_CASES.find((p) => p.id === "rts-500")!;
    const def = (c.scene as () => SceneDefinition)();
    const ticks = 300;
    const report = await runStats({
      game: c.game!,
      scene: def,
      project: c.project!(),
      script: c.script!(ticks),
      ticks,
    });
    expect(report.ticks).toBe(ticks);
    expect(report.counts.behaviors.occupant).toBe(500);
    expect(report.counts.entities).toBe(501);
  });

  it("is a well-formed baseline", async () => {
    const committed = JSON.parse(await readFile(BASELINE_PATH, "utf8")) as Record<string, unknown>;
    for (const [key, cases] of Object.entries(committed)) {
      expect(key).toMatch(/^[a-z0-9_]+\/(node|bun)\d+$/);
      for (const entry of Object.values(cases as Record<string, { ticksPerSecond: number }>))
        expect(entry.ticksPerSecond).toBeGreaterThan(0);
    }
  });

  it("takes the median", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});
