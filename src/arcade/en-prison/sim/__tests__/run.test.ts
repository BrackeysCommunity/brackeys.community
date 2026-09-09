import { describe, expect, it } from "vite-plus/test";

import {
  BASE_NUDGES,
  CASINOS,
  casinoOf,
  isBossTable,
  MINIMUM_BETS,
  nextTable,
  openRun,
  QUOTAS,
  runSummary,
  settleTable,
  SPINS_PER_TABLE,
  spinSeed,
  STARTING_BANKROLL,
  TABLES_PER_CASINO,
  tableRules,
  TOTAL_TABLES,
} from "../run.ts";
import type { TableClose } from "../table.ts";

function close(overrides: Partial<TableClose> = {}): TableClose {
  return {
    cleared: true,
    quota: 60,
    counted: 200,
    surplus: 140,
    released: 0,
    heat: 3,
    spins: SPINS_PER_TABLE,
    ...overrides,
  };
}

describe("the run's shape", () => {
  it("is four casinos of three tables", () => {
    expect(CASINOS).toHaveLength(4);
    expect(TABLES_PER_CASINO).toBe(3);
    expect(TOTAL_TABLES).toBe(12);
  });

  it("has a quota and a minimum for every table", () => {
    expect(QUOTAS).toHaveLength(TOTAL_TABLES);
    expect(MINIMUM_BETS).toHaveLength(TOTAL_TABLES);
  });

  it("keeps both curves rising", () => {
    // A quota that dipped would make a later table easier than an earlier
    // one, and a minimum that dipped would let a built wheel stop covering.
    for (let i = 1; i < TOTAL_TABLES; i++) {
      expect(QUOTAS[i]!).toBeGreaterThan(QUOTAS[i - 1]!);
      expect(MINIMUM_BETS[i]!).toBeGreaterThanOrEqual(MINIMUM_BETS[i - 1]!);
    }
  });

  it("keeps both curves whole chips", () => {
    for (const n of [...QUOTAS, ...MINIMUM_BETS]) expect(Number.isInteger(n)).toBe(true);
  });

  it("opens gently enough that the first table is not a coin flip", () => {
    // Eight spins at the table-one minimum on a fair wheel barely moves the
    // starting bankroll, so table one has to be clearable without a build.
    expect(QUOTAS[0]!).toBeLessThan(STARTING_BANKROLL);
  });

  it("puts a boss at the end of every casino and nowhere else", () => {
    const bosses = Array.from({ length: TOTAL_TABLES }, (_, i) => i).filter(isBossTable);
    expect(bosses).toEqual([2, 5, 8, 11]);
  });

  it("steps into every boss harder than into any ordinary table", () => {
    // `07`: "A boss table's quota is also higher." Measured as a ratio, not
    // a difference -- on an accelerating curve every later difference is
    // bigger than every earlier one, so differences prove nothing.
    const step = (i: number) => QUOTAS[i]! / QUOTAS[i - 1]!;
    const boss: number[] = [];
    const ordinary: number[] = [];
    for (let i = 1; i < TOTAL_TABLES; i++) (isBossTable(i) ? boss : ordinary).push(step(i));
    expect(Math.min(...boss)).toBeGreaterThan(Math.max(...ordinary));
  });

  it("makes the first table of a casino the gentlest step", () => {
    // Heat has just reset and a floor has just been spent, so the run
    // breathes here rather than at the boss.
    const step = (i: number) => QUOTAS[i]! / QUOTAS[i - 1]!;
    for (const first of [3, 6, 9]) {
      expect(step(first)).toBeLessThan(step(first + 1));
      expect(step(first)).toBeLessThan(step(first + 2));
    }
  });
});

describe("casinoOf", () => {
  it("walks the four casinos in order", () => {
    expect([0, 1, 2].map(casinoOf)).toEqual(["downtown", "downtown", "downtown"]);
    expect(casinoOf(3)).toBe("the strip");
    expect(casinoOf(6)).toBe("old europe");
    expect(casinoOf(11)).toBe("the private room");
  });
});

describe("tableRules", () => {
  it("gives every table eight spins and the run's allowance", () => {
    for (let i = 0; i < TOTAL_TABLES; i++) {
      expect(tableRules(i)).toEqual({
        spins: SPINS_PER_TABLE,
        minimumBet: MINIMUM_BETS[i],
        quota: QUOTAS[i],
        nudges: BASE_NUDGES,
      });
    }
  });

  it("refuses a table past the end of a run", () => {
    expect(() => tableRules(TOTAL_TABLES)).toThrow(RangeError);
    expect(() => tableRules(-1)).toThrow(RangeError);
  });
});

describe("openRun", () => {
  it("starts on table one with the starting bankroll", () => {
    const run = openRun("seed");
    expect(run).toMatchObject({ tableIndex: 0, bankroll: STARTING_BANKROLL, status: "playing" });
    expect(run.tables).toEqual([]);
  });

  it("takes a bankroll override for a starter wheel or a stake", () => {
    expect(openRun("seed", 40).bankroll).toBe(40);
  });
});

describe("nextTable", () => {
  it("describes the table about to be played", () => {
    expect(nextTable(openRun("seed"))).toMatchObject({
      index: 0,
      casino: "downtown",
      indexInCasino: 0,
      boss: false,
    });
  });

  it("refuses once the run is over", () => {
    const busted = settleTable(openRun("seed"), close({ cleared: false }));
    expect(() => nextTable(busted)).toThrow();
  });
});

describe("settleTable", () => {
  it("carries the whole count into the next table, not the surplus", () => {
    // The quota is a bar to clear, not a debt to pay. Taking it made buying
    // anything strictly worse than buying nothing once the floor had prices
    // -- see `closeTable`.
    const run = settleTable(openRun("seed"), close({ counted: 200, quota: 60, surplus: 140 }));
    expect(run.bankroll).toBe(200);
    expect(run.tableIndex).toBe(1);
    expect(run.status).toBe("playing");
  });

  it("still reports the surplus, which is what the floor may spend", () => {
    const run = settleTable(openRun("seed"), close({ counted: 200, quota: 60, surplus: 140 }));
    expect(run.tables[0]!.surplus).toBe(140);
  });

  it("ends the run on a miss, before the floor", () => {
    const run = settleTable(openRun("seed"), close({ cleared: false, counted: 59, surplus: 0 }));
    expect(run.status).toBe("busted");
    expect(run.bankroll).toBe(0);
    expect(run.tableIndex).toBe(0);
    expect(run.tables).toHaveLength(1);
  });

  it("carries heat between tables inside a casino", () => {
    const run = settleTable(openRun("seed"), close({ heat: 4 }));
    expect(run.heat).toBe(4);
  });

  it("resets heat on the way to the next casino", () => {
    // Which is what makes finishing a boss table hot a real play.
    let run = openRun("seed");
    run = settleTable(run, close({ heat: 2 }));
    run = settleTable(run, close({ heat: 5 }));
    expect(run.heat).toBe(5);
    run = settleTable(run, close({ heat: 9 }));
    expect(run.tableIndex).toBe(3);
    expect(casinoOf(3)).toBe("the strip");
    expect(run.heat).toBe(0);
  });

  it("clears the run after the twelfth table", () => {
    let run = openRun("seed");
    for (let i = 0; i < TOTAL_TABLES; i++) run = settleTable(run, close());
    expect(run.status).toBe("cleared");
    expect(run.tableIndex).toBe(TOTAL_TABLES);
    expect(run.tables).toHaveLength(TOTAL_TABLES);
  });

  it("refuses to settle a run that is already over", () => {
    const busted = settleTable(openRun("seed"), close({ cleared: false }));
    expect(() => settleTable(busted, close())).toThrow();
  });

  it("does not mutate the run it was given", () => {
    const run = openRun("seed");
    const snapshot = JSON.stringify(run);
    settleTable(run, close());
    expect(JSON.stringify(run)).toBe(snapshot);
  });
});

describe("spinSeed", () => {
  it("gives every spin of every table its own seed", () => {
    const run = openRun("daily:2026-09-07");
    const seeds = new Set<string>();
    for (let t = 0; t < TOTAL_TABLES; t++) {
      for (let s = 0; s < SPINS_PER_TABLE; s++) seeds.add(spinSeed(run, t, s));
    }
    expect(seeds.size).toBe(TOTAL_TABLES * SPINS_PER_TABLE);
  });

  it("is stable for a run seed, which is what a daily seed rests on", () => {
    expect(spinSeed(openRun("d"), 3, 4)).toBe(spinSeed(openRun("d"), 3, 4));
    expect(spinSeed(openRun("d"), 3, 4)).not.toBe(spinSeed(openRun("e"), 3, 4));
  });
});

describe("runSummary", () => {
  it("reports a finished run's tables and status", () => {
    let run = openRun("seed");
    run = settleTable(run, close({ quota: 60, counted: 200, surplus: 140 }));
    run = settleTable(run, close({ cleared: false, quota: 100, counted: 90, surplus: 0 }));
    const summary = runSummary(run);
    expect(summary.status).toBe("busted");
    expect(summary.tablesCleared).toBe(1);
    expect(summary.tables).toHaveLength(2);
    expect(summary.tables[1]).toMatchObject({ cleared: 0, counted: 90 });
  });

  it("holds only integers beside the status", () => {
    let run = openRun("seed");
    for (let i = 0; i < 3; i++) run = settleTable(run, close());
    const summary = runSummary(run);
    expect(Number.isInteger(summary.bankroll)).toBe(true);
    for (const table of summary.tables) {
      for (const value of Object.values(table)) expect(Number.isInteger(value)).toBe(true);
    }
  });
});
