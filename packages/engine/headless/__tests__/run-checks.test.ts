// @vitest-environment node
import { readFileSync } from "node:fs";

import { beforeAll, describe, expect, it } from "vite-plus/test";

import { checkedTestGame, GOAL_EVENT } from "../../__tests__/fixtures/test-game";
import { createRegistry } from "../../game/define";
import { INPUT_MAP_KIND, INPUT_MAP_VERSION } from "../../project/kinds/input-map";
import type { ProjectRuntimeView } from "../../project/runtime-view";
import { parseChecks, type ChecksFile, type SceneCheck } from "../../scene/checks";
import { parseSceneOrThrow } from "../../scene/parse";
import type { SceneDefinition, SceneIssue } from "../../scene/types";
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
      solid: [["box", 0.2, 5, 0.2, 5]],
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

  it("runs without Rapier: a scene without physics passes, a Rapier one fails its physical check", () => {
    const checks = file([{ id: "physical", kind: "valid", physical: true }], engine);
    const bare = (scene: SceneDefinition) =>
      runChecks({ scene, registry: engine, checks, readFile: () => "" }).results[0];
    const free: SceneDefinition = { ...yard, entities: [], settings: { physics: "none" } };
    expect(bare(free)).toMatchObject({ pass: true });
    expect(bare(yard)).toMatchObject({
      pass: false,
      message: expect.stringContaining("needs physics"),
    });
  });

  it("plays reaches and touches under the project's engine block", () => {
    const checks = file(
      [
        {
          id: "ends",
          kind: "reaches",
          result: "script-end",
          script: { v: 1, steps: [{ wait: 10 }] },
        },
        { id: "start", kind: "touches", entity: "start", atLeast: 1, rollouts: 2, ticks: 10 },
      ],
      engine,
    );
    const scene: SceneDefinition = {
      ...yard,
      entities: [{ id: "start", type: "marker", at: [100, 100], tags: ["spawn"] }],
    };
    const project = {
      settings: {},
      engine: { physics: "none" },
      table: () => [],
      asset: () => undefined,
      inputMap: null,
    };
    const played = runChecks({ scene, registry: engine, checks, readFile: () => "", project });
    expect(played.results[0]).toMatchObject({ pass: true });
    expect(played.results[1]!.message).toBe("start touched in 0 of 2 rollouts; needs 1");
    const bare = runChecks({ scene, registry: engine, checks, readFile: () => "" });
    expect(bare.results.map((r) => r.message)).toEqual([
      expect.stringContaining("blocked at load"),
      expect.stringContaining("blocked at load"),
    ]);
  });

  it("runs a game's check kind with its parsed fields", () => {
    const checks: SceneCheck[] = file([
      { id: "two", kind: "test-game/props", atLeast: 2 },
      { id: "three", kind: "test-game/props", atLeast: 3 },
    ]).checks;
    const report = run({ v: 3, checks });
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
    const unknown = run({ v: 3, checks }, engine);
    expect(unknown.results[0]).toMatchObject({
      pass: false,
      message: 'unknown check kind "test-game/props"',
    });
  });
});

describe("a reaches check's expect", () => {
  const settle = { v: 1, steps: [{ wait: 60 }] } as const;
  const reaches = (expectClause: unknown, extra: Record<string, unknown> = {}) => ({
    id: "r",
    kind: "reaches",
    script: settle,
    result: "script-end",
    expect: expectClause,
    ...extra,
  });

  it("passes when every key holds on the last tick, with or without a game", () => {
    for (const registry of [engine, game]) {
      const [result] = run(
        file([reaches({ exists: "avatar", count: { type: "prop", eq: 2 }, tick: 59 })], registry),
        registry,
      ).results;
      expect(result).toMatchObject({ pass: true, detail: { expect: { failed: null } } });
      expect(result!.message).toBe("ended script-end at t59; expect holds (exists, count, tick)");
    }
  });

  it("judges count's bounds and a game's predicate on the last tick only", () => {
    const report = run(
      file([
        reaches({ count: { type: "prop", min: 2, max: 2 } }, { id: "between" }),
        reaches({ count: { type: ["prop", "sensor"], min: 3 } }, { id: "types" }),
        reaches({ count: { type: "prop", max: 1 } }, { id: "over" }),
        reaches({ count: { type: "prop", eq: 3 } }, { id: "eq" }),
        reaches({ tick: 60 }, { id: "late" }),
        {
          id: "goal",
          kind: "reaches",
          script: toGoal,
          result: "won",
          expect: { event: GOAL_EVENT, past: 800 },
        },
      ]),
    );
    expect(report.results.map((r) => [r.id, r.pass])).toEqual([
      ["between", true],
      ["types", true],
      ["over", false],
      ["eq", false],
      ["late", false],
      ["goal", true],
    ]);
    expect(report.results[2]!.message).toBe(
      'ended script-end at t59, but expect.count ({"type":"prop","max":1}) doesn\'t hold then',
    );
    expect(report.results[4]!.message).toBe(
      "ended script-end at t59, but expect.tick (60) doesn't hold then",
    );
  });

  it("names the first key that fails, in the order the check wrote them", () => {
    const report = run(
      file([
        reaches({ tick: 0, exists: "nobody", count: { type: "prop", eq: 0 } }, { id: "a" }),
        reaches({ count: { type: "prop", eq: 0 }, exists: "nobody" }, { id: "b" }),
      ]),
    );
    expect(report.results.map((r) => r.pass)).toEqual([false, false]);
    expect(report.results[0]!.message).toContain('expect.exists ("nobody")');
    expect(report.results[0]!.detail).toMatchObject({ expect: { failed: "exists" } });
    expect(report.results[1]!.message).toContain("expect.count (");
  });

  it("fails on the result first, and on an expect the registry can't read", () => {
    const checks = [
      reaches({ exists: "avatar" }, { id: "result", result: "timeout" }),
      reaches({ past: 300 }, { id: "gameless" }),
    ] as SceneCheck[];
    const report = run({ v: 3, checks }, engine);
    expect(report.results[0]!.message).toBe("ended script-end at t59, not timeout");
    expect(report.results[1]).toMatchObject({ pass: false });
    expect(report.results[1]!.message).toMatch(/^bad expect: /);
  });
});

describe("the connected check", () => {
  /** A 5 × 5 grid of 100 px cells; a solid fills column 2 down to `wallTo`. */
  const walled = (wallTo: number, grid = true): SceneDefinition => ({
    v: 1,
    name: "maze",
    bounds: [0, 0, 500, 500],
    settings: { physics: "none", ...(grid ? { grid: { kind: "square", cell: [100, 100] } } : {}) },
    solid: [["box", 250, wallTo / 2, 50, wallTo / 2]],
    entities: [
      { id: "start", type: "marker", at: [50, 250], tags: ["spawn"] },
      { id: "exit", type: "marker", at: [450, 250] },
      { id: "near", type: "marker", at: [150, 50] },
    ],
  });
  const connected = (check: Record<string, unknown>) =>
    file([{ id: "joined", kind: "connected", from: "start", to: ["exit"], ...check }], engine);
  const check = (scene: SceneDefinition, checks: ChecksFile) =>
    runChecks({ rapier: null, scene, registry: engine, checks, readFile: () => "" });

  it("passes through a gap in the wall, with no Rapier", () => {
    const report = check(walled(400), connected({ to: ["exit", "near", [4, 0]] }));
    expect(report.ok).toBe(true);
    expect(report.results[0]).toMatchObject({
      pass: true,
      message: "start [0, 2] reaches 3 targets on the grid",
      detail: {
        paths: [
          { to: "exit [4, 2]", steps: 8, cost: 80 },
          { to: "near [1, 0]", steps: 3, cost: 30 },
          { to: "[4, 0]", steps: 10, cost: 100 },
        ],
      },
    });
  });

  it("fails with one grid-unreachable per target no path reaches, naming the entity", () => {
    const scene = walled(500);
    const report = check(scene, connected({ to: ["exit", "near", [3, 3]] }));
    const [result] = report.results;
    expect(result!.pass).toBe(false);
    expect(result!.message).toBe(
      "2 of 3 targets unreachable from start [0, 2]; first: no path on the grid from start [0, 2] to exit [4, 2]",
    );
    const { issues } = result!.detail as { issues: SceneIssue[] };
    expect(issues).toEqual([
      expect.objectContaining({
        code: "grid-unreachable",
        severity: "error",
        entityIds: ["exit"],
        path: "/entities/1",
        line: expect.any(Number),
        at: [450, 250],
      }),
      expect.objectContaining({ code: "grid-unreachable", entityIds: [], at: [350, 350] }),
    ]);
    expect(issues[0]!.hint!.length).toBeGreaterThan(0);
  });

  it("walls with blockedBy's types instead of solids", () => {
    const plugged: SceneDefinition = {
      ...walled(400),
      entities: [
        ...walled(400).entities!,
        { id: "plug", type: "sensor", shape: ["box", 250, 450, 50, 50] },
      ],
    };
    const walls = (blockedBy?: string[]) =>
      check(plugged, connected(blockedBy ? { blockedBy } : {})).ok;
    expect(walls()).toBe(true);
    expect(walls(["solid", "sensor"])).toBe(false);
    expect(walls(["sensor"])).toBe(true);
    expect(check(walled(500), connected({ blockedBy: [] })).ok).toBe(true);
    expect(check(walled(500), connected({ blockedBy: ["marker"] })).ok).toBe(true);
  });

  it("takes diagonals when asked, never past a wall's corner", () => {
    const diagonal = (scene: SceneDefinition, diagonals: boolean) =>
      check(
        scene,
        file([{ id: "d", kind: "connected", from: [0, 0], to: [[1, 1]], diagonals }], engine),
      ).results[0]!.detail;
    const open: SceneDefinition = { ...walled(400), solid: [] };
    expect(diagonal(open, true)).toEqual({ paths: [{ to: "[1, 1]", steps: 1, cost: 14 }] });
    expect(diagonal(open, false)).toEqual({ paths: [{ to: "[1, 1]", steps: 2, cost: 20 }] });
    const corner: SceneDefinition = { ...open, solid: [["box", 150, 50, 50, 50]] };
    expect(diagonal(corner, true)).toEqual({ paths: [{ to: "[1, 1]", steps: 2, cost: 20 }] });
  });

  it("is grid-invalid on a scene without a grid", () => {
    const report = check(walled(400, false), connected({}));
    const [result] = report.results;
    expect(result!.pass).toBe(false);
    expect((result!.detail as { issues: SceneIssue[] }).issues).toEqual([
      expect.objectContaining({ code: "grid-invalid", severity: "error", path: "/settings/grid" }),
    ]);
  });

  it("fails on a ref the scene doesn't load", () => {
    const report = check(walled(400), connected({ to: ["gone"] }));
    expect(report.results[0]).toMatchObject({
      pass: false,
      message: "no loaded entity gone in maze",
    });
  });
});

describe("runChecks seats", () => {
  const withSeats = (max: number): ProjectRuntimeView => ({
    settings: {},
    engine: {},
    table: () => [],
    asset: () => undefined,
    inputMap: { kind: INPUT_MAP_KIND, v: INPUT_MAP_VERSION, players: { max, join: "auto" } },
  });
  const twoSeats = {
    v: 2,
    scene: "engine-yard",
    tracks: [
      { player: 0, steps: toGoal.steps },
      { player: 1, steps: [{ wait: 2 }] },
    ],
  };
  const checks = file([
    { id: "inline", kind: "reaches", script: twoSeats, result: "won" },
    { id: "file", kind: "reaches", script: "two-seats.json", result: "won" },
  ]);
  const runWith = (project?: ProjectRuntimeView) =>
    runChecks({
      rapier,
      scene: yard,
      registry: game,
      checks,
      readFile: () => JSON.stringify(twoSeats),
      ...(project ? { project } : {}),
    });

  it("plays inline and file scripts on the seats the project input map gives", () => {
    expect(runWith(withSeats(2)).results.map((r) => [r.id, r.pass])).toEqual([
      ["inline", true],
      ["file", true],
    ]);
    for (const report of [runWith(), runWith(withSeats(1))]) {
      expect(report.results.map((r) => r.message)).toEqual([
        expect.stringContaining("blocked at script"),
        expect.stringContaining("blocked at script"),
      ]);
    }
  });
});
