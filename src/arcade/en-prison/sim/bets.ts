/**
 * The layout: real bets, real odds, resolved against the pockets the balls
 * settled in.
 *
 * Everything here is whole chips and integer odds except the pocket
 * multiplier, which is fixed point. A gaffed pocket multiplies the *odds*,
 * not the stake — the doc's worked example is that a ×3 on 17 makes a
 * straight-up pay 105 and a red bet that lands on 17 pay 3 — which is what
 * makes pocket upgrades worth something to an outside bettor.
 */

import { fpApply, FP_ONE } from "../../sim-kit/index.ts";
import { pocketColor } from "./wheel.ts";

export type EvenMoneyPick = "red" | "black" | "even" | "odd" | "low" | "high";

export type Bet =
  | { kind: "straight"; amount: number; number: number }
  | { kind: "split"; amount: number; numbers: readonly [number, number] }
  | { kind: "street"; amount: number; row: number }
  | { kind: "corner"; amount: number; corner: number }
  | { kind: "sixLine"; amount: number; row: number }
  | { kind: "dozen"; amount: number; dozen: number }
  | { kind: "column"; amount: number; column: number }
  | { kind: "evenMoney"; amount: number; pick: EvenMoneyPick };

export type BetKind = Bet["kind"];

/** Odds to one, as printed on the felt. */
export const BET_ODDS: Record<BetKind, number> = {
  straight: 35,
  split: 17,
  street: 11,
  corner: 8,
  sixLine: 5,
  dozen: 2,
  column: 2,
  evenMoney: 1,
};

/** The extra 35-to-1 both balls landing in the same pocket pays. */
export const SAME_POCKET_ODDS = 35;

/** Grid position of a number on the felt: 12 rows of three. */
function cell(n: number): { row: number; col: number } {
  return { row: Math.floor((n - 1) / 3), col: (n - 1) % 3 };
}

export function betNumbers(bet: Bet): readonly number[] {
  switch (bet.kind) {
    case "straight":
      return [bet.number];
    case "split":
      return bet.numbers;
    case "street":
      return [bet.row * 3 + 1, bet.row * 3 + 2, bet.row * 3 + 3];
    case "corner":
      return [bet.corner, bet.corner + 1, bet.corner + 3, bet.corner + 4];
    case "sixLine":
      return [
        bet.row * 3 + 1,
        bet.row * 3 + 2,
        bet.row * 3 + 3,
        bet.row * 3 + 4,
        bet.row * 3 + 5,
        bet.row * 3 + 6,
      ];
    case "dozen": {
      const base = bet.dozen * 12;
      return Array.from({ length: 12 }, (_, i) => base + i + 1);
    }
    case "column":
      return Array.from({ length: 12 }, (_, i) => i * 3 + bet.column + 1);
    case "evenMoney":
      return EVEN_MONEY_NUMBERS[bet.pick];
  }
}

const EVEN_MONEY_NUMBERS: Record<EvenMoneyPick, readonly number[]> = {
  red: range36().filter((n) => pocketColor(n) === "red"),
  black: range36().filter((n) => pocketColor(n) === "black"),
  even: range36().filter((n) => n % 2 === 0),
  odd: range36().filter((n) => n % 2 === 1),
  low: range36().filter((n) => n <= 18),
  high: range36().filter((n) => n >= 19),
};

function range36(): number[] {
  return Array.from({ length: 36 }, (_, i) => i + 1);
}

/**
 * Whether a bet describes a real position on the layout. The betting UI
 * only offers legal spots, so this exists for the validator: a crafted
 * input log claiming a split across two numbers that do not touch would
 * otherwise buy 17-to-1 odds on a two-number spread of its choosing.
 */
export function isLegalBet(bet: Bet): boolean {
  if (!Number.isInteger(bet.amount) || bet.amount <= 0) return false;
  switch (bet.kind) {
    case "straight":
      return Number.isInteger(bet.number) && bet.number >= 0 && bet.number <= 36;
    case "split": {
      const [a, b] = bet.numbers;
      if (!inRange(a, 1, 36) && !(a === 0)) return false;
      if (!inRange(b, 1, 36)) return false;
      if (a === 0) return b === 1 || b === 2 || b === 3;
      const p = cell(a);
      const q = cell(b);
      const sameRow = p.row === q.row && Math.abs(p.col - q.col) === 1;
      const sameCol = p.col === q.col && Math.abs(p.row - q.row) === 1;
      return sameRow || sameCol;
    }
    case "street":
    case "sixLine":
      return inRange(bet.row, 0, bet.kind === "street" ? 11 : 10);
    case "corner":
      return inRange(bet.corner, 1, 32) && cell(bet.corner).col !== 2;
    case "dozen":
      return inRange(bet.dozen, 0, 2);
    case "column":
      return inRange(bet.column, 0, 2);
    case "evenMoney":
      return bet.pick in EVEN_MONEY_NUMBERS;
  }
}

function inRange(v: number, lo: number, hi: number): boolean {
  return Number.isInteger(v) && v >= lo && v <= hi;
}

/** Where a ball came to rest, and what that pocket does to a payout. */
export type LandedBall = {
  /** The number the ball settled in. */
  number: number;
  /** The pocket's payout multiplier, fixed point. `FP_ONE` on a plain pocket. */
  multiplier: number;
  /**
   * A `wild` pocket that has not yet fired this table. It pays every bet on
   * the layout, which is why it is a flag on the ball rather than a number:
   * coverage, not multiplier.
   */
  wild?: boolean;
};

/**
 * What the house does with an even-money bet that loses to zero. Both are
 * table rules bought on the floor; `none` is the default table.
 */
export type ZeroRule = "none" | "la-partage" | "en-prison";

export type BetOutcome = {
  bet: Bet;
  /** How many balls landed on a number this bet covers. */
  hits: number;
  /** Chips won above the stake. */
  profit: number;
  /** Chips returned to the bankroll, stake included. Zero on a plain loss. */
  returned: number;
  /** Chips held on the table for the next spin under the En Prison rule. */
  imprisoned: number;
  rule: ZeroRule | "none";
  /**
   * Profit attributable to each ball, in ball order. A `bank` pocket needs
   * to swallow only what its own ball won, so the sum is not enough.
   */
  perBall: readonly number[];
};

/**
 * Resolves one bet against every ball on the wheel.
 *
 * A bet pays once per ball that lands on it, and the stake is charged once,
 * so a two-ball spin that hits a straight-up twice returns 71 chips on a
 * stake of one, not 72.
 *
 * The zero rules are written for the single-ball case they come from and
 * extended the narrow way: an even-money bet gets partage or prison only if
 * no ball paid it and at least one landed on zero. That is one of the
 * multi-ball resolution decisions `07` asks to be written down before the
 * interactions are built — it is deliberately the stingy reading, because
 * the generous one turns a second ball into a hedge against the house edge.
 */
export function resolveBet(bet: Bet, balls: readonly LandedBall[], zeroRule: ZeroRule): BetOutcome {
  const covered = new Set(betNumbers(bet));
  const odds = BET_ODDS[bet.kind];

  let hits = 0;
  let profit = 0;
  const perBall = balls.map((ball) => {
    // A wild pocket counts as a hit for any bet on the layout.
    if (!covered.has(ball.number) && !ball.wild) return 0;
    hits += 1;
    const won = fpApply(bet.amount * odds, ball.multiplier);
    profit += won;
    return won;
  });

  if (hits > 0) {
    return {
      bet,
      hits,
      profit,
      returned: bet.amount + profit,
      imprisoned: 0,
      rule: "none",
      perBall,
    };
  }

  const hitZero = balls.some((ball) => ball.number === 0);
  if (bet.kind === "evenMoney" && hitZero && zeroRule !== "none") {
    if (zeroRule === "la-partage") {
      // Half back, rounded down: the house keeps the odd chip, as it does.
      return {
        bet,
        hits: 0,
        profit: 0,
        returned: Math.floor(bet.amount / 2),
        imprisoned: 0,
        rule: "la-partage",
        perBall,
      };
    }
    return {
      bet,
      hits: 0,
      profit: 0,
      returned: 0,
      imprisoned: bet.amount,
      rule: "en-prison",
      perBall,
    };
  }

  return { bet, hits: 0, profit: 0, returned: 0, imprisoned: 0, rule: "none", perBall };
}

/**
 * The same-pocket jackpot: with two or more balls, every pair sharing a
 * pocket pays 35 to 1 on top, scaled by that pocket's multiplier. Three
 * balls in one pocket is three pairs, which is the number the game wants to
 * be chasing.
 */
export function samePocketBonus(
  balls: readonly LandedBall[],
  stake: number,
): { pairs: number; profit: number } {
  let pairs = 0;
  let profit = 0;
  for (let i = 0; i < balls.length; i++) {
    for (let j = i + 1; j < balls.length; j++) {
      const a = balls[i]!;
      const b = balls[j]!;
      if (a.number !== b.number) continue;
      pairs += 1;
      profit += fpApply(stake * SAME_POCKET_ODDS, a.multiplier);
    }
  }
  return { pairs, profit };
}

/**
 * What happens to stakes the table is already holding.
 *
 * An imprisoned bet is not re-staked: the chips are on the felt from the
 * spin that lost them to zero, so the player pays nothing to see them
 * resolved. It wins back its own stake and nothing more -- no odds, no
 * pocket multiplier -- which is the real rule and also the reason En Prison
 * is a defensive upgrade rather than a payout one.
 *
 * A second zero takes the stake. The real game has houses that re-imprison
 * instead, sometimes several deep; this takes it, because a stake that can
 * sit on the felt for four spins is a rule nobody can read off the table
 * and a run the validator has to carry state for. Written down here so the
 * choice is visible if it ever needs revisiting.
 */
export function resolveImprisoned(
  held: readonly Bet[],
  balls: readonly LandedBall[],
): { released: number; taken: number } {
  let released = 0;
  let taken = 0;
  for (const bet of held) {
    const covered = new Set(betNumbers(bet));
    if (balls.some((ball) => covered.has(ball.number))) released += bet.amount;
    else taken += bet.amount;
  }
  return { released, taken };
}

export const PLAIN_POCKET_MULTIPLIER = FP_ONE;
