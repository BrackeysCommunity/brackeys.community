// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { beforeAll, describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { testGame } from "../../__tests__/fixtures/test-game";
import { createRegistry } from "../../game/define";
import { isRuntimeId } from "../../game/runtime-ids";
import type { ActionDef, GameCommand, GameDefinition, Macro } from "../../game/types";
import type { PointerState } from "../../input/state";
import type { ProjectRuntimeView } from "../../project/runtime-view";
import { parseSceneOrThrow } from "../../scene/parse";
import { SCENE_FORMAT_VERSION, type SceneDefinition } from "../../scene/types";
import { Rng } from "../../sim-kit/rng";
import type { InputAction, RapierModule } from "../../types";
import { defaultFuzzMacro, fuzz } from "../fuzz";
import { probeConfigHash } from "../headless";
import { runPlaytest } from "../playtest";
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
      inputMap: null,
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
    expect(Object.keys(r.results)).toEqual([
      "timeout",
      "script-end",
      "stuck",
      "quit",
      "flow",
      "won",
    ]);
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
    const from = run({ play: { at: { x: 8, y: 5 } }, rollouts: 4 });
    expect(from.touched.find((t) => t.ref === "zone")?.firstTick ?? Infinity).toBeLessThan(
      run({ rollouts: 4 }).touched.find((t) => t.ref === "zone")?.firstTick ?? Infinity,
    );
    const inside = fuzz({
      rapier,
      game: testGame,
      scene: yard,
      seed: 1,
      play: { at: { x: 10, y: 9.75 } },
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

  it("ends blocked at 'run' when a step throws an EngineError, its code in issues", () => {
    const boom: GameDefinition = {
      ...testGame,
      createRuntime(ctx) {
        const base = testGame.createRuntime(ctx);
        let tick = 0;
        return {
          ...base,
          beforeStep(dtMs, actions, commands) {
            base.beforeStep?.(dtMs, actions, commands);
            if (tick++ === 3) ctx.spawn({ type: "plain", id: "plain#7", at: [0, 0] });
          },
        };
      },
    };
    const r = fuzz({
      rapier,
      game: boom,
      registry: createRegistry(boom),
      scene: yard,
      seed: 1,
      rollouts: 2,
      ticks: 20,
    });
    expect(r).toMatchObject({ blocked: true, stage: "run", scene: "engine-yard" });
    if (!r.blocked) throw new Error("expected a blocked run");
    expect(r.issues.at(-1)).toMatchObject({ severity: "error", code: "spawn-id-invalid" });
  });

  describe("analog and pointer moves", () => {
    type Seen = { value: number; vector: { x: number; y: number }; pointer: PointerState | null };

    /**
     * The test game reading `actions` instead of its buttons: `drive` turns
     * each tick's input into a walking direction, and every tick's readings
     * land in `seen`.
     */
    function drivenGame(
      actions: ActionDef[],
      drive: (input: Seen) => number,
      seen: Seen[],
      macro?: () => Macro,
    ): GameDefinition {
      return {
        ...testGame,
        actions,
        play: { ...testGame.play, macro, movementActions: actions.map((a) => a.action) },
        createRuntime(ctx) {
          const base = testGame.createRuntime(ctx);
          return {
            ...base,
            beforeStep(dtMs, _actions, commands) {
              const reading: Seen = {
                value: ctx.input.value("walk"),
                vector: ctx.input.vector("move"),
                pointer: ctx.input.pointer(),
              };
              seen.push(reading);
              const dir = drive(reading);
              const walk: InputAction[] = [
                { action: "right", pressed: dir > 0, tick: 0, timestamp: 0 },
                { action: "left", pressed: dir < 0, tick: 0, timestamp: 0 },
              ];
              base.beforeStep?.(dtMs, walk, commands);
            },
          };
        },
      };
    }

    const fuzzOf = (game: GameDefinition, opts: Partial<FuzzOptions> = {}) =>
      report(
        fuzz({
          rapier,
          game,
          registry: createRegistry(game),
          scene: yard,
          seed: 2,
          rollouts: 12,
          ticks: 300,
          ...opts,
        }),
      );

    const AXIS: ActionDef = {
      action: "walk",
      kind: "axis",
      description: "Walk.",
      bindings: [{ device: "key", code: "KeyD" }],
    };
    const VECTOR: ActionDef = {
      action: "move",
      kind: "vector",
      description: "Move.",
      bindings: [{ device: "key", code: "KeyD", axis: "x", value: 1 }],
    };
    const POKE: ActionDef = {
      action: "poke",
      description: "Poke.",
      bindings: [{ device: "pointer", button: "primary" }],
    };

    it("sets an axis game's axis, and its rollouts move", () => {
      const seen: Seen[] = [];
      const r = fuzzOf(drivenGame([AXIS], (s) => s.value, seen));
      const values = new Set(seen.map((s) => s.value));
      expect([...values].some((v) => v < 0)).toBe(true);
      expect([...values].some((v) => v > 0 && v < 1)).toBe(true);
      expect([...values].every((v) => v >= -1 && v <= 1 && Math.round(v * 1000) === v * 1000)).toBe(
        true,
      );
      expect(r.results.won).toBeGreaterThan(0);
      expect(r.touched.find((t) => t.ref === "zone")).toBeDefined();
    }, 30_000);

    it("sets a vector game's vector inside the unit disc, and its rollouts move", () => {
      const seen: Seen[] = [];
      const r = fuzzOf(drivenGame([VECTOR], (s) => s.vector.x, seen));
      const moving = seen.filter((s) => s.vector.x !== 0 || s.vector.y !== 0);
      expect(moving.length).toBeGreaterThan(0);
      for (const { vector } of moving) {
        expect(vector.x * vector.x + vector.y * vector.y).toBeLessThanOrEqual(1);
      }
      expect(moving.some((s) => s.vector.x < 0)).toBe(true);
      expect(moving.some((s) => s.vector.y !== 0)).toBe(true);
      expect(r.results.won).toBeGreaterThan(0);
    }, 30_000);

    it("moves, clicks and drags a pointer game's pointer inside the scene", () => {
      const seen: Seen[] = [];
      const pokes: boolean[] = [];
      const game = drivenGame([POKE], () => 0, seen);
      const driven = drivenGame([POKE], () => 0, seen);
      game.createRuntime = (ctx) => {
        const runtime = driven.createRuntime(ctx);
        return {
          ...runtime,
          beforeStep(dtMs, actions, commands) {
            pokes.push(ctx.input.held("poke"));
            runtime.beforeStep?.(dtMs, actions, commands);
          },
        };
      };
      const a = fuzzOf(game, { rollouts: 6 });
      const pointers = seen.map((s) => s.pointer).filter((p) => p !== null);
      expect(pointers.length).toBeGreaterThan(0);
      for (const p of pointers) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(20);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(10);
        expect(p.over).toBe(true);
      }
      const down = seen.map((s, i) => ({ s, poke: pokes[i] })).filter(({ poke }) => poke);
      expect(down.length).toBeGreaterThan(0);
      expect(down.every(({ s }) => ((s.pointer?.buttons ?? 0) & 1) === 1)).toBe(true);
      expect(seen.some((s, i) => !pokes[i] && s.pointer !== null)).toBe(true);
      const dragged = down.some(
        ({ s }, i) =>
          i > 0 &&
          down[i - 1]!.s.pointer !== null &&
          (down[i - 1]!.s.pointer!.x !== s.pointer!.x ||
            down[i - 1]!.s.pointer!.y !== s.pointer!.y),
      );
      expect(dragged).toBe(true);

      seen.length = 0;
      pokes.length = 0;
      expect(withoutTiming(fuzzOf(game, { rollouts: 6 }))).toEqual(withoutTiming(a));
    }, 30_000);

    it("leaves a button-only game's rollouts as they were", () => {
      // configHash carries ENGINE_VERSION, so it is checked on its own and left out of the
      // digest: a version bump must not look like a change in play. `results` holds a count
      // for every run result, so a new engine result moves the digest without moving a rollout.
      const digest = (game: GameDefinition, r: FuzzReport) => {
        const { configHash, ...rest } = withoutTiming(r);
        expect(configHash).toBe(probeConfigHash(game));
        return createHash("sha256").update(JSON.stringify(rest)).digest("hex").slice(0, 16);
      };
      const opts = { seed: 5, rollouts: 8, ticks: 300 };
      const plain = { ...testGame, play: { ...testGame.play, macro: undefined } };
      expect(digest(testGame, report(fuzz({ rapier, game: testGame, scene: yard, ...opts })))).toBe(
        "54358566f81d2ff2",
      );
      expect(digest(plain, report(fuzz({ rapier, game: plain, scene: yard, ...opts })))).toBe(
        "c702eae74c4df8a2",
      );

      const a = Rng.from(9);
      const b = Rng.from(9);
      for (let i = 0; i < 50; i++) {
        expect(
          defaultFuzzMacro(a, ["left", "right"], { axes: [], vectors: [], pointer: null }),
        ).toEqual(defaultFuzzMacro(b, ["left", "right"]));
      }
    }, 30_000);

    it("plays a button-only game's macros as a hold script would", () => {
      const types = new Map(
        (yard.entities ?? []).filter((e) => !isRuntimeId(e.id)).map((e) => [e.id, e.type]),
      );
      const ticksPerRollout = 300;

      /** What fuzz should report when each rollout's macros play as a v1 script of holds. */
      function asHoldScripts(
        game: GameDefinition,
        macro: (rng: Rng, names: readonly string[]) => Macro,
      ) {
        const root = Rng.from(5);
        const touched = new Map<
          string,
          { reached: number; firstTick: number; firstRollout: number }
        >();
        const results: Record<string, number> = {};
        let ticks = 0;
        for (let rollout = 0; rollout < 8; rollout++) {
          const rng = root.fork(`rollout:${rollout}`);
          const steps: { hold: string[]; for: number }[] = [];
          for (let total = 0; total <= ticksPerRollout; ) {
            const m = macro(rng, registry.actionNames);
            steps.push({ hold: [...new Set(m.hold)], for: m.ticks });
            total += m.ticks;
          }
          const p = runPlaytest({
            rapier,
            game,
            scene: yard,
            script: { v: 1, maxTicks: ticksPerRollout, steps },
            maxEvents: 100_000,
          });
          if (p.blocked) throw new Error(`blocked at ${p.stage}`);
          results[p.outcome.result] = (results[p.outcome.result] ?? 0) + 1;
          ticks += p.ticks;
          const seen = new Set<string>();
          for (const e of p.events) {
            for (const id of [e.entityId, e.other]) {
              if (id === undefined || isRuntimeId(id) || seen.has(id) || !types.has(id)) continue;
              seen.add(id);
              const t = touched.get(id);
              if (!t) touched.set(id, { reached: 1, firstTick: e.tick, firstRollout: rollout });
              else {
                t.reached++;
                if (e.tick < t.firstTick)
                  Object.assign(t, { firstTick: e.tick, firstRollout: rollout });
              }
            }
          }
        }
        return {
          ticks,
          results,
          touched: [...touched]
            .map(([ref, t]) => ({ ref, type: types.get(ref), ...t }))
            .sort((a, b) => (a.ref < b.ref ? -1 : 1)),
        };
      }

      const plain = { ...testGame, play: { ...testGame.play, macro: undefined } };
      for (const [game, macro] of [
        [testGame, (rng: Rng, names: readonly string[]) => testGame.play!.macro!(rng, names)],
        [plain, (rng: Rng, names: readonly string[]) => defaultFuzzMacro(rng, names)],
      ] as const) {
        const want = asHoldScripts(game, macro);
        const r = report(
          fuzz({ rapier, game, scene: yard, seed: 5, rollouts: 8, ticks: ticksPerRollout }),
        );
        expect({
          ticks: r.ticks,
          results: Object.fromEntries(Object.entries(r.results).filter(([, n]) => n > 0)),
          touched: r.touched,
        }).toEqual(want);
        expect(r.touched.length).toBeGreaterThan(0);
      }
    }, 30_000);

    it("draws analog values and pointer moves from what it's given", () => {
      const rng = Rng.from(4);
      const macros = Array.from({ length: 200 }, () =>
        defaultFuzzMacro(rng, ["jump", "walk", "move", "poke"], {
          axes: ["walk"],
          vectors: ["move"],
          pointer: { buttons: ["primary", "secondary"], actions: ["poke"], bounds: [-2, 1, 4, 3] },
        }),
      );
      for (const m of macros) {
        expect(m.hold.filter((a) => a !== "jump")).toEqual([]);
        for (const [name, v] of Object.entries(m.set ?? {})) {
          if (name === "walk") expect(typeof v).toBe("number");
          else expect(name === "move" && Array.isArray(v) && v.length === 2).toBe(true);
        }
        if (m.pointer) {
          const { at, drag, press, release } = m.pointer;
          for (const [x, y] of drag ? [at, drag] : [at]) {
            expect(x).toBeGreaterThanOrEqual(-2);
            expect(x).toBeLessThanOrEqual(4);
            expect(y).toBeGreaterThanOrEqual(1);
            expect(y).toBeLessThanOrEqual(3);
          }
          expect(press).toBe(release);
          if (drag) expect(press).toBeDefined();
        }
      }
      expect(macros.filter((m) => m.set).length).toBeGreaterThan(100);
      expect(macros.filter((m) => m.pointer?.press).length).toBeGreaterThan(20);
      expect(macros.filter((m) => m.pointer && !m.pointer.press).length).toBeGreaterThan(20);
      expect(macros.filter((m) => m.pointer?.drag).length).toBeGreaterThan(10);
    });

    it("lets a game's macro win, and checks the values it sets", () => {
      const seen: Seen[] = [];
      fuzzOf(
        drivenGame(
          [AXIS],
          (s) => s.value,
          seen,
          () => ({ hold: [], ticks: 10 }),
        ),
        { rollouts: 2, ticks: 60 },
      );
      expect(seen.every((s) => s.value === 0 && s.pointer === null)).toBe(true);

      const set = (value: Macro["set"]) =>
        fuzzOf(
          drivenGame(
            [AXIS, VECTOR, { ...POKE, bindings: [] }],
            () => 0,
            [],
            () => ({
              hold: [],
              ticks: 5,
              set: value,
            }),
          ),
          { rollouts: 1, ticks: 10 },
        );
      expect(() => set({ wlak: 1 })).toThrow(/fuzz macro: set: unknown action "wlak"/);
      expect(() => set({ poke: 1 })).toThrow(/set\.poke: it is a button/);
      expect(() => set({ move: 1 })).toThrow(/set\.move: a vector takes an \[x, y\] pair/);
      expect(() => set({ walk: [1, 0] })).toThrow(/set\.walk: an axis takes a number/);

      const halfway: Seen[] = [];
      fuzzOf(
        drivenGame(
          [AXIS],
          (s) => s.value,
          halfway,
          () => ({
            hold: [],
            ticks: 5,
            set: { walk: -0.25 },
            pointer: { at: [1, 2], drag: [3, 2], press: "primary", release: "primary" },
          }),
        ),
        { rollouts: 1, ticks: 5 },
      );
      expect(halfway.map((s) => s.value)).toEqual([-0.25, -0.25, -0.25, -0.25, -0.25]);
      expect(halfway.map((s) => [s.pointer?.x, s.pointer?.buttons])).toEqual([
        [1, 1],
        [1.5, 1],
        [2, 1],
        [2.5, 1],
        [3, 0],
      ]);

      const quick = drivenGame(
        [AXIS],
        () => 0,
        [],
        () => ({
          hold: [],
          ticks: 1,
          pointer: { at: [1, 1], press: "primary", release: "primary" },
        }),
      );
      expect(() => fuzzOf(quick, { rollouts: 1, ticks: 5 })).toThrow(/at least 2 ticks/);
    }, 30_000);
  });
});

describe("fuzz over legal commands", () => {
  type Walk = { pos: number; illegal: number };
  const GOAL = 3;
  /** Step right, step left (not from 0) or wait: the walker's legal moves at `pos`. */
  const movesAt = (pos: number): GameCommand[] => [
    { name: "step", args: { d: 1 } },
    ...(pos > 0 ? [{ name: "step", args: { d: -1 } }] : []),
    { name: "wait" },
  ];
  const same = (a: GameCommand, b: GameCommand) =>
    a.name === b.name && JSON.stringify(a.args) === JSON.stringify(b.args);

  /**
   * A physics-free turns game walking a line to `GOAL` by commands only: an
   * illegal command loses, as does a UI or held action reaching the
   * simulation when `seen` isn't collecting them.
   */
  function walker(
    seen: { commands: GameCommand[]; actions: string[] },
    list: (pos: number) => GameCommand[] = movesAt,
    extra: Partial<GameDefinition<Walk>> = {},
  ): GameDefinition<Walk> {
    return {
      id: "walker",
      types: [],
      actions: [
        { action: "right", bindings: [{ device: "key", code: "KeyD" }], description: "Unused." },
        {
          action: "menu",
          bindings: [{ device: "key", code: "Escape" }],
          description: "Opens the menu.",
          ui: true,
        },
      ],
      time: { kind: "turns" },
      world: { physics: "none" },
      commands: {
        step: { description: "Moves by d.", args: z.strictObject({ d: z.number().int() }) },
        wait: { description: "Passes." },
      },
      createRuntime() {
        let pos = 0;
        let illegal = 0;
        return {
          beforeStep(_dt, actions, commands) {
            for (const a of actions) seen.actions.push(a.action);
            if (actions.some((a) => a.action === "menu")) illegal++;
            for (const c of commands) {
              seen.commands.push(c);
              if (!list(pos).some((m) => same(m, c))) illegal++;
              else if (c.name === "step") pos += (c.args as { d: number }).d;
            }
          },
          snapshot: () => ({ pos, illegal }),
        };
      },
      play: {
        results: ["won", "lost"],
        outcome: ({ snapshot }) =>
          snapshot.illegal > 0
            ? { result: "lost", cause: "an illegal command or a UI action" }
            : snapshot.pos >= GOAL
              ? { result: "won" }
              : null,
        commands: ({ snapshot }) => list(snapshot.pos),
      },
      ...extra,
    };
  }
  const line: SceneDefinition = {
    v: SCENE_FORMAT_VERSION,
    name: "line",
    game: "walker",
    bounds: [0, 0, 10, 10],
    entities: [{ id: "start", type: "marker", at: [1, 1] }],
  };
  const fuzzWalker = (game: GameDefinition<Walk>, opts: Partial<FuzzOptions> = {}) =>
    report(
      fuzz({
        game,
        registry: createRegistry(game as GameDefinition),
        scene: line,
        seed: 3,
        rollouts: 16,
        ticks: 600,
        ...opts,
      } as FuzzOptions),
    );

  it("sends only legal commands, the same for one seed, and reaches the goal", () => {
    const seen = { commands: [] as GameCommand[], actions: [] as string[] };
    const a = fuzzWalker(walker(seen));
    expect(a.results).toMatchObject({ won: 16, lost: 0, timeout: 0 });
    expect(seen.actions).toEqual([]);
    expect(seen.commands.length).toBe(a.legal!.sent);
    expect(a.legal).toEqual({ sent: a.ticks, empty: 0 });
    expect(new Set(seen.commands.map((c) => JSON.stringify(c)))).toEqual(
      new Set(movesAt(1).map((c) => JSON.stringify(c))),
    );
    expect(withoutTiming(fuzzWalker(walker(seen)))).toEqual(withoutTiming(a));
    expect(withoutTiming(fuzzWalker(walker(seen), { seed: 4 }))).not.toEqual(withoutTiming(a));
  });

  it("holds nothing for a slot when the list is empty, so an idle turns game skips it", () => {
    const seen = { commands: [] as GameCommand[], actions: [] as string[] };
    const r = fuzzWalker(
      walker(seen, () => []),
      { rollouts: 2, ticks: 50 },
    );
    expect(r).toMatchObject({ ticks: 0, legal: { sent: 0, empty: 100 } });
    expect(r.results.timeout).toBe(2);
    expect(seen.commands).toEqual([]);
  });

  it("mixes commands with action holds off turns, never holding a UI action", () => {
    const seen = { commands: [] as GameCommand[], actions: [] as string[] };
    const fixed = walker(seen, movesAt, { time: { kind: "fixed" } });
    const r = fuzzWalker(fixed, { rollouts: 8, ticks: 300 });
    expect(r.results.lost).toBe(0);
    expect(r.legal!.sent).toBeGreaterThan(0);
    expect(seen.actions).toContain("right");
    expect(seen.actions).not.toContain("menu");
    expect(withoutTiming(fuzzWalker(fixed, { rollouts: 8, ticks: 300 }))).toEqual(withoutTiming(r));
  });

  it("leaves a game's own macro in charge, with no legal counts", () => {
    const seen = { commands: [] as GameCommand[], actions: [] as string[] };
    const own = walker(seen, movesAt, {});
    own.play = { ...own.play, macro: () => ({ hold: ["right"], ticks: 5 }) };
    const r = fuzzWalker(own, { rollouts: 2, ticks: 40 });
    expect(r.legal).toBeUndefined();
    expect(seen.commands).toEqual([]);
  });

  it("keeps UI actions out of the default macro", () => {
    const rng = Rng.from(2);
    const reg = createRegistry(walker({ commands: [], actions: [] }) as GameDefinition);
    expect(reg.uiActionNames).toEqual(["menu"]);
    const seen = { commands: [] as GameCommand[], actions: [] as string[] };
    const noCommands = walker(seen, movesAt, {});
    noCommands.play = { ...noCommands.play, commands: undefined };
    const r = fuzzWalker({ ...noCommands, time: { kind: "fixed" } }, { rollouts: 4, ticks: 200 });
    expect(r.legal).toBeUndefined();
    expect(seen.actions).toContain("right");
    expect(seen.actions).not.toContain("menu");
    expect(defaultFuzzMacro(rng, ["right"]).hold).toEqual(["right"]);
  });

  it("hands a game's own macro the actions without the UI-only ones", () => {
    const named: string[][] = [];
    const own = walker({ commands: [], actions: [] }, movesAt, {});
    own.play = {
      ...own.play,
      macro: (_rng, actions) => {
        named.push([...actions]);
        return { hold: [], ticks: 5 };
      },
    };
    fuzzWalker(own, { rollouts: 1, ticks: 10 });
    expect(named.length).toBeGreaterThan(0);
    expect(named.every((a) => a.length === 1 && a[0] === "right")).toBe(true);
  });

  it("fails a game macro that holds or sets a UI action", () => {
    const holds = walker({ commands: [], actions: [] }, movesAt, {});
    holds.play = { ...holds.play, macro: () => ({ hold: ["menu"], ticks: 5 }) };
    expect(() => fuzzWalker(holds, { rollouts: 1, ticks: 10 })).toThrow(
      /fuzz macro: "menu" is a UI-only action.*binding-unknown.*send a command/,
    );
    const sets = walker({ commands: [], actions: [] }, movesAt, {});
    sets.play = { ...sets.play, macro: () => ({ hold: [], set: { menu: 1 }, ticks: 5 }) };
    expect(() => fuzzWalker(sets, { rollouts: 1, ticks: 10 })).toThrow(
      /fuzz macro: set: "menu" is a UI-only action/,
    );
  });
});
