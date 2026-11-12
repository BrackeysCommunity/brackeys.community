// @vitest-environment node
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vite-plus/test";

import {
  PROBE_TIMEOUT_MS,
  fuzzGenreProbe,
  probePhysics,
  probeRuns,
  probeTimeout,
  probesFrom,
  runGenreProbe,
} from "./harness";
import { GENRE_PINS } from "./pins";

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

describe("genre probes", () => {
  it("finds every probe", () => {
    const ids = PROBES.map((p) => p.id);
    for (const id of [
      "grid-puzzle",
      "local-versus",
      "point-and-click",
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
