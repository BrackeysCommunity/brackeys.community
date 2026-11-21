import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vite-plus/test";

import type { PuzzleLayout, PuzzleLog } from "../src/api.ts";
import type { Family } from "../src/shell/kit.ts";
import { play, type Outcome } from "../src/shell/play.ts";

/** Where sim/puzzle's TestGolden writes its vectors, one file a family. */
export const GOLDEN_DIR = resolve(
  import.meta.dirname,
  "../../mmo-world/sim/puzzle/testdata/golden",
);

/** Where TestShapesGolden writes each family's shape 1 vectors, in the same format. */
export const SHAPES_DIR = resolve(
  import.meta.dirname,
  "../../mmo-world/sim/puzzle/testdata/shapes",
);

export interface GoldenLog {
  name: string;
  master: boolean;
  log: PuzzleLog;
  outcome: Outcome;
  trace: { i: number; at: number; state: number[] }[];
}

export interface GoldenCase {
  name: string;
  countdown: number;
  horizon: number;
  layout: PuzzleLayout;
  inner: PuzzleLayout;
  logs: GoldenLog[];
}

export function goldenCases(family: string, dir = GOLDEN_DIR): GoldenCase[] {
  return JSON.parse(readFileSync(`${dir}/${family}.json`, "utf8")).cases;
}

/** The states a play passed through, by index, as the vectors count them. */
export type Seen = { at: number; state: number[] }[];

/**
 * Holds a trace the vectors thinned against every state a play passed
 * through: the last one's index counts them all.
 */
export function expectTrace(states: Seen, trace: GoldenLog["trace"]): void {
  expect(states.length).toBe(trace.at(-1)!.i + 1);
  for (const want of trace)
    expect({ i: want.i, ...states[want.i] }).toEqual({
      i: want.i,
      at: want.at,
      state: want.state,
    });
}

/**
 * Holds a scene's model to the Go replay: every log of every case gives
 * the same outcome and passes through the same states. Call it from the
 * family's golden.test.ts, once for dir's default and once for SHAPES_DIR.
 */
export function goldenSuite(family: Family, dir = GOLDEN_DIR): void {
  const label = dir === GOLDEN_DIR ? "the Go vectors" : "the Go shape vectors";
  describe(`${family.id} against ${label}`, () => {
    const cases = goldenCases(family.id, dir);
    test("has vectors", () => {
      expect(cases.length).toBeGreaterThan(0);
    });
    for (const c of cases) {
      for (const l of c.logs) {
        test(`${c.name} ${l.name}`, () => {
          const states: Seen = [];
          const got = play(
            family,
            c.layout,
            l.master ? c.inner : undefined,
            l.log,
            c.horizon,
            (at, state) => states.push({ at, state }),
          );
          expect(got).toEqual(l.outcome);
          expectTrace(states, l.trace);
        });
      }
    }
  });
}
