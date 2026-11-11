// @vitest-environment node
import { readFileSync } from "node:fs";

import { beforeAll, describe, expect, it } from "vite-plus/test";

import { testGame } from "../../__tests__/fixtures/test-game";
import { createRegistry } from "../../game/define";
import { isRuntimeId } from "../../game/runtime-ids";
import type { GameDefinition } from "../../game/types";
import type { ProjectRuntimeView } from "../../project/runtime-view";
import { parseSceneOrThrow } from "../../scene/parse";
import { Rng } from "../../sim-kit/rng";
import type { RapierModule } from "../../types";
import { defaultFuzzMacro, fuzz } from "../fuzz";
import { probeConfigHash } from "../headless";
import type { FuzzOptions, FuzzReport, FuzzRun } from "../playtest-types";

const registry = createRegistry(testGame);
const text = readFileSync(new URL("../../scenes/engine-yard.json", import.meta.url), "utf8");
const yard = parseSceneOrThrow(text, registry);

let rapier: RapierModule;

beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

function report(run: FuzzRun): FuzzReport {
  if (run.blocked) throw new Error(`blocked at ${run.stage}`);
  return run;
}

const run = (opts: Partial<FuzzOptions> = {}) =>
  report(
    fuzz({
      rapier,
      game: testGame,
      registry,
      scene: yard,
      seed: 1,
      rollouts: 12,
      ticks: 300,
      ...opts,
    }),
  );

const withoutTiming = ({ timing, ...rest }: FuzzReport) => {
  expect(timing.elapsedMs).toBeGreaterThanOrEqual(0);
  return rest;
};

describe("fuzz", () => {
  it("hashes the config on the run's clock, a project's engine.tickRate included", () => {
    const project: ProjectRuntimeView = {
      settings: {},
      engine: { tickRate: 30 },
      table: () => [],
      asset: () => undefined,
    };
    const opts = { rollouts: 1, ticks: 10 };
    expect(run(opts).configHash).toBe(probeConfigHash(testGame));
    expect(run({ ...opts, project }).configHash).toBe(probeConfigHash(testGame, { rate: 30 }));
    expect(run({ ...opts, project }).configHash).not.toBe(run(opts).configHash);
  });

  it("gives the same report for the same seed, and another for another", () => {
    const a = run();
    expect(withoutTiming(a)).toEqual(withoutTiming(run()));
    expect(withoutTiming(run({ seed: "1" }))).not.toEqual(withoutTiming(a));
    expect(a).toMatchObject({
      blocked: false,
      scene: "engine-yard",
      seed: 1,
      rollouts: 12,
      ticksPerRollout: 300,
    });
  });

  it("reaches the test game's goal in some of its rollouts and reports how", () => {
    const r = run();
    expect(r.results.won).toBeGreaterThan(0);
    expect(Object.values(r.results).reduce((a, b) => a + b, 0)).toBe(12);
    expect(Object.keys(r.results)).toEqual(["timeout", "script-end", "stuck", "quit", "won"]);
    expect(r.results["script-end"]).toBe(0);

    const zone = r.touched.find((t) => t.ref === "zone");
    expect(zone).toMatchObject({ type: "sensor" });
    expect(zone!.reached).toBe(r.results.won);
    expect(zone!.firstTick).toBeGreaterThan(0);
    expect(zone!.firstRollout).toBeLessThan(12);
    expect(r.touched.find((t) => t.ref === "avatar")).toMatchObject({ type: "prop" });
    expect(r.untouched).toContain("lift");
    expect(r.untouched).not.toContain("zone");
    expect(r.touched.map((t) => t.ref)).toEqual([...r.touched.map((t) => t.ref)].sort());
    expect(r.ticks).toBeLessThanOrEqual(12 * 300);
    expect(r.timing.ticksPerSecond).toBeGreaterThan(0);
  });

  it("keeps the first rollouts of a longer fuzz the same", () => {
    const short = run({ rollouts: 3 });
    const long = run({ rollouts: 6 });
    for (const t of short.touched) {
      const same = long.touched.find((u) => u.ref === t.ref)!;
      expect(same.firstTick).toBeLessThanOrEqual(t.firstTick);
      expect(same.reached).toBeGreaterThanOrEqual(t.reached);
    }
  });

  it("draws the default macro without a game macro, and checks a game's macro", () => {
    const rng = Rng.from(7);
    for (let i = 0; i < 50; i++) {
      const m = defaultFuzzMacro(rng, ["a", "b", "c"]);
      expect(m.ticks).toBeGreaterThanOrEqual(4);
      expect(m.ticks).toBeLessThanOrEqual(60);
      expect(m.hold.length).toBeGreaterThanOrEqual(1);
      expect(new Set(m.hold).size).toBe(m.hold.length);
    }
    expect(defaultFuzzMacro(rng, []).hold).toEqual([]);

    const plain = { ...testGame, play: { ...testGame.play, macro: undefined } };
    const r = report(fuzz({ rapier, game: plain, scene: yard, seed: 3, rollouts: 4, ticks: 120 }));
    expect(r.rollouts).toBe(4);

    const bad = {
      ...testGame,
      play: { ...testGame.play, macro: () => ({ hold: ["jump"], ticks: 5 }) },
    };
    expect(() => fuzz({ rapier, game: bad, scene: yard, seed: 3, rollouts: 1 })).toThrow(
      /unknown action "jump"/,
    );
    expect(() => run({ rollouts: 0 })).toThrow(RangeError);
  });

  it("ends an idle turns game's rollouts on their slots, having simulated nothing", () => {
    const turns = { ...testGame, time: { kind: "turns" as const } };
    const r = report(fuzz({ rapier, game: turns, scene: yard, seed: 1, rollouts: 3, ticks: 200 }));
    expect(r.ticks).toBe(0);
    expect(r.results.timeout).toBe(3);
    expect(r.touched).toEqual([]);
  });

  it("simulates an event game only on the slots its macros' edges wake", () => {
    const event = { ...testGame, time: { kind: "event" as const } };
    const r = report(fuzz({ rapier, game: event, scene: yard, seed: 1, rollouts: 3, ticks: 200 }));
    expect(r.ticks).toBeGreaterThan(0);
    expect(r.ticks).toBeLessThan(3 * 200);
  });

  it("starts each rollout like Play, and blocks a scene with errors or a bad start", () => {
    const from = run({ play: { at: { x: 800, y: 500 } }, rollouts: 4 });
    expect(from.touched.find((t) => t.ref === "zone")?.firstTick ?? Infinity).toBeLessThan(
      run({ rollouts: 4 }).touched.find((t) => t.ref === "zone")?.firstTick ?? Infinity,
    );
    const inside = fuzz({
      rapier,
      game: testGame,
      scene: yard,
      seed: 1,
      play: { at: { x: 1000, y: 975 } },
    });
    expect(inside).toMatchObject({
      blocked: true,
      stage: "load",
      load: { reason: "spawn-blocked" },
    });
    const broken = { ...yard, bounds: [10, 10, 0, 0] as [number, number, number, number] };
    expect(fuzz({ rapier, game: testGame, scene: broken, seed: 1 })).toMatchObject({
      blocked: true,
      stage: "scene",
    });
  });

  it("never lists a runtime id in a spawning game's report, as touched or untouched", () => {
    const seen: string[] = [];
    /** The test game spawning a marker every tick and naming it in its own events. */
    const spawning: GameDefinition = {
      ...testGame,
      createRuntime(ctx) {
        const base = testGame.createRuntime(ctx);
        let last: string | null = null;
        return {
          ...base,
          beforeStep(dtMs, actions, commands) {
            base.beforeStep?.(dtMs, actions, commands);
            if (last) ctx.destroy(last);
            last = ctx.spawn({ type: "plain", at: [100, 100] }).id;
            seen.push(last);
            ctx.emit({ type: "test:near", entityId: last, other: "zone", at: { x: 0, y: 0 } });
          },
        };
      },
    };
    const r = report(
      fuzz({
        rapier,
        game: spawning,
        registry: createRegistry(spawning),
        scene: yard,
        seed: 1,
        rollouts: 4,
        ticks: 200,
      }),
    );
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every(isRuntimeId)).toBe(true);
    const refs = [...r.touched.map((t) => t.ref), ...r.untouched];
    expect(refs.filter((ref) => ref.includes("#"))).toEqual([]);
    expect(r.touched.find((t) => t.ref === "zone")).toMatchObject({ reached: 4, firstTick: 0 });
    const plain = run({ rollouts: 1, ticks: 10 });
    expect(new Set(refs)).toEqual(
      new Set([...plain.touched.map((t) => t.ref), ...plain.untouched]),
    );
  }, 30_000);
});
