// @vitest-environment node
import { readFileSync } from "node:fs";

import { beforeAll, describe, expect, it } from "vite-plus/test";

import { checkedTestGame, GOAL_EVENT } from "../../__tests__/fixtures/test-game";
import { createRegistry } from "../../game/define";
import { parseChecks, type ChecksFile, type SceneCheck } from "../../scene/checks";
import { parseSceneOrThrow } from "../../scene/parse";
import type { SceneDefinition } from "../../scene/types";
import type { RapierModule } from "../../types";
import { runChecks } from "../run-checks";

const engine = createRegistry();
const game = createRegistry(checkedTestGame);
const yard: SceneDefinition = parseSceneOrThrow(
  readFileSync(new URL("../../scenes/engine-yard.json", import.meta.url), "utf8"),
  game,
);
const yardChecks = readFileSync(
  new URL("../../scenes/engine-yard.checks.json", import.meta.url),
  "utf8",
);

let rapier: RapierModule;

beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

const toGoal = {
  v: 1,
  scene: "engine-yard",
  steps: [{ hold: ["right"], until: { event: GOAL_EVENT }, max: 600 }],
} as const;

function file(checks: unknown[], registry = game): ChecksFile {
  const r = parseChecks(JSON.stringify({ v: 1, checks }), registry);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.file;
}

const run = (checks: ChecksFile, registry = game, files: Record<string, string> = {}) =>
  runChecks({
    rapier,
    scene: yard,
    registry,
    checks,
    readFile: (path) => {
      if (!(path in files)) throw new Error(`ENOENT: ${path}`);
      return files[path]!;
    },
  });

describe("runChecks on engine-yard", () => {
  it("passes the committed checks, with or without the test game", () => {
    for (const registry of [engine, game]) {
      const parsed = parseChecks(yardChecks, registry);
      if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
      const report = run(parsed.file, registry);
      expect(report.results.map((r) => [r.id, r.pass])).toEqual([
        ["valid", true],
        ["settles", true],
        ["times-out", true],
      ]);
      expect(report.ok).toBe(true);
    }
  });

  it("passes a script that reaches the goal, read from a file, and fails one that falls short", () => {
    const report = run(
      file([
        { id: "win", kind: "reaches", script: "to-goal.json", result: "won" },
        {
          id: "short",
          kind: "reaches",
          script: { ...toGoal, maxTicks: 30 },
          result: "won",
        },
      ]),
      game,
      { "to-goal.json": JSON.stringify(toGoal) },
    );
    expect(report.ok).toBe(false);
    expect(report.results[0]).toMatchObject({ id: "win", pass: true });
    expect(report.results[0]!.message).toMatch(/^ended won at t\d+ \(reached the goal\)$/);
    expect(report.results[1]).toMatchObject({ id: "short", pass: false });
    expect(report.results[1]!.message).toMatch(/^ended timeout at t29, not won$/);
  });

  it("fails a blocked run, an unreadable script and a start inside a solid", () => {
    const report = run(
      file([
        { id: "gone", kind: "reaches", script: "missing.json", result: "won" },
        {
          id: "bad",
          kind: "reaches",
          script: { v: 1, steps: [{ hold: ["fly"], for: 1 }] },
          result: "won",
        },
        { id: "wall", kind: "reaches", script: toGoal, result: "won", at: [20, 500] },
      ]),
    );
    expect(report.results.map((r) => r.pass)).toEqual([false, false, false]);
    expect(report.results[0]!.message).toContain("can't read script missing.json");
    expect(report.results[1]!.message).toMatch(/^blocked at script: unknown action "fly"/);
    expect(report.results[2]!.message).toMatch(/^blocked at load: can't start inside a solid/);
  });

  it("counts the fuzz rollouts that touch an entity", () => {
    const report = run(
      file([
        {
          id: "zone",
          kind: "touches",
          entity: "zone",
          atLeast: 1,
          rollouts: 8,
          seed: 1,
          ticks: 300,
        },
        {
          id: "zone-all",
          kind: "touches",
          entity: "zone",
          atLeast: 8,
          rollouts: 8,
          seed: 1,
          ticks: 300,
        },
        { id: "ghost", kind: "touches", entity: "ghost", atLeast: 1, rollouts: 2 },
      ]),
    );
    const [some, all, ghost] = report.results;
    expect(some).toMatchObject({ pass: true, detail: { rollouts: 8, seed: 1 } });
    const reached = (some!.detail as { reached: number }).reached;
    expect(reached).toBeGreaterThan(0);
    expect(all!.pass).toBe(reached === 8);
    expect(ghost).toMatchObject({ pass: false, message: "no loaded entity ghost in engine-yard" });
  });

  it("fails `valid` at a lower bar, and skips a check with `skip`", () => {
    const report = run(
      file([
        { id: "strict", kind: "valid", physical: true, max: "warn" },
        { id: "later", kind: "valid", max: "warn", skip: "until the note is gone" },
      ]),
    );
    // The yard's only physical issues are info, so `warn` passes; tightening needs a warning.
    expect(report.results[0]).toMatchObject({ pass: true });
    expect(report.results[1]).toMatchObject({ pass: true, skipped: "until the note is gone" });

    const floating: SceneDefinition = {
      ...yard,
      solid: [["box", 20, 500, 20, 500]],
    };
    const physical = runChecks({
      rapier,
      scene: floating,
      registry: game,
      checks: file([
        { id: "structural", kind: "valid", max: "warn" },
        { id: "physical", kind: "valid", physical: true, max: "warn" },
      ]),
      readFile: () => "",
    });
    expect(physical.results.map((r) => r.pass)).toEqual([true, false]);
    expect(physical.results[1]!.message).toContain("test-game/avatar-floating");
  });

  it("runs a game's check kind with its parsed fields", () => {
    const checks: SceneCheck[] = file([
      { id: "two", kind: "test-game/props", atLeast: 2 },
      { id: "three", kind: "test-game/props", atLeast: 3 },
    ]).checks;
    const report = run({ v: 1, checks });
    expect(report.results).toEqual([
      { id: "two", kind: "test-game/props", pass: true, message: "2 props", detail: { props: 2 } },
      {
        id: "three",
        kind: "test-game/props",
        pass: false,
        message: "2 props",
        detail: { props: 2 },
      },
    ]);
    const unknown = run({ v: 1, checks }, engine);
    expect(unknown.results[0]).toMatchObject({
      pass: false,
      message: 'unknown check kind "test-game/props"',
    });
  });
});
