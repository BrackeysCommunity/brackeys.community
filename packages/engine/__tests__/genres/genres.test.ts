// @vitest-environment node
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it, vi } from "vite-plus/test";

import { defineGame } from "../../game/define";
import { SCENE_FORMAT_VERSION } from "../../scene/types";
import {
  PROBE_TIMEOUT_MS,
  fuzzGenreProbe,
  probePhysics,
  probeRuns,
  probeTimeout,
  probesFrom,
  runGenreProbe,
  viewGenreProbe,
  type GenreProbe,
  type ProbeRun,
  type ProbeVariant,
} from "./harness";
import { GENRE_PINS } from "./pins";

vi.mock("../../renderer", async () => (await import("./harness")).stubbedRenderer());

const PROBES = probesFrom(
  import.meta.glob<Record<string, unknown>>("./*.probe.ts", { eager: true }),
);
const UPDATE = !!process.env.UPDATE_GENRE_PINS;
const PINS_FILE = fileURLToPath(new URL("./pins.ts", import.meta.url));

const HEADER = `/**
 * Each genre probe's digest, by probe id and variant (\`default\` is the run
 * without one). CI's x86_64 runners compare against these, so a mismatch
 * there means a run doesn't reproduce across machines. Written by
 * \`UPDATE_GENRE_PINS=1 vp test packages/engine/__tests__/genres/genres.test.ts\`.
 */
`;

const key = (name: string) => (/^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name));

function renderPins(pins: Record<string, Record<string, string>>): string {
  const ids = Object.keys(pins).sort();
  const type = "Readonly<Record<string, Readonly<Record<string, string>>>>";
  if (ids.length === 0) return `${HEADER}export const GENRE_PINS: ${type} = {};\n`;
  const body = ids.map((id) => {
    const runs = pins[id]!;
    const lines = Object.keys(runs)
      .sort()
      .map((name) => `    ${key(name)}: ${JSON.stringify(runs[name])},\n`);
    return `  ${key(id)}: {\n${lines.join("")}  },\n`;
  });
  return `${HEADER}export const GENRE_PINS: ${type} = {\n${body.join("")}};\n`;
}

const fresh: Record<string, Record<string, string>> = {};

afterAll(() => {
  if (!UPDATE) return;
  const next: Record<string, Record<string, string>> = {};
  for (const probe of PROBES) {
    for (const { name } of probeRuns(probe)) {
      const digest = fresh[probe.id]?.[name] ?? GENRE_PINS[probe.id]?.[name];
      if (digest !== undefined) (next[probe.id] ??= {})[name] = digest;
    }
  }
  writeFileSync(PINS_FILE, renderPins(next));
});

/**
 * Replays `run` in the shell with a view and holds it to the headless run:
 * the same end, ticks, events and presentation requests, the probe's
 * viewports where it put them, and every viewport after the first drawn.
 */
async function expectViewRun(probe: GenreProbe, run: ProbeRun, variant?: ProbeVariant) {
  const label = `${probe.id} ${variant?.name ?? "default"} with a view`;
  const view = await viewGenreProbe(probe, run, variant);
  expect(view.recording.end, label).toBe(run.report.recording.end);
  expect(view.recording.ticks, label).toBe(run.report.recording.ticks);
  expect(view.recording.outcome.result, label).toBe(run.report.recording.outcome.result);
  expect(view.events, label).toStrictEqual(run.report.events);
  if (run.report.present) expect(view.present, label).toStrictEqual(run.report.present);
  const declared = probe.viewports ?? [];
  expect(view.viewports, label).toStrictEqual(declared.map((_, i) => i));
  expect(view.surfaces, label).toHaveLength(Math.max(0, declared.length - 1));
  for (const draws of view.surfaces) expect(draws, label).toBeGreaterThan(0);
}

/**
 * The view run's own check, never pinned: a game that shakes the camera and
 * flashes every few ticks, under a main viewport and a minimap.
 */
const viewed: GenreProbe<{ ticks: number }> = {
  id: "harness-viewed",
  rows: ["local-multiplayer"],
  game: defineGame<{ ticks: number }>({
    id: "viewed",
    types: [],
    actions: [{ action: "go", keys: [" "], description: "Go." }],
    world: { physics: "none" },
    play: {
      results: ["won"],
      outcome: (s) => (s.snapshot.ticks >= 30 ? { result: "won" } : null),
    },
    createRuntime: (ctx) => {
      let ticks = 0;
      return {
        afterStep() {
          ticks++;
          if (ticks % 7 === 0) ctx.present.camera.shake(0.4);
          if (ticks % 10 === 0) ctx.present.effects.flash({ ms: 40 });
          if (ticks % 5 === 0) ctx.emit({ type: "beat", at: { x: 1, y: 1 }, data: { ticks } });
        },
        snapshot: () => ({ ticks }),
        restore: (s) => void (ticks = s.ticks),
      };
    },
  }),
  scene: {
    v: SCENE_FORMAT_VERSION,
    name: "viewed",
    game: "viewed",
    bounds: [0, 0, 8, 4.5],
    entities: [
      { id: "start", type: "marker", at: [1, 1], tags: ["spawn"] },
      { id: "far", type: "marker", at: [7, 3.5] },
    ],
  },
  script: { v: 1, steps: [{ hold: ["go"], for: 4 }, { wait: 60 }] },
  expect: { result: "won", maxTicks: 31 },
  recordPresentation: true,
  view: true,
  viewports: [
    { rect: [0, 0, 1, 1], frame: "main" },
    { rect: [0.75, 0, 0.25, 0.25], frame: "scene", border: { width: 2, color: 0x202020 } },
  ],
};

describe("the view run", () => {
  it("replays a run in the shell to the headless end, presenting what it asked for", async () => {
    const run = await runGenreProbe(viewed);
    expect(run.report.outcome.result).toBe("won");
    expect(run.withoutPresentation).toBe(run.digest);
    const kinds = (run.report.present ?? []).map((r) => `${r.tick}:${r.op.op}`);
    expect(kinds).toStrictEqual([
      "6:shake",
      "9:flash",
      "13:shake",
      "19:flash",
      "20:shake",
      "27:shake",
      "29:flash",
    ]);
    await expectViewRun(viewed, run);
  });
});

describe("genre probes", () => {
  it("finds every probe", () => {
    const ids = PROBES.map((p) => p.id);
    for (const id of [
      "grid-puzzle",
      "idle",
      "local-versus",
      "point-and-click",
      "racing",
      "rhythm-tap",
      "roguelike",
      "shooter",
      "top-down",
      "tower-defense",
      "turn-tactics",
    ])
      expect(ids).toContain(id);
  });

  it("pins exactly the probes and variants that exist", () => {
    if (UPDATE) return;
    const expected = Object.fromEntries(
      PROBES.map((p) => [
        p.id,
        probeRuns(p)
          .map((r) => r.name)
          .sort(),
      ]),
    );
    const pinned = Object.fromEntries(
      Object.entries(GENRE_PINS).map(([id, runs]) => [id, Object.keys(runs).sort()]),
    );
    expect(pinned, "rerun with UPDATE_GENRE_PINS=1").toStrictEqual(expected);
  });

  for (const probe of PROBES) {
    describe(probe.id, () => {
      it.each(probeRuns(probe))(
        "$name reaches its result, replays and matches its pin",
        async ({ name, variant }) => {
          const run = await runGenreProbe(probe, variant);
          const label = `${probe.id} ${name}`;
          expect(run.report.outcome.result, label).toBe(probe.expect.result);
          if (probe.expect.maxTicks !== undefined)
            expect(run.report.ticks, label).toBeLessThanOrEqual(probe.expect.maxTicks);
          expect(run.replay.divergence, label).toBeNull();
          expect(run.replay.matches, label).toBe(true);
          expect(run.replay.recording.end, label).toBe(run.report.recording.end);
          expect(run.usedRapier, label).toBe(probePhysics(probe, variant) === "rapier");
          if (variant?.saveAt !== undefined) {
            const saved = run.fromSave!;
            expect(saved.outcome, `${label} from a save`).toStrictEqual(run.report.outcome);
            expect(saved.final, `${label} from a save`).toStrictEqual(run.report.final);
            expect(saved.digest, `${label} from a save`).toBe(run.digest);
          }
          if (probe.recordPresentation) {
            expect(run.report.present, label).toBeDefined();
            expect(run.withoutPresentation, `${label} without presentation`).toBe(run.digest);
          }
          if (probe.view) await expectViewRun(probe, run, variant);
          if (UPDATE) (fresh[probe.id] ??= {})[name] = run.digest;
          else
            expect(run.digest, `${label}: rerun with UPDATE_GENRE_PINS=1`).toBe(
              GENRE_PINS[probe.id]?.[name],
            );
        },
        probeTimeout(probe),
      );

      const opts = probe.fuzz;
      if (opts)
        it(
          `fuzz: some of ${opts.rollouts} rollouts with seed ${opts.seed} ends ${opts.expect.result}`,
          async () => {
            const run = await fuzzGenreProbe(probe);
            expect(run.rollouts).toBe(opts.rollouts);
            expect(
              run.results[opts.expect.result] ?? 0,
              JSON.stringify(run.results),
            ).toBeGreaterThan(0);
          },
          opts.timeoutMs ?? PROBE_TIMEOUT_MS,
        );
    });
  }
});
