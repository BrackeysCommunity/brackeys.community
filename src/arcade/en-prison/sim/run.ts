/**
 * A run: four casinos, three tables each, twelve tables and a shark.
 *
 * This layer owns only what outlives a table — which casino you are in, the
 * bankroll travelling between them, and whether the run is still alive. The
 * floor between tables (the five shops and the cage) spends the surplus
 * this produces and is not built yet; `settleTable` hands the budget over
 * and takes back whatever the floor left.
 */

import { type TableClose, type TableRules, tableSummary } from "./table.ts";

export const CASINOS = ["downtown", "the strip", "old europe", "the private room"] as const;
export type Casino = (typeof CASINOS)[number];

export const TABLES_PER_CASINO = 3;
export const TOTAL_TABLES = CASINOS.length * TABLES_PER_CASINO;
export const SPINS_PER_TABLE = 8;
export const STARTING_BANKROLL = 120;

/**
 * The curves, as plain arrays rather than a formula.
 *
 * The shape inside a casino is deliberate: the second table asks for half
 * again, the boss asks for four fifths again, and the first table of the
 * next casino is the gentlest step in the run because heat has just reset
 * and a floor has just been spent. Every boss step is steeper than every
 * ordinary one, which is `07`'s "a boss table's quota is also higher".
 *
 * Twelve numbers are easier to read, easier to argue with, and easier to
 * tune from playtest notes than a growth rate — and a formula would want an
 * exponent, which the sim cannot have: the determinism guard bans `**`
 * because it is float maths.
 *
 * None of this has been played. The shape is the intent — table one is
 * gentle, every third table is a boss and jumps, and the last casino is
 * where a run that has not compounded dies — but the numbers themselves are
 * a first guess and are meant to be edited.
 */
export const QUOTAS: readonly number[] = [
  // downtown          the strip           old europe          private room
  60, 90, 160, /**/ 220, 330, 590, /**/ 800, 1200, 2150, /**/ 2900, 4350, 7800,
];

export const MINIMUM_BETS: readonly number[] = [1, 1, 2, 2, 3, 4, 5, 7, 9, 12, 16, 20];

/** Nudges per table. `07` starts a run at one; the rest is bought. */
export const BASE_NUDGES = 1;

export type RunStatus = "playing" | "cleared" | "busted";

export type RunState = {
  seed: string;
  /** Which of the twelve tables is next, or `TOTAL_TABLES` when the run is done. */
  tableIndex: number;
  bankroll: number;
  status: RunStatus;
  /** Heat carried inside the current casino. Reset on moving to the next. */
  heat: number;
  /** Chips owed to the marker desk, added to the next quota. */
  debt: number;
  /** Cage pulls since one landed above the floor, carried across tables. */
  pity: number;
  tables: readonly TableClose[];
};

export function openRun(seed: string, bankroll: number = STARTING_BANKROLL): RunState {
  return {
    seed,
    tableIndex: 0,
    bankroll,
    status: "playing",
    heat: 0,
    debt: 0,
    pity: 0,
    tables: [],
  };
}

export function casinoOf(tableIndex: number): Casino {
  return CASINOS[Math.floor(tableIndex / TABLES_PER_CASINO)] ?? CASINOS[CASINOS.length - 1]!;
}

export function isBossTable(tableIndex: number): boolean {
  return tableIndex % TABLES_PER_CASINO === TABLES_PER_CASINO - 1;
}

/**
 * `debt` is what the marker desk wrote against this table. `07` calls the
 * marker "credit against the next quota", so it lands on the number rather
 * than on the bankroll: the chips were spent on the floor, and what is owed
 * is a harder table.
 */
export function tableRules(tableIndex: number, debt = 0): TableRules {
  const quota = QUOTAS[tableIndex];
  const minimumBet = MINIMUM_BETS[tableIndex];
  if (quota === undefined || minimumBet === undefined) {
    throw new RangeError(`no table ${tableIndex}; a run is ${TOTAL_TABLES} tables`);
  }
  return { spins: SPINS_PER_TABLE, minimumBet, quota: quota + debt, nudges: BASE_NUDGES };
}

/** Everything the shell needs to open the next table. */
export function nextTable(run: RunState): {
  index: number;
  casino: Casino;
  indexInCasino: number;
  boss: boolean;
  rules: TableRules;
} {
  if (run.status !== "playing") throw new Error(`run is ${run.status}, not playing`);
  return {
    index: run.tableIndex,
    casino: casinoOf(run.tableIndex),
    indexInCasino: run.tableIndex % TABLES_PER_CASINO,
    boss: isBossTable(run.tableIndex),
    rules: tableRules(run.tableIndex, run.debt),
  };
}

/**
 * Books what the floor did between two tables.
 *
 * The floor is where the surplus goes, so the run takes back whatever is
 * left of it, plus the debt and heat the marker desk wrote and the cage's
 * pity counter. Debt is cleared as it is applied: a marker is credit
 * against *the next* quota, not a standing loan.
 */
export function settleFloor(run: RunState, floor: FloorSettlement): RunState {
  if (run.status !== "playing") throw new Error(`run is ${run.status}, not playing`);
  return {
    ...run,
    bankroll: floor.bankroll,
    debt: floor.debt,
    heat: run.heat + floor.heat,
    pity: floor.pity,
  };
}

/** What `settleFloor` needs from a floor visit, without importing one. */
export type FloorSettlement = {
  bankroll: number;
  debt: number;
  heat: number;
  pity: number;
};

/**
 * Books a finished table against the run.
 *
 * A miss ends the run there and then, before the floor: `07` is explicit
 * that the check happens "after the eighth spin, before you reach the
 * floor", and that ordering is what keeps a single-currency economy fair.
 * A player who spends down to the quota and then finds out is a player who
 * was never told the number in time.
 *
 * Heat carries between tables inside a casino and resets on the way to the
 * next one, which is what makes finishing a boss table hot a real play.
 */
export function settleTable(run: RunState, close: TableClose): RunState {
  if (run.status !== "playing") throw new Error(`run is ${run.status}, not playing`);

  const tables = [...run.tables, close];
  if (!close.cleared) {
    return { ...run, status: "busted", bankroll: 0, heat: close.heat, tables };
  }

  const nextIndex = run.tableIndex + 1;
  const movingCasino = casinoOf(nextIndex) !== casinoOf(run.tableIndex);
  return {
    ...run,
    tableIndex: nextIndex,
    // The whole count carries, not the surplus: the quota is a bar to clear,
    // not a debt to pay. `closeTable` explains why.
    bankroll: close.counted,
    status: nextIndex >= TOTAL_TABLES ? "cleared" : "playing",
    heat: movingCasino ? 0 : close.heat,
    // The marker is settled by the table it was written against.
    debt: 0,
    tables,
  };
}

/** The seed a given table's given spin draws from. */
export function spinSeed(run: RunState, tableIndex: number, spinIndex: number): string {
  return `${run.seed}:t${tableIndex}:s${spinIndex}`;
}

/**
 * What the validator grades a run on. `tableSummary` is per table; this is
 * the run-level shape, and the two together are what a `run` row's declared
 * result has to match.
 */
export function runSummary(run: RunState) {
  return {
    status: run.status,
    tablesCleared: run.tables.filter((t) => t.cleared).length,
    bankroll: run.bankroll,
    debt: run.debt,
    tables: run.tables.map((t) => ({
      quota: t.quota,
      counted: t.counted,
      surplus: t.surplus,
      cleared: t.cleared ? 1 : 0,
      spins: t.spins,
      heat: t.heat,
    })),
  };
}

export { tableSummary };
