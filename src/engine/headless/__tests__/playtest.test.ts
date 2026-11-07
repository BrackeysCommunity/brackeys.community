// @vitest-environment node
import { readFileSync } from "node:fs";

import { beforeAll, describe, expect, it } from "vite-plus/test";

import {
  AVATAR_SPEED,
  GOAL_EVENT,
  testGame,
  type TestGameOptions,
  type TestGameSnapshot,
} from "../../__tests__/fixtures/test-game";
import { createRegistry } from "../../game/define";
import { parseSceneOrThrow } from "../../scene/parse";
import type { SceneDefinition } from "../../scene/types";
import type { RapierModule } from "../../types";
import { compileInputScript } from "../compile-input-script";
import { STUCK_TICKS } from "../play-loop";
import { runPlaytest } from "../playtest";
import type { InputScript, PlaytestBlocked, PlaytestReport, PlaytestRun } from "../playtest-types";

const registry = createRegistry(testGame);
const text = readFileSync(new URL("../../scenes/engine-yard.json", import.meta.url), "utf8");
const yard: SceneDefinition = parseSceneOrThrow(text, registry);

let rapier: RapierModule;

beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

type Report = PlaytestReport<TestGameSnapshot>;

const play = (
  script: InputScript<TestGameOptions>,
  extra: { maxEvents?: number; maxTrail?: number } = {},
) => runPlaytest({ rapier, game: testGame, registry, scene: yard, script, ...extra });

function report(run: PlaytestRun<TestGameSnapshot>): Report {
  if (run.blocked) throw new Error(`blocked at ${run.stage}: ${JSON.stringify(run)}`);
  return run;
}

function blocked(run: PlaytestRun): PlaytestBlocked {
  if (!run.blocked) throw new Error(`ran: ${run.outcome.result}`);
  return run;
}

const toGoal: InputScript<TestGameOptions> = {
  v: 1,
  scene: "engine-yard",
  steps: [{ hold: ["right"], until: { event: GOAL_EVENT }, max: 600 }],
};

describe("runPlaytest", () => {
  it("walks the test game's avatar into the goal and reports the game's outcome", () => {
    const r = report(play(toGoal));
    expect(r.outcome).toMatchObject({ result: "won", cause: "reached the goal", entityId: "zone" });
    expect(r.outcome.tick).toBe(r.ticks - 1);
    expect(r.outcome.at!.x).toBeGreaterThan(800);
    expect(r.sceneHash).toMatch(/^[0-9a-f]{16}$/);
    expect(r.configHash).toMatch(/^[0-9a-f]{16}$/);
    expect(r.tickRate).toBe(60);
    expect(r.events).toContainEqual(
      expect.objectContaining({ type: GOAL_EVENT, entityId: "zone", tick: r.outcome.tick }),
    );
    expect(r.stepsReached).toBe(1);
    expect(r.steps).toEqual([{ index: 0, start: 0, ticks: r.ticks, end: "until" }]);
    expect(r.inputs).toEqual([[0, "right", 1]]);
    expect(r.final!.position.x).toBeCloseTo(r.outcome.at!.x);
    expect(r.trail.every).toBe(4);
    expect(r.trail.pts).toHaveLength(Math.ceil(r.ticks / 4));
    expect(r.trail.pts[0]).toEqual([expect.any(Number), expect.any(Number)]);
  });

  it("gives equal reports for equal runs", () => {
    expect(play(toGoal)).toEqual(play(toGoal));
  });

  it("caps events and the trail and says so", () => {
    const r = report(play(toGoal, { maxEvents: 1, maxTrail: 2 }));
    expect(r.events).toHaveLength(1);
    expect(r.truncated).toBe(true);
    expect(r.trail).toMatchObject({ truncated: true });
    expect(r.trail.pts).toHaveLength(2);
    const full = report(play(toGoal));
    expect(full.truncated).toBe(false);
    expect(full.trail.truncated).toBe(false);
  });

  it("ends as stuck when a movement action is held against a wall", () => {
    const r = report(play({ v: 1, steps: [{ hold: ["left"], for: 1000 }] }));
    expect(r.outcome.result).toBe("stuck");
    expect(r.outcome.cause).toContain("left");
    // The wall is 240px away: about 48 ticks of walking, then the stuck window.
    expect(r.ticks).toBeGreaterThan(STUCK_TICKS);
    expect(r.ticks).toBeLessThan(48 + STUCK_TICKS + 20);
    expect(r.steps).toEqual([{ index: 0, start: 0, ticks: r.ticks, end: "run" }]);
  });

  it("isn't stuck while waiting, and ends as script-end or timeout", () => {
    const waited = report(play({ v: 1, steps: [{ wait: 200 }] }));
    expect(waited.outcome.result).toBe("script-end");
    expect(waited.ticks).toBe(200);
    const capped = report(play({ v: 1, maxTicks: 50, steps: [{ wait: 200 }] }));
    expect(capped.outcome).toMatchObject({ result: "timeout", tick: 49 });
    expect(capped.ticks).toBe(50);
  });

  it("ends an until step on a tick, the game's predicate, or its max", () => {
    const r = report(
      play({
        v: 1,
        steps: [
          { hold: ["right"], until: { tick: 30 } },
          { wait: 10 },
          { hold: ["right"], until: { past: 500 } },
          { hold: ["left"], until: { past: 5000 }, max: 20 },
        ],
      }),
    );
    expect(r.outcome.result).toBe("script-end");
    const [a, b, c, d] = r.steps;
    expect(a).toEqual({ index: 0, start: 0, ticks: 31, end: "until" });
    expect(b).toEqual({ index: 1, start: 31, ticks: 10, end: "done" });
    expect(c).toMatchObject({ index: 2, start: 41, end: "until" });
    expect(d).toMatchObject({ index: 3, ticks: 20, end: "max" });
    expect(r.ticks).toBe(d!.start + 20);
    expect(r.inputs).toEqual([
      [0, "right", 1],
      [31, "right", 0],
      [41, "right", 1],
      [d!.start, "right", 0],
      [d!.start, "left", 1],
    ]);
  });

  it("matches events by type and entity ids", () => {
    const r = report(
      play({
        v: 1,
        steps: [
          {
            hold: ["right"],
            until: { event: { type: "sensor:enter", entityId: "zone", other: "avatar" } },
          },
          { wait: 1 },
        ],
      }),
    );
    expect(r.steps[0]!.end).toBe("until");
    const miss = report(
      play({
        v: 1,
        steps: [
          {
            hold: ["right"],
            until: { event: { type: "sensor:enter", entityId: "nope" } },
            max: 200,
          },
        ],
      }),
    );
    // The goal ends the run before `max`.
    expect(miss.outcome.result).toBe("won");
    expect(miss.steps[0]!.end).toBe("run");
  });

  it("plays a static script's compiled edges exactly", () => {
    const script: InputScript<TestGameOptions> = {
      v: 1,
      steps: [
        { hold: ["right"], forMs: 250 },
        { press: "push" },
        { hold: ["left", "push"], for: 5 },
        { wait: 3 },
      ],
    };
    const compiled = compileInputScript(script, registry);
    if (!compiled.ok) throw new Error("did not compile");
    const r = report(play(script));
    expect(r.inputs).toEqual(compiled.script.edges);
    expect(r.ticks).toBe(15 + 1 + 5 + 3);
    expect(
      report(runPlaytest({ rapier, game: testGame, scene: yard, script: compiled.script })),
    ).toEqual(r);
  });

  it("plays from `at`, cast onto the floor with the game's spawn shape", () => {
    const r = report(play({ v: 1, at: [600, 500], steps: [{ wait: 5 }] }));
    expect(r.final!.position.x).toBeCloseTo(600, 0);
    expect(r.final!.position.y).toBeCloseTo(940, 0);
    const walked = report(
      play({ v: 1, at: [600, 500], steps: [{ hold: ["right"], until: { event: GOAL_EVENT } }] }),
    );
    const fromSpawn = report(play(toGoal));
    expect(walked.outcome.result).toBe("won");
    expect(walked.ticks).toBeLessThan(fromSpawn.ticks);
    expect(walked.ticks).toBeCloseTo(((860 - 600 - 20) / AVATAR_SPEED) * 60, -1);
  });

  it("blocks a start inside a solid, a bad script, the wrong scene and a scene with errors", () => {
    const inside = blocked(play({ v: 1, at: [1000, 975], steps: [{ wait: 1 }] }));
    expect(inside.stage).toBe("load");
    expect(inside.load).toMatchObject({ ok: false, reason: "spawn-blocked" });

    const typo = blocked(play({ v: 1, steps: [{ hold: ["rigt"], for: 10 }] }));
    expect(typo.stage).toBe("script");
    expect(typo.scriptIssues[0]).toMatchObject({ path: "/steps/0/hold/0" });
    expect(typo.scriptIssues[0]!.message).toContain('did you mean "right"');

    const elsewhere = blocked(play({ ...toGoal, scene: "test-yard" }));
    expect(elsewhere.scriptIssues[0]).toMatchObject({ path: "/scene" });

    const broken = {
      ...yard,
      entities: [...(yard.entities ?? []), { ...yard.entities![0]!, type: "solid" }],
    };
    const errors = blocked(runPlaytest({ rapier, game: testGame, scene: broken, script: toGoal }));
    expect(errors.stage).toBe("scene");
    expect(errors.issues.some((i) => i.severity === "error")).toBe(true);
  });

  it("passes the script's game options to the game", () => {
    const pushed = report(play({ v: 1, steps: [{ press: "push" }, { wait: 10 }] }));
    const off = report(
      play({ v: 1, game: { push: false }, steps: [{ press: "push" }, { wait: 10 }] }),
    );
    expect(pushed.final!.position.y).toBeLessThan(off.final!.position.y - 1);
  });

  it("runs without a game, with no focus, trail or snapshot", () => {
    const engine = createRegistry();
    const r = runPlaytest({
      rapier,
      scene: parseSceneOrThrow(text, engine),
      script: { v: 1, steps: [{ wait: 30 }] },
    });
    expect(r).toMatchObject({
      blocked: false,
      final: null,
      outcome: { result: "script-end", at: null },
    });
    expect((r as PlaytestReport).trail.pts).toEqual([]);
  });
});
