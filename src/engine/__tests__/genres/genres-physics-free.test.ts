// @vitest-environment node
import { afterAll, describe, expect, it, vi } from "vite-plus/test";

import { defineGame } from "../../game/define";
import { SCENE_FORMAT_VERSION } from "../../scene/types";
import {
  loadRapier,
  probePhysics,
  probeRuns,
  probeTimeout,
  probesFrom,
  runGenreProbe,
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
    actions: [{ action: "go", keys: ["space"], description: "Go." }],
    world: { physics: "none" },
    play: {
      results: ["won"],
      outcome: (s) => (s.snapshot.ticks >= 10 ? { result: "won" } : null),
    },
    createRuntime: () => {
      let ticks = 0;
      return { afterStep: () => void ticks++, snapshot: () => ({ ticks }) };
    },
  }),
  scene: {
    v: SCENE_FORMAT_VERSION,
    name: "counter",
    game: "counter",
    bounds: [0, 0, 200, 200],
    entities: [{ id: "start", type: "marker", at: [20, 20], tags: ["spawn"] }],
  },
  script: { v: 1, steps: [{ hold: ["go"], for: 4 }, { wait: 20 }] },
  expect: { result: "won", maxTicks: 11 },
  variants: [
    { name: "gravity-zero", settings: { gravity: [0, 0] } },
    { name: "rapier", settings: { physics: "rapier" } },
    { name: "seed-7", seed: 7 },
  ],
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
    ]);
  });

  it.each(physicsFree(counter as GenreProbe))(
    "the harness plays and replays $name with rapier: null",
    async ({ name, variant }) => {
      const run = await expectPhysicsFree(counter as GenreProbe, name, variant);
      expect(run.report.recording.engine.physics).toBe("none");
      expect(run.digest).toMatch(/^[0-9a-f]{16}$/);
      expect(run.report.recording.start.seed).toBe(variant?.seed);
      expect(run.replay.recording.start.seed).toBe(variant?.seed);
    },
  );

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
