/**
 * A table: eight spins, one bankroll, and a number the loan shark wants at
 * the end of them.
 *
 * This is the layer that turns `spin` from a function into a game. It owns
 * everything that lives longer than one spin and shorter than a run — the
 * bankroll, the nudge allowance, the stakes the felt is holding under En
 * Prison, and the heat the pit has built up — and it is where the rules
 * that constrain a bet live, because a bet the player cannot afford or that
 * ducks the table minimum has to be refused somewhere, and the sim is the
 * only place both the client and the validator run.
 *
 * Every function here is pure: state in, new state out. The validator
 * replays a whole table by folding `playSpin` over the input log.
 */

import { fpApply } from "../../sim-kit/index.ts";
import { type Bet, isLegalBet, resolveImprisoned } from "./bets.ts";
import { type BallInput, type SpinContext, type SpinResult, spin } from "./spin.ts";
import type { WheelState } from "./state.ts";
import { setBonuses } from "./upgrades.ts";
import { POCKET_COUNT } from "./wheel.ts";

export type TableRules = {
  /** Spins before the shark counts the bankroll. Eight, per `07`. */
  spins: number;
  /** Chips that have to be on the felt each spin. Rises through the run. */
  minimumBet: number;
  /** What the shark wants at the end, and takes. */
  quota: number;
  /** Nudges for the whole table, not per spin. */
  nudges: number;
};

export type TableSpin = {
  index: number;
  seed: string;
  bets: readonly Bet[];
  result: SpinResult;
  /** Stakes the felt was holding that came back this spin. */
  released: number;
  /** Stakes the felt was holding that the house kept. */
  taken: number;
  bankrollAfter: number;
  heatAfter: number;
};

export type TableState = {
  rules: TableRules;
  wheel: WheelState;
  bankroll: number;
  spinsPlayed: number;
  nudgesRemaining: number;
  /** Even-money stakes the felt is holding, resolved on the next spin. */
  imprisoned: readonly Bet[];
  heat: number;
  /** Times each number has been hit this table, which is what `hot` counts. */
  hits: readonly number[];
  /** Chips a `bank` pocket is holding. */
  banked: number;
  /** Numbers whose `wild` has fired. Once per table, per `07`. */
  wildSpent: readonly number[];
  spins: readonly TableSpin[];
};

export type TableClose = {
  cleared: boolean;
  quota: number;
  /** Bankroll at the moment the shark counted, before anything was taken. */
  counted: number;
  /** What goes to the floor. Zero on a miss, because the run is over. */
  surplus: number;
  /** Imprisoned stakes handed back because the table ran out of spins. */
  released: number;
  heat: number;
  spins: number;
};

export type BetRejection =
  | "table-closed"
  | "illegal-bet"
  | "below-minimum"
  | "over-bankroll"
  | "no-balls"
  | "unknown-ball";

export class BetRefused extends Error {
  readonly reason: BetRejection;

  constructor(reason: BetRejection) {
    super(`bet refused: ${reason}`);
    this.name = "BetRefused";
    this.reason = reason;
  }
}

/**
 * Heat, for now, is a counter and nothing else.
 *
 * `07` gives it thresholds that add standing detriments and a back-off at
 * the top, all of which belong with traps and events. The counter lives
 * here because the table is the only thing that outlives a spin and
 * outlives it by the right amount — heat resets between casinos — and
 * because a nudge that costs nothing to spend is a nudge with no decision
 * attached, so the accounting is worth having before the consequences are.
 */
const HEAT_PER_NUDGE = 1;
const HEAT_PER_JACKPOT = 2;
/** A payout at or above this multiple of the stake is one the pit notices. */
const BIG_WIN_MULTIPLE = 10;

export function openTable(wheel: WheelState, rules: TableRules, bankroll: number): TableState {
  // Tiers du cylindre buys the table an extra nudge. It is applied on the
  // way in rather than per spin, because `07` makes it "an extra nudge per
  // table" and the allowance has to be a single number the UI can show.
  const tiers = setBonuses(wheel.pockets).tiers ? 1 : 0;
  return {
    rules,
    wheel,
    bankroll,
    spinsPlayed: 0,
    nudgesRemaining: rules.nudges + tiers,
    imprisoned: [],
    heat: 0,
    hits: new Array<number>(POCKET_COUNT).fill(0),
    banked: 0,
    wildSpent: [],
    spins: [],
  };
}

export function isOpen(state: TableState): boolean {
  return state.spinsPlayed < state.rules.spins;
}

/**
 * Why a set of bets would be refused, or `null` if they stand.
 *
 * The minimum is measured against chips going down this spin. Stakes the
 * felt is already holding do not count toward it: the player has no way to
 * take them back, so letting them satisfy the minimum would mean a free
 * spin after every zero, which is the opposite of what `07` wants the
 * minimum for ("the exposure per spin is never zero").
 */
export function checkBets(
  state: TableState,
  bets: readonly Bet[],
  balls: readonly BallInput[],
): BetRejection | null {
  if (!isOpen(state)) return "table-closed";
  if (balls.length === 0) return "no-balls";

  const known = new Set(state.wheel.balls.map((ball) => ball.id));
  if (balls.some((ball) => !known.has(ball.ballId))) return "unknown-ball";

  for (const bet of bets) if (!isLegalBet(bet)) return "illegal-bet";

  const stake = totalStake(bets);
  if (stake < state.rules.minimumBet) return "below-minimum";
  if (stake > state.bankroll) return "over-bankroll";
  return null;
}

export function totalStake(bets: readonly Bet[]): number {
  return bets.reduce((sum, bet) => sum + bet.amount, 0);
}

/**
 * Plays one spin and returns the table after it.
 *
 * Order matters and is fixed here: the stake leaves the bankroll before the
 * wheel turns, this spin's pockets settle both the new bets and the stakes
 * held from last spin, and only then does anything come back. A player who
 * bets their whole bankroll and loses is at zero and cannot bet again,
 * which ends their table early on the minimum — that is the intended
 * failure, not a bug to route around.
 */
export function playSpin(
  state: TableState,
  bets: readonly Bet[],
  balls: readonly BallInput[],
  seed: string,
): TableState {
  const refusal = checkBets(state, bets, balls);
  if (refusal) throw new BetRefused(refusal);

  const context: SpinContext = {
    nudges: state.nudgesRemaining,
    hits: state.hits,
    banked: state.banked,
    wildSpent: state.wildSpent,
  };
  const result = spin(state.wheel, { bets, balls }, seed, context);
  const carried = resolveImprisoned(state.imprisoned, result.pockets);

  const stake = totalStake(bets);
  const bankroll = state.bankroll - stake + result.returned + carried.released;

  let heat = state.heat + result.nudgesUsed * HEAT_PER_NUDGE;
  if (result.samePocket.pairs > 0) heat += HEAT_PER_JACKPOT;
  if (stake > 0 && result.returned >= stake * BIG_WIN_MULTIPLE) heat += 1;
  // A cold pocket is the only thing that takes heat off inside a table, and
  // it cannot take it below zero.
  heat = Math.max(0, heat - result.heatRelief);

  // `hot` counts hits per number for the rest of the table.
  const hits = [...state.hits];
  for (const pocket of result.pockets) hits[pocket.number] = (hits[pocket.number] ?? 0) + 1;

  const record: TableSpin = {
    index: state.spinsPlayed,
    seed,
    bets,
    result,
    released: carried.released,
    taken: carried.taken,
    bankrollAfter: bankroll,
    heatAfter: heat,
  };

  return {
    ...state,
    bankroll,
    spinsPlayed: state.spinsPlayed + 1,
    nudgesRemaining: state.nudgesRemaining - result.nudgesUsed,
    imprisoned: result.outcomes.filter((o) => o.imprisoned > 0).map((o) => o.bet),
    heat,
    hits,
    banked: result.banked,
    wildSpent: [...state.wildSpent, ...result.wildSpent],
    spins: [...state.spins, record],
  };
}

/**
 * The shark counts.
 *
 * The quota is **met, not taken**. This was the other way round until the
 * floor existed to price it, and the measurement is what turned it over:
 * with the quota subtracted, buying anything is strictly worse than buying
 * nothing for the first several tables, because the bankroll resets to the
 * surplus every table and an upgrade comes out of the money you need to
 * clear the next number. Across 1500 runs at three price scales, meeting the
 * quota cleared roughly four times as often as paying it at every one.
 *
 * `07`'s "beat it and the surplus is your budget, because the floor spends
 * bankroll" reads fine either way, and better this way: the surplus is what
 * a player can *afford to spend* and still cover the next quota, which is
 * advice about the floor rather than a description of a subtraction. See
 * §Status in plan 30 for the numbers.
 *
 * Stakes the felt is still holding come back first. A bet imprisoned on the
 * eighth spin has no ninth spin to be released by, and keeping the player's
 * chips because the table ran out of spins is a rule nobody would accept at
 * a real wheel.
 */
export function closeTable(state: TableState): TableClose {
  // Both the felt's holdings come back before the count: a stake imprisoned
  // on the eighth spin has no ninth to free it, and a bank pocket that never
  // got its next hit is holding chips the player won.
  const released = state.imprisoned.reduce((sum, bet) => sum + bet.amount, 0) + state.banked;
  const counted = state.bankroll + released;
  const cleared = counted >= state.rules.quota;
  return {
    cleared,
    quota: state.rules.quota,
    counted,
    /** What the floor may spend without dropping under the next number. */
    surplus: cleared ? counted - state.rules.quota : 0,
    released,
    heat: state.heat,
    spins: state.spinsPlayed,
  };
}

/**
 * What the validator compares for a whole table. Same discipline as
 * `spinSummary`: every number a payout or a quota check depends on, and
 * nothing a renderer could move.
 */
export function tableSummary(state: TableState, close: TableClose) {
  return {
    spins: state.spins.map((s) => ({
      index: s.index,
      stake: s.result.stake,
      returned: s.result.returned,
      released: s.released,
      taken: s.taken,
      pockets: s.result.pockets.map((p) => p.number),
      bankroll: s.bankrollAfter,
    })),
    cleared: close.cleared ? 1 : 0,
    counted: close.counted,
    quota: close.quota,
    surplus: close.surplus,
    heat: close.heat,
    nudgesLeft: state.nudgesRemaining,
    banked: state.banked,
    wildSpent: [...state.wildSpent],
  };
}

/** Applied by a boss or a trap that rakes a whole table's takings. */
export function rakeBankroll(bankroll: number, multiplier: number): number {
  return fpApply(bankroll, multiplier);
}
