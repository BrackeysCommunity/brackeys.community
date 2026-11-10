// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { createRegistry, type GameDefinition } from "@jams/engine/game";
import { createHeadlessRuntime, runPlaytest, type PlaytestReport } from "@jams/engine/headless";
import { expandScene } from "@jams/engine/scene";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  GATE,
  GOAL,
  gridGame,
  gridScene,
  gridScript,
  physicsFreeDigest,
  rapierSpy,
  runPhysicsFree,
  WALKER,
} from "../browser/physics-free";
import { REPO } from "../pack";

const init = vi.hoisted(() => vi.fn());
vi.mock("@dimforge/rapier2d-compat", () => ({ default: { init }, init }));

const BROWSER_DIR = join(REPO, "scripts/engine-smoke/browser");
const game = gridGame as GameDefinition;

const never = () =>
  rapierSpy(() => Promise.reject(new Error("the physics-free run loaded Rapier")));

describe("runPhysicsFree", () => {
  it("plays the grid scene to its goal with no physics and replays it, the same digest every time", async () => {
    const spy = never();
    const a = await runPhysicsFree(spy.load);
    const b = await runPhysicsFree(spy.load);
    expect(a).toMatchObject({ physics: "none", result: "won", replayMatches: true });
    expect(a.digest).toMatch(/^[0-9a-f]+$/);
    expect(b).toEqual(a);
    expect(spy.calls()).toBe(0);
    expect(init).not.toHaveBeenCalled();
  });

  it("asks its loader for Rapier once the scene resolves to it, so the count is a real spy", async () => {
    const spy = never();
    const rapier = {
      ...gridScene,
      settings: { ...gridScene.settings, physics: "rapier" as const },
    };
    await expect(runPhysicsFree(spy.load, rapier)).rejects.toThrow(/loaded Rapier/);
    expect(spy.calls()).toBe(1);
  });
});

describe("the grid scene", () => {
  const play = () =>
    runPlaytest({ rapier: null, game, scene: gridScene, script: gridScript }) as PlaytestReport<{
      cell: [number, number];
      refused: number;
    }>;

  it("walls off the solids' cells on the geometry backend", () => {
    const registry = createRegistry(game);
    const runtime = createHeadlessRuntime({
      rapier: null,
      game,
      registry,
      scene: expandScene(gridScene, registry),
    });
    try {
      runtime.step(1000 / 60, []);
      expect(runtime.ctx.space.backend).toBe("geometry");
      const grid = runtime.ctx.grid!;
      expect(grid.passable([2, 2])).toBe(false);
      expect(grid.passable([4, 3])).toBe(false);
      expect(grid.passable([4, 1])).toBe(true);
    } finally {
      runtime.destroy();
    }
  });

  it("refuses the two steps into walls and passes through the gate onto the goal", () => {
    const report = play();
    expect(report.blocked).toBe(false);
    expect(report.final).toMatchObject({ cell: [6, 1], refused: 2 });
    expect(report.events.map((e) => [e.type, e.entityId, e.other])).toEqual([
      ["sensor:enter", GATE, WALKER],
      ["sensor:exit", GATE, WALKER],
      ["sensor:enter", GOAL, WALKER],
    ]);
    expect(report.outcome).toMatchObject({ result: "won", entityId: GOAL });
  });

  it("keeps every solid and sensor axis-aligned, so the run replays alike in every JS engine", () => {
    const entities = gridScene.entities ?? [];
    expect(entities.length).toBeGreaterThan(0);
    for (const e of entities) {
      const shape = (e as { shape?: unknown }).shape;
      if (shape === undefined) continue;
      expect(shape, e.id).toEqual([
        "box",
        expect.any(Number),
        expect.any(Number),
        expect.any(Number),
        expect.any(Number),
      ]);
    }
  });
});

describe("physicsFreeDigest", () => {
  it("moves with the end state, the events and the trail", () => {
    const report = runPlaytest({
      rapier: null,
      game,
      scene: gridScene,
      script: gridScript,
    }) as PlaytestReport;
    const digest = physicsFreeDigest(report);
    expect(physicsFreeDigest(structuredClone(report))).toBe(digest);
    expect(physicsFreeDigest({ ...report, final: null })).not.toBe(digest);
    expect(physicsFreeDigest({ ...report, events: report.events.slice(1) })).not.toBe(digest);
    expect(
      physicsFreeDigest({ ...report, trail: { ...report.trail, pts: report.trail.pts.slice(1) } }),
    ).not.toBe(digest);
  });
});

describe("the browser pages", () => {
  const files = readdirSync(BROWSER_DIR, { recursive: true, encoding: "utf8" })
    .filter((f) => /\.(ts|tsx|html)$/.test(f))
    .map((f) => ({ name: f, text: readFileSync(join(BROWSER_DIR, f), "utf8") }));

  it("read pixels through the engine's public API, never Pixi's devtools hook or pixi.js itself", () => {
    expect(files.length).toBeGreaterThan(0);
    for (const { name, text } of files) {
      expect(text, name).not.toContain("__PIXI_APP_INIT__");
      expect(text, name).not.toMatch(/from\s+["']pixi\.js["']|import\(\s*["']pixi\.js["']\s*\)/);
    }
  });

  it("build the physics-free run from public entries only", () => {
    const text = readFileSync(join(BROWSER_DIR, "physics-free.ts"), "utf8");
    const sources = [...text.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]!);
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources)
      expect(source, source).toMatch(/^(@jams\/engine(\/[a-z-]+)?|\.\.?\/[\w./-]+)$/);
    expect(sources.some((s) => s.includes("src/engine") || s.includes("__tests__"))).toBe(false);
    expect(sources).not.toContain("@dimforge/rapier2d-compat");
    expect(sources).not.toContain("./run");
  });
});
