import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vite-plus/test";

import type { PuzzleLayout, PuzzleLog, PuzzleResult } from "../src/api.ts";
import type { Family } from "../src/shell/kit.ts";
import type { PartyVersion } from "../src/shell/party-registry.ts";
import { play, type Outcome } from "../src/shell/play.ts";
import { expectTrace, type Seen } from "./golden.ts";

/** Where sim/puzzle's TestPartyGolden writes its vectors, one file a version. */
export const PARTY_DIR = resolve(import.meta.dirname, "../../mmo-world/sim/puzzle/testdata/party");

export interface PartyLog {
  name: string;
  log: PuzzleLog;
  outcome: Outcome;
  result: PuzzleResult;
  trace: { i: number; at: number; state: number[] }[];
}

export interface PartyCase {
  name: string;
  spec: {
    family: string;
    level: number;
    tier: number;
    party: string;
    seats: number;
    shape?: number;
  };
  countdown: number;
  horizon: number;
  /** The whole layout. */
  layout: PuzzleLayout;
  /** Each seat's dealt part, seat 0 first. */
  parts: PuzzleLayout[];
  logs: PartyLog[];
}

export interface PartyFile {
  version: string;
  family: string;
  cases: PartyCase[];
}

export function partyFile(version: string): PartyFile {
  return JSON.parse(readFileSync(`${PARTY_DIR}/${version}.json`, "utf8"));
}

export function partyCases(version: string): PartyCase[] {
  return partyFile(version).cases;
}

// play() runs any model the way RunLog does; a version needs no scene for it.
function asFamily(v: PartyVersion): Family {
  return {
    id: v.id,
    start: (layout) => v.start(layout),
    mount: () => {
      throw new Error(`${v.id} is replayed here, not drawn`);
    },
  };
}

/** One merged log through a version's model on the whole layout, with the states it passed. */
export function partyPlay(
  v: PartyVersion,
  layout: PuzzleLayout,
  log: PuzzleLog,
  horizon: number,
): { outcome: Outcome; states: Seen } {
  const states: Seen = [];
  const outcome = play(asFamily(v), layout, undefined, log, horizon, (at, state) =>
    states.push({ at, state }),
  );
  return { outcome, states };
}

/**
 * Holds a party version's model to the Go replay: every log of every case
 * (seats 2 to 4, both shapes) played on the whole layout gives the same
 * outcome through the same states, and the same again when played twice.
 * Call it from the version's golden.test.ts.
 */
export function partySuite(v: PartyVersion): void {
  describe(`${v.id} against the Go party vectors`, () => {
    const file = partyFile(v.id);
    test("is the version and family the vectors name", () => {
      expect(file.version).toBe(v.id);
      expect(file.family).toBe(v.family);
      expect(file.cases.length).toBeGreaterThan(0);
    });
    for (const c of file.cases) {
      for (const l of c.logs) {
        test(`${c.name} ${l.name}`, () => {
          const first = partyPlay(v, c.layout, l.log, c.horizon);
          expect(first.outcome).toEqual(l.outcome);
          expectTrace(first.states, l.trace);
          const again = partyPlay(v, c.layout, l.log, c.horizon);
          expect(again).toEqual(first);
        });
      }
      test(`${c.name} starts on every seat's dealt part`, () => {
        expect(c.parts).toHaveLength(c.spec.seats);
        for (const part of c.parts) expect(() => v.start(part).snapshot()).not.toThrow();
      });
    }
  });
}
