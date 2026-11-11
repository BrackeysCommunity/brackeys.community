// @vitest-environment node
import { readFileSync } from "node:fs";

import { beforeAll, describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import {
  AVATAR_SPEED,
  GOAL_EVENT,
  NUDGE,
  testGame,
  type TestGameOptions,
  type TestGameSnapshot,
} from "../../__tests__/fixtures/test-game";
import { createRegistry, defineGame } from "../../game/define";
import { hashText } from "../../scene/hash";
import { parseSceneOrThrow } from "../../scene/parse";
import { prefabLibrary } from "../../scene/prefab";
import type { Prefab, SceneDefinition } from "../../scene/types";
import type { RapierModule } from "../../types";
import { ENGINE_VERSION } from "../../version";
import { compileInputScript } from "../compile-input-script";
import { prepareRun, runLoop, slotWakes, startRun, STUCK_TICKS } from "../play-loop";
import { runPlaytest } from "../playtest";
import type {
  InputEdge,
  InputScript,
  PlaytestBlocked,
  PlaytestReport,
  PlaytestRun,
} from "../playtest-types";

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

describe("runPlaytest with commands", () => {
  it("reports the commands it stepped beside the inputs, and the game acts on them", () => {
    const steps: InputScript["steps"] = [
      { hold: ["right"], for: 5 },
      { command: NUDGE, args: { dx: 60 } },
      { hold: ["right"], for: 5 },
    ];
    const r = report(play({ v: 1, steps }));
    expect(r.commands).toEqual([[5, NUDGE, { dx: 60 }]]);
    expect(r.inputs).toEqual([[0, "right", 1]]);
    expect(r.ticks).toBe(11);
    expect(r.steps[1]).toEqual({ index: 1, start: 5, ticks: 1, end: "done" });
    const walked = report(play({ v: 1, steps: [{ hold: ["right"], for: 11 }] }));
    expect(r.final!.position.x - walked.final!.position.x).toBeCloseTo(60, 0);
    expect(report(play(toGoal)).commands).toEqual([]);
  });

  it("sends @elapsed for an elapse step, clamped to catchUp.maxMs, and wakes a turns game", () => {
    const away = { ...testGame, time: { kind: "turns" as const, catchUp: { maxMs: 1000 } } };
    const r = report(
      runPlaytest({
        rapier,
        game: away,
        scene: yard,
        script: {
          v: 1,
          steps: [
            { hold: ["right"], for: 4 },
            { elapse: 250 },
            { wait: 3 },
            { elapse: 60_000 },
            { command: NUDGE, args: { dx: 2 } },
          ],
        },
      }),
    );
    expect(r.commands).toEqual([
      [0, "@elapsed", { ms: 250 }],
      [1, "@elapsed", { ms: 1000 }],
      [2, NUDGE, { dx: 2 }],
    ]);
    expect(r.ticks).toBe(3);
    expect(r.slots).toBe(10);
    expect(r.inputs).toEqual([
      [0, "right", 1],
      [1, "right", 0],
    ]);
  });

  it("blocks a script whose command the game doesn't declare", () => {
    const b = blocked(play({ v: 1, steps: [{ command: "nudg", args: { dx: 1 } }] }));
    expect(b.stage).toBe("script");
    expect(b.scriptIssues[0]!.message).toContain('did you mean "nudge"?');
  });
});

describe("runPlaytest on the game's clock", () => {
  const at30 = { ...testGame, time: { kind: "fixed" as const, rate: 30 } };

  /** An event game that stays busy for `busyTicks` ticks after any input. */
  function eventGame(busyTicks: number) {
    return {
      ...testGame,
      time: { kind: "event" as const },
      createRuntime(ctx: Parameters<typeof testGame.createRuntime>[0]) {
        const inner = testGame.createRuntime(ctx);
        let left = 0;
        return {
          ...inner,
          beforeStep(...args: Parameters<NonNullable<typeof inner.beforeStep>>) {
            left = args[1].length > 0 ? busyTicks : left - 1;
            inner.beforeStep?.(...args);
          },
          busy: () => left > 0,
        };
      },
    };
  }

  it("turns a 30 Hz game's forMs: 1000 into 30 ticks and reports its rate", () => {
    const r = report(
      runPlaytest({
        rapier,
        game: at30,
        scene: yard,
        script: { v: 1, steps: [{ wait: 1 }, { hold: ["right"], forMs: 1000 }] },
      }),
    );
    expect(r.ticks).toBe(31);
    expect(r.slots).toBe(31);
    expect(r.steps[1]).toEqual({ index: 1, start: 1, ticks: 30, end: "done" });
    expect(r.tickRate).toBe(30);
    expect(r.recording.tickRate).toBe(30);
    expect(r.configHash).not.toBe(report(play({ v: 1, steps: [{ wait: 1 }] })).configHash);
  });

  it("walks a 30 Hz avatar as far per second as a 60 Hz one", () => {
    const walk = (ms: number) => ({ v: 1 as const, steps: [{ hold: ["right"], forMs: ms }] });
    const slow = report(runPlaytest({ rapier, game: at30, scene: yard, script: walk(500) }));
    const fast = report(play(walk(500)));
    expect(slow.ticks * 2).toBe(fast.ticks);
    // Within one 30 Hz tick of walking: the worlds integrate at different steps.
    expect(Math.abs(slow.final!.position.x - fast.final!.position.x)).toBeLessThan(
      AVATAR_SPEED / 30,
    );
  });

  it("keeps a 60 Hz fixed game's report as it was: slots equal ticks, the hash unchanged", () => {
    const r = report(play(toGoal));
    expect(r.tickRate).toBe(60);
    expect(r.slots).toBe(r.ticks);
    expect(r.recording.tickRate).toBe(60);
    expect(r.configHash).toBe(
      hashText(
        JSON.stringify({
          engine: ENGINE_VERSION,
          tickRate: 60,
          game: testGame.id,
          config: testGame.configHash ?? null,
        }),
      ),
    );
  });

  it("simulates nothing for an event game's idle wait, and counts its slots", () => {
    const r = report(
      runPlaytest({
        rapier,
        game: eventGame(5),
        scene: yard,
        script: { v: 1, steps: [{ wait: 30 }] },
      }),
    );
    expect(r.ticks).toBe(0);
    expect(r.slots).toBe(30);
    expect(r.outcome).toMatchObject({ result: "script-end", tick: -1 });
    expect(r.steps).toEqual([{ index: 0, start: 0, ticks: 30, end: "done" }]);
    expect(r.recording.ticks).toBe(0);
    expect(r.inputs).toEqual([]);
  });

  it("wakes an event game on an edge and steps it while busy, then idles", () => {
    const r = report(
      runPlaytest({
        rapier,
        game: eventGame(5),
        scene: yard,
        script: { v: 1, steps: [{ wait: 10 }, { press: "right" }, { wait: 20 }] },
      }),
    );
    // The press and the release each wake one tick; five busy ticks follow the release.
    expect(r.ticks).toBe(7);
    expect(r.slots).toBe(31);
    expect(r.inputs).toEqual([
      [0, "right", 1],
      [1, "right", 0],
    ]);
    expect(r.steps.map((s) => [s.start, s.ticks])).toEqual([
      [0, 10],
      [10, 1],
      [11, 20],
    ]);
    expect(r.recording.ticks).toBe(7);
  });

  it("caps an event game's run at maxTicks simulated ticks, however many slots", () => {
    const r = report(
      runPlaytest({
        rapier,
        game: eventGame(1000),
        scene: yard,
        script: { v: 1, maxTicks: 40, steps: [{ wait: 100 }, { press: "right" }, { wait: 100 }] },
      }),
    );
    expect(r.outcome.result).toBe("timeout");
    expect(r.ticks).toBe(40);
    expect(r.slots).toBe(140);
  });
});

describe("runLoop", () => {
  const turns = { ...testGame, time: { kind: "turns" as const } };
  const turnsRegistry = createRegistry(turns);

  it("carries a turns game's key edges to the tick a command wakes, in order", () => {
    const prepared = prepareRun(yard, turnsRegistry);
    if (!prepared.ok) throw new Error("blocked");
    const started = startRun({
      rapier,
      game: turns,
      registry: turnsRegistry,
      scene: prepared.scene,
      play: {},
    });
    if (!started.ok) throw new Error("load failed");
    const stepped: unknown[] = [];
    const record: InputEdge[] = [];
    try {
      const end = runLoop({
        runtime: started.runtime,
        game: turns,
        maxTicks: 100,
        maxSlots: 12,
        record,
        input: {
          done: () => false,
          edges: (slot) => (slot === 2 ? [[2, "right", 1]] : slot === 4 ? [[4, "left", 1]] : []),
          commands: (slot) => (slot === 7 ? [{ name: "@elapsed", args: { ms: 5 } }] : []),
        },
        onTick: (state, _focus, edges, commands) => stepped.push([state.tick, edges, commands]),
      });
      expect(end).toEqual({ result: "timeout", tick: 0, ticks: 1, slots: 12 });
      expect(stepped).toEqual([
        [
          0,
          [
            [0, "right", 1],
            [0, "left", 1],
          ],
          [{ name: "@elapsed", args: { ms: 5 } }],
        ],
      ]);
      expect(record).toEqual([
        [0, "right", 1],
        [0, "left", 1],
      ]);
    } finally {
      started.runtime.destroy();
    }
  });

  it("steps a fixed game every slot", () => {
    expect(slotWakes({ kind: "fixed" }, [], [])).toBe(true);
    expect(slotWakes({ kind: "event" }, [[0, "a", 1]], [])).toBe(true);
    expect(slotWakes({ kind: "event" }, [], [])).toBe(false);
    expect(slotWakes({ kind: "turns" }, [[0, "a", 1]], [])).toBe(false);
    expect(slotWakes({ kind: "turns" }, [], [{ name: "@elapsed" }])).toBe(true);
  });
});

/**
 * The test game, plus a world that changes on known ticks (each after the
 * tick's `afterStep`): lamp#1 spawns at 2, lamp#2 and a marker tagged coin
 * at 4; lamp#1 is disabled at 6, lamp#2 destroyed at 8, lamp#1 enabled at 10.
 * `boomAt` spawns a lamp with a bad id on that tick; `wonAt` makes the
 * outcome hook win once the world has that many enabled lamps.
 */
function lifecycleGame(opts: { boomAt?: number; wonAt?: number } = {}) {
  return defineGame<TestGameSnapshot, TestGameOptions>({
    ...testGame,
    play: {
      ...testGame.play,
      ...(opts.wonAt !== undefined && {
        outcome: ({ world }) =>
          world?.count({ type: "lamp" }) === opts.wonAt
            ? { result: "won", cause: `${opts.wonAt} lamps` }
            : null,
      }),
    },
    createRuntime(ctx) {
      const base = testGame.createRuntime(ctx);
      let tick = 0;
      return {
        ...base,
        onLoad(scene) {
          tick = 0;
          base.onLoad?.(scene);
        },
        afterStep(dtMs, events) {
          base.afterStep?.(dtMs, events);
          if (tick === 2) ctx.spawn({ type: "lamp", at: [0, 0] });
          if (tick === 4) {
            ctx.spawn({ type: "lamp", at: [10, 0] });
            ctx.spawn({ type: "marker", at: [20, 0], tags: ["coin"] });
          }
          if (tick === 6) ctx.setEnabled("lamp#1", false);
          if (tick === 8) ctx.destroy("lamp#2");
          if (tick === 10) ctx.setEnabled("lamp#1", true);
          if (tick === opts.boomAt) ctx.spawn({ type: "lamp", id: "7", at: [0, 0] });
          tick++;
        },
      };
    },
  });
}

describe("runPlaytest's world predicates", () => {
  const lifecycle = lifecycleGame();
  const lifeRegistry = createRegistry(lifecycle);
  const run = (steps: InputScript["steps"], game = lifecycle, reg = lifeRegistry) =>
    report(
      runPlaytest({
        rapier,
        game,
        registry: reg,
        scene: yard,
        script: { v: 1, steps },
      }) as PlaytestRun<TestGameSnapshot>,
    );
  /** The last tick of each step that ended on its `until`, else its end. */
  const lastTicks = (r: Report) =>
    r.steps.map((s) => (s.end === "until" ? s.start + s.ticks - 1 : s.end));

  it("exists holds while an entity exists and is enabled", () => {
    const r = run([
      { hold: [], until: { exists: "lamp#1" } },
      { hold: [], until: { exists: { id: "lamp#1", enabled: false } } },
      { wait: 3 },
      { hold: [], until: { exists: "lamp#1" } },
      { hold: [], until: { exists: "lamp#2" }, max: 5 },
    ]);
    // Spawned at 2; disabled from 6, so the plain form waits for the enable at 10.
    expect(lastTicks(r)).toEqual([2, 3, "done", 10, "max"]);
  });

  it("exists with enabled: false holds for a disabled entity, not a destroyed one", () => {
    const r = run([
      { wait: 7 },
      { hold: [], until: { exists: { id: "lamp#1", enabled: false } } },
      { hold: [], until: { exists: { id: "lamp#2", enabled: false } }, max: 3 },
    ]);
    // lamp#1 is disabled at 7; lamp#2 is gone once tick 8's destroy lands.
    expect(lastTicks(r)).toEqual(["done", 7, "max"]);
  });

  it("count holds on min, max, eq and a range, by type and tag", () => {
    const r = run([
      { hold: [], until: { count: { tag: "coin", eq: 0 } } },
      { hold: [], until: { count: { type: "lamp", min: 1 } } },
      { hold: [], until: { count: { type: "lamp", eq: 2 } } },
      { hold: [], until: { count: { tag: "coin", min: 1, max: 1 } } },
      { hold: [], until: { count: { type: "lamp", max: 1 } } },
      { hold: [], until: { count: { type: "lamp", enabled: false, max: 1 } } },
    ]);
    // 2 lamps at 4; lamp#1 disabled at 6 leaves 1 enabled; lamp#2 destroyed at 8.
    expect(lastTicks(r)).toEqual([0, 2, 4, 5, 6, 8]);
  });

  it("count takes a list of types and holds a max of 0 before anything spawns", () => {
    const r = run([
      { hold: [], until: { count: { type: ["lamp", "plain"], max: 0 } } },
      { hold: [], until: { count: { type: ["sensor", "lamp"], eq: 3 } } },
    ]);
    expect(lastTicks(r)).toEqual([0, 4]);
  });

  it("ANDs world predicates with the engine's and the game's", () => {
    const r = run([
      { hold: [], until: { tick: 5, count: { type: "lamp", min: 1 }, exists: "lamp#2", past: 0 } },
    ]);
    expect(lastTicks(r)).toEqual([5]);
  });

  it("exists takes the id an instantiate returned, while any of its children lives", () => {
    const beacon: Prefab = {
      kind: "prefab",
      v: 3,
      id: "beacon",
      entities: [
        { id: "left", type: "marker", at: [0, 0] },
        { id: "right", type: "marker", at: [10, 0] },
      ],
    };
    const game = defineGame<TestGameSnapshot, TestGameOptions>({
      ...testGame,
      createRuntime(ctx) {
        const base = testGame.createRuntime(ctx);
        let tick = 0;
        return {
          ...base,
          afterStep(dtMs, events) {
            base.afterStep?.(dtMs, events);
            if (tick === 2) expect(ctx.instantiate("beacon", [0, 0]).id).toBe("beacon#1");
            if (tick === 4) ctx.setEnabled("beacon#1/left", false);
            if (tick === 6) ctx.setEnabled("beacon#1/right", false);
            if (tick === 8) ctx.destroy("beacon#1");
            tick++;
          },
        };
      },
    });
    const r = report(
      runPlaytest({
        rapier,
        game,
        registry: createRegistry(game),
        scene: yard,
        library: prefabLibrary([beacon]),
        script: {
          v: 1,
          steps: [
            { hold: [], until: { exists: "beacon#1" } },
            { wait: 2 },
            { hold: [], until: { exists: "beacon#1" } },
            { hold: [], until: { exists: "beacon#1" }, max: 1 },
            { hold: [], until: { exists: { id: "beacon#1", enabled: false } } },
            { hold: [], until: { exists: { id: "beacon#1", enabled: false } }, max: 1 },
          ],
        },
      }) as PlaytestRun<TestGameSnapshot>,
    );
    // Live from 2; still enabled at 5 with one child off; off at 6 with both; gone at 8.
    expect(lastTicks(r)).toEqual([2, "done", 5, "max", 7, "max"]);
  });

  it("gives the game's outcome hook the world", () => {
    const won = lifecycleGame({ wonAt: 2 });
    const r = run([{ wait: 100 }], won, createRegistry(won));
    expect(r.outcome).toMatchObject({ result: "won", tick: 4, cause: "2 lamps" });
  });

  it("calls onLastTick with the last tick's live world", () => {
    let seen: { tick: number; lamps: number; one: boolean } | null = null;
    const r = runPlaytest({
      rapier,
      game: lifecycle,
      registry: lifeRegistry,
      scene: yard,
      script: { v: 1, steps: [{ wait: 7 }] },
      onLastTick: (state) => {
        seen = {
          tick: state.tick,
          lamps: state.world!.count({ type: "lamp" }),
          one: state.world!.exists("lamp#1"),
        };
      },
    });
    expect(r.blocked).toBe(false);
    expect(seen).toEqual({ tick: 6, lamps: 1, one: false });
  });

  it("ends a run blocked at 'run' when a step throws an EngineError, its code in issues", () => {
    const boom = lifecycleGame({ boomAt: 5 });
    const r = blocked(
      runPlaytest({
        rapier,
        game: boom,
        registry: createRegistry(boom),
        scene: yard,
        script: { v: 1, steps: [{ wait: 20 }] },
      }),
    );
    expect(r.stage).toBe("run");
    expect(r.scriptIssues).toEqual([]);
    const issue = r.issues.at(-1)!;
    expect(issue).toMatchObject({ severity: "error", code: "spawn-id-invalid" });
    expect(issue.message).toContain('"7"');
  });

  it("rethrows an error that isn't an EngineError", () => {
    const game = defineGame<TestGameSnapshot, TestGameOptions>({
      ...testGame,
      createRuntime(ctx) {
        const base = testGame.createRuntime(ctx);
        return {
          ...base,
          afterStep() {
            throw new Error("game bug");
          },
        };
      },
    });
    expect(() =>
      runPlaytest({
        rapier,
        game,
        registry: createRegistry(game),
        scene: yard,
        script: { v: 1, steps: [{ wait: 2 }] },
      }),
    ).toThrow("game bug");
  });

  it("refuses a game predicate named like an engine one at registry build", () => {
    for (const name of ["exists", "count"]) {
      const game = defineGame({
        ...testGame,
        play: {
          ...testGame.play,
          predicates: {
            [name]: { description: "Shadows the engine's.", arg: z.string(), test: () => true },
          },
        },
      });
      expect(() => createRegistry(game), name).toThrow(
        `script predicate "${name}" is the engine's`,
      );
    }
  });
});
