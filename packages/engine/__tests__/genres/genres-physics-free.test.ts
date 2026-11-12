// @vitest-environment node
import { afterAll, describe, expect, it, vi } from "vite-plus/test";

import { defineGame } from "../../game/define";
import type { GameDefinition } from "../../game/types";
import type { InputScript } from "../../headless/playtest-types";
import type { TickInput } from "../../input/stream";
import { defaultSeed } from "../../runtime/seed";
import { SCENE_FORMAT_VERSION } from "../../scene/types";
import {
  loadRapier,
  playTicks,
  probePhysics,
  probeRuns,
  probeTimeout,
  probesFrom,
  runGenreProbe,
  tickInput,
  type GenreProbe,
  type ProbeVariant,
} from "./harness";
import { GENRE_PINS } from "./pins";

const init = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@dimforge/rapier2d-compat", () => ({ init, default: { init } }));

/** A physics-free game that wins after ten ticks: the harness's own check, never pinned. */
const counter: GenreProbe<{ ticks: number }> = {
  id: "harness-counter",
  rows: ["idle"],
  game: defineGame<{ ticks: number }>({
    id: "counter",
    types: [],
    actions: [{ action: "go", keys: [" "], description: "Go." }],
    world: { physics: "none" },
    play: {
      results: ["won"],
      outcome: (s) => (s.snapshot.ticks >= 10 ? { result: "won" } : null),
    },
    createRuntime: () => {
      let ticks = 0;
      return {
        afterStep: () => void ticks++,
        snapshot: () => ({ ticks }),
        restore: (s) => void (ticks = s.ticks),
      };
    },
  }),
  scene: {
    v: SCENE_FORMAT_VERSION,
    name: "counter",
    game: "counter",
    bounds: [0, 0, 2, 2],
    entities: [{ id: "start", type: "marker", at: [0.2, 0.2], tags: ["spawn"] }],
  },
  script: { v: 1, steps: [{ hold: ["go"], for: 4 }, { wait: 20 }] },
  expect: { result: "won", maxTicks: 11 },
  variants: [
    { name: "gravity-zero", settings: { gravity: [0, 0] } },
    { name: "rapier", settings: { physics: "rapier" } },
    { name: "seed-7", seed: 7 },
    { name: "saved", saveAt: 4 },
  ],
};

/** Two seats on vector sticks, each walking to x ≥ 1 m: the harness's v2 tracks check. */
const seats: GenreProbe<{ x: number[] }> = {
  id: "harness-seats",
  rows: ["local-multiplayer"],
  game: defineGame<{ x: number[] }>({
    id: "seats",
    types: [],
    actions: [
      {
        action: "move",
        kind: "vector",
        bindings: [{ device: "pad", stick: "left" }],
        description: "Move.",
      },
    ],
    input: { players: { max: 2, join: "host" } },
    world: { physics: "none" },
    play: {
      results: ["won"],
      outcome: (s) => (s.snapshot.x.every((x) => x >= 1) ? { result: "won" } : null),
    },
    createRuntime: (ctx) => {
      const x = [0, 0];
      return {
        beforeStep() {
          for (const p of [0, 1])
            x[p] = Math.round((x[p]! + ctx.input.vector("move", p).x / 10) * 1000) / 1000;
        },
        snapshot: () => ({ x: [...x] }),
      };
    },
  }),
  scene: {
    v: SCENE_FORMAT_VERSION,
    name: "seats",
    game: "seats",
    bounds: [0, 0, 4, 2],
    entities: [{ id: "start", type: "marker", at: [0.5, 1], tags: ["spawn"] }],
  },
  script: {
    v: 2,
    players: 2,
    tracks: [
      { player: 0, steps: [{ set: { move: [1, 0] }, for: 12 }] },
      { player: 1, steps: [{ join: "pad:0" }, { set: { move: [0.5, 0] }, for: 30 }] },
    ],
  },
  expect: { result: "won", maxTicks: 22 },
};

type Taps = { taps: [tick: number, offset: number | null][] };

const tapsGame = (subTick: boolean) =>
  defineGame<Taps>({
    id: "taps",
    types: [],
    actions: [{ action: "tap", bindings: [{ device: "key", code: "Space" }], description: "Tap." }],
    input: { subTick },
    world: { physics: "none" },
    play: {
      results: ["won"],
      outcome: (s) => (s.snapshot.taps.length >= 3 ? { result: "won" } : null),
    },
    createRuntime: (ctx) => {
      const taps: Taps["taps"] = [];
      return {
        beforeStep(_dt, actions) {
          for (const a of actions)
            if (a.action === "tap" && a.pressed) taps.push([ctx.tick, a.offset ?? null]);
        },
        snapshot: () => ({ taps: structuredClone(taps) }),
      };
    },
  });

const tap = (tick: number, offset: number, pressed = true) =>
  tickInput(tick, { actions: [{ action: "tap", pressed, offset }] });

/** Taps a script can't write: each lands partway into its tick. */
const TAPS = [tap(2, 0.25), tap(3, 0, false), tap(6, 0.5), tap(7, 0, false), tap(9, 0.8)];
const WAIT: InputScript = { v: 1, steps: [{ wait: 12 }] };

const taps: GenreProbe<Taps> = {
  id: "harness-taps",
  rows: ["rhythm"],
  game: tapsGame(true),
  scene: {
    v: SCENE_FORMAT_VERSION,
    name: "taps",
    game: "taps",
    bounds: [0, 0, 2, 2],
    entities: [{ id: "start", type: "marker", at: [0.2, 0.2], tags: ["spawn"] }],
  },
  script: WAIT,
  ticks: TAPS,
  expect: { result: "won", maxTicks: 10 },
};

const PROBES = probesFrom(
  import.meta.glob<Record<string, unknown>>("./*.probe.ts", { eager: true }),
);

/** Every run in this file resolves to physics "none". */
const physicsFree = (probe: GenreProbe) =>
  probeRuns(probe).filter((r) => probePhysics(probe, r.variant) === "none");

afterAll(() => {
  expect(loadRapier).not.toHaveBeenCalled();
  expect(init).not.toHaveBeenCalled();
});

async function expectPhysicsFree(probe: GenreProbe, name: string, variant?: ProbeVariant) {
  const run = await runGenreProbe(probe, variant);
  const label = `${probe.id} ${name}`;
  expect(run.usedRapier, label).toBe(false);
  expect(run.report.outcome.result, label).toBe(probe.expect.result);
  if (probe.expect.maxTicks !== undefined)
    expect(run.report.ticks, label).toBeLessThanOrEqual(probe.expect.maxTicks);
  expect(run.replay.matches, label).toBe(true);
  if (variant?.saveAt !== undefined) {
    expect(run.fromSave?.save.depth, label).toBe("world");
    expect(run.fromSave?.outcome, label).toStrictEqual(run.report.outcome);
    expect(run.fromSave?.digest, label).toBe(run.digest);
  }
  expect(init, label).not.toHaveBeenCalled();
  expect(loadRapier, label).not.toHaveBeenCalled();
  return run;
}

describe("physics-free genre runs never load Rapier", () => {
  it("leaves a variant that asks for Rapier out of this file", () => {
    expect(physicsFree(counter as GenreProbe).map((r) => r.name)).toStrictEqual([
      "default",
      "gravity-zero",
      "seed-7",
      "saved",
    ]);
  });

  it("plays a run on from a world save to the uninterrupted run's digest", async () => {
    const saved = (counter.variants ?? []).find((v) => v.name === "saved")!;
    const run = await expectPhysicsFree(counter as GenreProbe, saved.name, saved);
    expect(run.fromSave).toMatchObject({ at: 4, saved: { ticks: 5 }, final: { ticks: 10 } });
    expect(run.fromSave?.save.data).toStrictEqual({ ticks: 5 });
    expect(run.fromSave?.ticks).toBe(run.report.ticks);
    expect(run.fromSave?.slots).toBe(run.report.slots);
  });

  it("refuses a save taken after the run ended, and a world save of a game with no restore", async () => {
    await expect(
      runGenreProbe(counter as GenreProbe, { name: "late", saveAt: 40 }),
    ).rejects.toThrow(/ended before tick 40/);
    const game = defineGame<{ ticks: number }>({
      ...counter.game,
      createRuntime: () => {
        let ticks = 0;
        return { afterStep: () => void ticks++, snapshot: () => ({ ticks }) };
      },
    });
    await expect(
      runGenreProbe({ ...counter, game } as GenreProbe, { name: "saved", saveAt: 4 }),
    ).rejects.toThrow(/the capture: .*save-unsupported/);
  });

  it.each(physicsFree(counter as GenreProbe))(
    "the harness plays and replays $name with rapier: null",
    async ({ name, variant }) => {
      const run = await expectPhysicsFree(counter as GenreProbe, name, variant);
      expect(run.report.recording.engine.physics).toBeNull();
      expect(run.digest).toMatch(/^[0-9a-f]{16}$/);
      const seed = variant?.seed ?? defaultSeed("counter", "counter");
      expect(run.report.recording.seed).toBe(seed);
      expect(run.replay.recording.seed).toBe(seed);
    },
  );

  it("plays a two-track script, one seat per track, and replays it", async () => {
    const run = await expectPhysicsFree(seats as GenreProbe, "default");
    expect(run.report.final).toStrictEqual({ x: [2.1, 1] });
    expect(run.report.ticks).toBe(21);
    expect(run.report.recording.inputs).toHaveLength(2);
    expect(run.report.recording.players.map((p) => p.devices)).toContainEqual(["pad:0"]);
    const steps = run.report.steps
      .map((s) => [s.player ?? 0, s.index, s.start])
      .sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!);
    expect(steps).toStrictEqual([
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 1],
    ]);
  });

  it("feeds tick inputs with sub-tick offsets, and the replay reproduces each", async () => {
    const run = await expectPhysicsFree(taps as GenreProbe, "default");
    const seen = [
      [2, 0.25],
      [6, 0.5],
      [9, 0.8],
    ];
    expect(run.report.final).toStrictEqual({ taps: seen });
    expect(run.replay.final).toStrictEqual({ taps: seen });
    expect(run.report.recording.end).toBe(run.replay.recording.end);
    expect(run.report.outcome).toMatchObject({ result: "won", tick: 9 });
  });

  it("ends tick inputs as script-end when the script's waits run out", async () => {
    const short = {
      ...taps,
      script: { v: 2, tracks: [{ player: 0, steps: [{ wait: 2 }, { wait: 3 }] }] },
      ticks: [tap(1, 0.5)],
      expect: { result: "script-end" },
    } as GenreProbe;
    const run = await expectPhysicsFree(short, "short");
    expect(run.report.ticks).toBe(5);
    expect(run.report.final).toStrictEqual({ taps: [[1, 0.5]] });
  });

  it("refuses an offset the game wouldn't record, a slot named twice or past the waits, and steps", () => {
    const run =
      (game: GameDefinition, ticks: TickInput[], script: InputScript = WAIT) =>
      () =>
        playTicks({ rapier: null, game, scene: taps.scene, script, ticks });
    expect(run(tapsGame(false), TAPS)).toThrow(/input\.subTick/);
    expect(run(tapsGame(true), [tap(1, 0.5), tap(1, 0.6)])).toThrow(/slot 1 twice/);
    expect(run(tapsGame(true), [tap(12, 0.5)])).toThrow(/slot 12, outside the script's 12/);
    expect(run(tapsGame(true), TAPS, { v: 1, steps: [{ press: "tap" }] })).toThrow(
      /only wait steps/,
    );
  });

  it("gives every physics-free probe a world-save variant pinned to the run it continues", () => {
    const unsaved = PROBES.filter((probe) => {
      const runs = physicsFree(probe);
      return runs.length > 0 && !runs.some((r) => r.variant?.saveAt !== undefined);
    });
    expect(unsaved.map((p) => p.id)).toStrictEqual([]);
    for (const probe of PROBES)
      for (const { name, variant } of physicsFree(probe)) {
        if (variant?.saveAt === undefined) continue;
        const { saveAt: _at, name: _name, ...rest } = variant;
        const continued = physicsFree(probe).find(
          (r) =>
            r.variant?.saveAt === undefined &&
            JSON.stringify(r.variant?.settings ?? {}) === JSON.stringify(rest.settings ?? {}) &&
            r.variant?.seed === rest.seed,
        );
        expect(continued, `${probe.id} ${name}`).toBeDefined();
        expect(GENRE_PINS[probe.id]?.[name], `${probe.id} ${name}`).toBe(
          GENRE_PINS[probe.id]?.[continued!.name],
        );
      }
  });

  for (const probe of PROBES) {
    const runs = physicsFree(probe);
    if (runs.length === 0) continue;
    describe(probe.id, () => {
      it.each(runs)(
        "$name",
        async ({ name, variant }) => {
          const run = await expectPhysicsFree(probe, name, variant);
          if (!process.env.UPDATE_GENRE_PINS) expect(run.digest).toBe(GENRE_PINS[probe.id]?.[name]);
        },
        probeTimeout(probe),
      );
    });
  }
});
