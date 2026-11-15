// @vitest-environment node
import { performance } from "node:perf_hooks";

import { beforeAll, describe, expect, it } from "vite-plus/test";

import { createRegistry } from "../game/define";
import { createSceneRuntime } from "../runtime/runtime";
import { expandScene } from "../scene/expand";
import { parseScene } from "../scene/parse";
import { validateScene } from "../scene/validate";
import type { RapierModule } from "../types";
import {
  colliderCount,
  DEFAULT_COUNTS,
  generateScene,
  generateTilemapScene,
  TILEMAP_PROPS,
  tilemapProject,
} from "./fixtures/generate-scene";

const BUDGET_MS = 50;
const WARMUP_RUNS = 3;
const MEASURED_RUNS = 9;
/** The 512 × 512 map's merged tile colliders: its ledge runs and floor, cut at chunk edges. */
const TILEMAP_COLLIDER_BOUND = 1024;

const registry = createRegistry();
const def = generateScene(51);

let rapier: RapierModule;

beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

/** Expands, loads and destroys `scene` in a fresh headless runtime; returns the wall time and the loaded stats. */
function loadOnce(scene = def, project?: ReturnType<typeof tilemapProject>) {
  const start = performance.now();
  const runtime = createSceneRuntime({
    rapier,
    view: null,
    registry,
    ...(project ? { project } : {}),
  });
  const report = runtime.load(expandScene(scene, registry));
  const stats = runtime.stats();
  runtime.destroy();
  return { ms: performance.now() - start, report, stats };
}

const median = (xs: number[]) => {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

describe("generated scene", () => {
  it("is deterministic per seed", () => {
    expect(generateScene(51)).toEqual(def);
    expect(generateScene(52)).not.toEqual(def);
  });

  it("parses and validates against the engine registry", () => {
    const parsed = parseScene(JSON.stringify(def), registry);
    expect(parsed.ok ? [] : parsed.issues).toEqual([]);
    expect(validateScene(def, registry).filter((i) => i.severity === "error")).toEqual([]);
  });
});

describe("load budget", () => {
  it(`loads and destroys ${colliderCount(DEFAULT_COUNTS)} colliders in under ${BUDGET_MS}ms (median)`, () => {
    for (let i = 0; i < WARMUP_RUNS; i++) loadOnce();
    const runs = Array.from({ length: MEASURED_RUNS }, () => loadOnce());

    for (const { report, stats } of runs) {
      expect(report.ok).toBe(true);
      expect(stats.colliders).toBe(colliderCount(DEFAULT_COUNTS));
    }
    expect(median(runs.map((r) => r.ms))).toBeLessThan(BUDGET_MS);
  });
});

describe("tilemap-512", () => {
  const map = generateTilemapScene(1);
  const project = tilemapProject();

  it("is deterministic per seed and validates against the engine registry", () => {
    expect(generateTilemapScene(1)).toEqual(map);
    expect(generateTilemapScene(2)).not.toEqual(map);
    const parsed = parseScene(JSON.stringify(map), registry);
    expect(parsed.ok ? [] : parsed.issues).toEqual([]);
  });

  it(`loads a 512 × 512 map in under ${BUDGET_MS}ms (median) with a bounded collider count`, () => {
    for (let i = 0; i < WARMUP_RUNS; i++) loadOnce(map, project);
    const runs = Array.from({ length: MEASURED_RUNS }, () => loadOnce(map, project));

    for (const { report, stats } of runs) {
      expect(report.ok ? null : report.error).toBeNull();
      // Merged runs: a handful of boxes per chunk, never one per solid cell.
      expect(stats.colliders - TILEMAP_PROPS).toBeGreaterThan(0);
      expect(stats.colliders - TILEMAP_PROPS).toBeLessThanOrEqual(TILEMAP_COLLIDER_BOUND);
    }
    expect(median(runs.map((r) => r.ms))).toBeLessThan(BUDGET_MS);
  });
});
