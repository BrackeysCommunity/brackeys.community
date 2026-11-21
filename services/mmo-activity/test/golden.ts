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

export function goldenCases(family: string): GoldenCase[] {
  return JSON.parse(readFileSync(`${GOLDEN_DIR}/${family}.json`, "utf8")).cases;
}

/**
 * Holds a scene's model to the Go replay: every log of every case gives
 * the same outcome and passes through the same states. Call it from the
 * family's golden.test.ts.
 */
export function goldenSuite(family: Family): void {
  describe(`${family.id} against the Go vectors`, () => {
    const cases = goldenCases(family.id);
    test("has vectors", () => {
      expect(cases.length).toBeGreaterThan(0);
    });
    for (const c of cases) {
      for (const l of c.logs) {
        test(`${c.name} ${l.name}`, () => {
          const states: { at: number; state: number[] }[] = [];
          const got = play(
            family,
            c.layout,
            l.master ? c.inner : undefined,
            l.log,
            c.horizon,
            (at, state) => states.push({ at, state }),
          );
          expect(got).toEqual(l.outcome);
          // The vectors keep the last state, so its index counts them all.
          expect(states.length).toBe(l.trace.at(-1)!.i + 1);
          for (const want of l.trace)
            expect({ i: want.i, ...states[want.i] }).toEqual({
              i: want.i,
              at: want.at,
              state: want.state,
            });
        });
      }
    }
  });
}
