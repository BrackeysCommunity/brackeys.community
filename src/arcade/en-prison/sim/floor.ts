/**
 * The floor between tables: the five shops and the cage.
 *
 * `07` gives them as a list — ball shop, wheel mechanic, pocket smith, the
 * cage, marker desk — and the thing they have in common is that all of them
 * spend the bankroll the shark is about to count again. That is the whole
 * tension of a single-currency economy, and it is why the floor is a pure
 * function over `(wheel, bankroll)` rather than a screen: the validator
 * replays purchases exactly as it replays spins.
 *
 * Building this changed a rule two phases up. With the quota subtracted at
 * every table, as `closeTable` used to do, spending on the floor was
 * strictly worse than not spending — the bankroll resets to the surplus and
 * an upgrade comes out of the money the next number needs. The quota is now
 * a bar to clear rather than a debt to pay, and that is a measurement the
 * text alone could not have produced.
 */

import { Rng } from "../../sim-kit/index.ts";
import type { BallMaterial, BallSize, WheelState } from "./state.ts";
import { ROTOR_SPEEDS } from "./state.ts";
import {
  type DeflectorKind,
  type FretKind,
  type GaffLevel,
  hasTrait,
  type Pocket,
  type PocketTrait,
  withGaff,
  withTrait,
} from "./upgrades.ts";
import { POCKET_COUNT, type SectorName } from "./wheel.ts";

export type Purchase =
  | { kind: "gaff"; number: number }
  | { kind: "trait"; number: number; trait: PocketTrait; springDirection?: 1 | -1 }
  | { kind: "ball-material"; ballId: string; material: BallMaterial }
  | { kind: "ball-size"; ballId: string; size: BallSize }
  | { kind: "ball-add" }
  | { kind: "ball-repair"; ballId: string }
  | { kind: "deflector"; index: number; deflector: DeflectorKind; sector?: SectorName }
  | { kind: "fret"; index: number; fret: FretKind }
  | { kind: "rotor"; speed: number }
  | { kind: "cage-pull" }
  | { kind: "marker"; amount: number };

/**
 * Every price in the game, in chips.
 *
 * A gaff costs more per level, which stops the ladder being the obvious
 * spend; a second ball costs several tables' surplus, which is what makes it
 * the run-defining purchase `07` calls it.
 *
 * These are the second draft. The first was roughly twice as expensive and
 * made buying anything strictly worse than buying nothing — see the table in
 * plan 30. They are still tuned against one scripted shopping order and one
 * betting policy, which is a narrow thing to tune against.
 */
export const PRICES = {
  gaff: [12, 30, 70] as readonly number[],
  trait: {
    spring: 18,
    sticky: 25,
    magnet: 20,
    hot: 22,
    echo: 40,
    bank: 16,
    wild: 55,
    cold: 14,
  } as Record<PocketTrait, number>,
  ballMaterial: 32,
  ballSize: 20,
  /** By ball count: the second ball, then the third. */
  ballAdd: [120, 420] as readonly number[],
  ballRepair: 10,
  deflector: { plain: 0, dominant: 60, magnetic: 45, dead: 28 } as Record<DeflectorKind, number>,
  fret: { plain: 0, spring: 16, sticky: 18, rusted: 0 } as Record<FretKind, number>,
  rotor: 18,
  cagePull: 14,
} as const;

/** Balls a wheel can hold. `07` stops at three and prices the third hard. */
export const MAX_BALLS = 3;

/**
 * The marker desk. `07`: "credit against the next quota, with interest and
 * heat." Borrow now, owe half again against the next table's number, which
 * is the loan shark's whole personality.
 */
export const MARKER_INTEREST_NUMERATOR = 3;
export const MARKER_INTEREST_DENOMINATOR = 2;
export const MARKER_HEAT = 2;
/** The most a marker can be written for, as a share of the next quota. */
export const MARKER_CEILING_NUMERATOR = 1;
export const MARKER_CEILING_DENOMINATOR = 2;

export type FloorState = {
  wheel: WheelState;
  bankroll: number;
  /** Chips owed against the next quota, from the marker desk. */
  debt: number;
  /** Heat the floor itself generated. Carried into the next table. */
  heat: number;
  /** Cage pulls since the last one that landed a level above the floor. */
  pity: number;
  purchases: readonly Purchase[];
};

export type Refusal =
  | "unaffordable"
  | "no-such-ball"
  | "no-such-pocket"
  | "no-such-fret"
  | "no-such-deflector"
  | "already-at-max"
  | "already-owned"
  | "not-chipped"
  | "marker-too-large"
  | "unknown-rotor";

export class PurchaseRefused extends Error {
  readonly reason: Refusal;

  constructor(reason: Refusal) {
    super(`purchase refused: ${reason}`);
    this.name = "PurchaseRefused";
    this.reason = reason;
  }
}

export function openFloor(wheel: WheelState, bankroll: number, pity = 0): FloorState {
  return { wheel, bankroll, debt: 0, heat: 0, pity, purchases: [] };
}

/** What a purchase costs against the wheel as it currently stands. */
export function priceOf(state: FloorState, purchase: Purchase): number {
  switch (purchase.kind) {
    case "gaff": {
      const pocket = state.wheel.pockets[purchase.number];
      return PRICES.gaff[pocket ? pocket.gaff : 0] ?? Number.POSITIVE_INFINITY;
    }
    case "trait":
      return PRICES.trait[purchase.trait];
    case "ball-material":
      return PRICES.ballMaterial;
    case "ball-size":
      return PRICES.ballSize;
    case "ball-add":
      return PRICES.ballAdd[state.wheel.balls.length - 1] ?? Number.POSITIVE_INFINITY;
    case "ball-repair":
      return PRICES.ballRepair;
    case "deflector":
      return PRICES.deflector[purchase.deflector];
    case "fret":
      return PRICES.fret[purchase.fret];
    case "rotor":
      return PRICES.rotor;
    case "cage-pull":
      return PRICES.cagePull;
    case "marker":
      // A marker costs nothing now. That is the trap.
      return 0;
  }
}

/**
 * Why a purchase would be refused, or `null` if it stands.
 *
 * `nextQuota` is only needed to size a marker; every other purchase ignores
 * it. It is passed rather than read off a run because the floor does not
 * know about runs, which is what keeps it replayable on its own.
 */
export function checkPurchase(
  state: FloorState,
  purchase: Purchase,
  nextQuota = 0,
): Refusal | null {
  if (purchase.kind === "marker") {
    if (!Number.isInteger(purchase.amount) || purchase.amount <= 0) return "marker-too-large";
    const ceiling = Math.floor((nextQuota * MARKER_CEILING_NUMERATOR) / MARKER_CEILING_DENOMINATOR);
    return purchase.amount > ceiling ? "marker-too-large" : null;
  }

  const price = priceOf(state, purchase);
  if (!Number.isFinite(price)) return "already-at-max";
  if (price > state.bankroll) return "unaffordable";

  switch (purchase.kind) {
    case "gaff": {
      const pocket = pocketOf(state, purchase.number);
      if (!pocket) return "no-such-pocket";
      return pocket.gaff >= 3 ? "already-at-max" : null;
    }
    case "trait": {
      const pocket = pocketOf(state, purchase.number);
      if (!pocket) return "no-such-pocket";
      return hasTrait(pocket, purchase.trait) ? "already-owned" : null;
    }
    case "ball-material":
    case "ball-size":
      return ballOf(state, purchase.ballId) ? null : "no-such-ball";
    case "ball-repair": {
      const ball = ballOf(state, purchase.ballId);
      if (!ball) return "no-such-ball";
      return ball.chipped ? null : "not-chipped";
    }
    case "ball-add":
      return state.wheel.balls.length >= MAX_BALLS ? "already-at-max" : null;
    case "deflector":
      if (purchase.index < 0 || purchase.index >= state.wheel.deflectors.length) {
        return "no-such-deflector";
      }
      return state.wheel.deflectors[purchase.index]!.kind === purchase.deflector
        ? "already-owned"
        : null;
    case "fret":
      if (purchase.index < 0 || purchase.index >= POCKET_COUNT) return "no-such-fret";
      return state.wheel.frets[purchase.index] === purchase.fret ? "already-owned" : null;
    case "rotor":
      if (!Object.values(ROTOR_SPEEDS).includes(purchase.speed as never)) return "unknown-rotor";
      return state.wheel.rotorSpeed === purchase.speed ? "already-owned" : null;
    case "cage-pull":
      return null;
  }
}

function pocketOf(state: FloorState, n: number): Pocket | undefined {
  return Number.isInteger(n) && n >= 0 && n < POCKET_COUNT ? state.wheel.pockets[n] : undefined;
}

function ballOf(state: FloorState, id: string) {
  return state.wheel.balls.find((ball) => ball.id === id);
}

/**
 * The cage: `07`'s gacha. A gaff of a random level on a random number, with
 * the pool published and a pity counter.
 *
 * The tension `07` names is the *number*, not the level — "a x3 on a number
 * you never bet is a reason to start betting it" — so the number is drawn
 * flat across all thirty-seven and never steered toward what a player
 * already owns. Pity raises the level, not the odds of a useful number,
 * which keeps the cage a nudge toward playing differently rather than a
 * slot machine that eventually pays.
 */
export const CAGE_LEVEL_WEIGHTS: readonly number[] = [60, 30, 10];
export const CAGE_PITY_THRESHOLD = 4;

export type CagePull = { number: number; level: GaffLevel; pity: boolean };

export function pullCage(state: FloorState, seed: string): CagePull {
  const rng = Rng.from(seed);
  const number = rng.below(POCKET_COUNT);
  const pity = state.pity >= CAGE_PITY_THRESHOLD;
  const level = (pity ? 2 : rng.weighted(CAGE_LEVEL_WEIGHTS) + 1) as GaffLevel;
  return { number, level, pity };
}

/**
 * Applies a purchase and returns the floor after it.
 *
 * A cage pull raises the pocket to the level drawn *if that is better than
 * what is there* — a x1 rolled onto an existing x3 is a dud, and paying for
 * a downgrade would be a bug nobody would ever report as one.
 */
export function buy(
  state: FloorState,
  purchase: Purchase,
  options: { seed?: string; nextQuota?: number } = {},
): FloorState {
  const refusal = checkPurchase(state, purchase, options.nextQuota ?? 0);
  if (refusal) throw new PurchaseRefused(refusal);

  const price = priceOf(state, purchase);
  const spent = {
    ...state,
    bankroll: state.bankroll - price,
    purchases: [...state.purchases, purchase],
  };

  switch (purchase.kind) {
    case "gaff": {
      const level = ((state.wheel.pockets[purchase.number]?.gaff ?? 0) + 1) as GaffLevel;
      return withWheel(spent, { pockets: withGaff(state.wheel.pockets, purchase.number, level) });
    }
    case "trait":
      return withWheel(spent, {
        pockets: withTrait(
          state.wheel.pockets,
          purchase.number,
          purchase.trait,
          purchase.springDirection ?? 1,
        ),
      });
    case "ball-material":
      return withWheel(spent, {
        balls: state.wheel.balls.map((ball) =>
          ball.id === purchase.ballId ? { ...ball, material: purchase.material } : ball,
        ),
      });
    case "ball-size":
      return withWheel(spent, {
        balls: state.wheel.balls.map((ball) =>
          ball.id === purchase.ballId ? { ...ball, size: purchase.size } : ball,
        ),
      });
    case "ball-repair":
      return withWheel(spent, {
        balls: state.wheel.balls.map((ball) =>
          ball.id === purchase.ballId ? { ...ball, chipped: false } : ball,
        ),
      });
    case "ball-add":
      return withWheel(spent, {
        balls: [
          ...state.wheel.balls,
          {
            id: `ball-${state.wheel.balls.length + 1}`,
            material: "ivory",
            size: "standard",
            chipped: false,
          },
        ],
      });
    case "deflector":
      return withWheel(spent, {
        deflectors: state.wheel.deflectors.map((deflector, i) =>
          i === purchase.index
            ? { kind: purchase.deflector, sector: purchase.sector ?? deflector.sector }
            : deflector,
        ),
      });
    case "fret":
      return withWheel(spent, {
        frets: state.wheel.frets.map((fret, i) => (i === purchase.index ? purchase.fret : fret)),
      });
    case "rotor":
      return withWheel(spent, { rotorSpeed: purchase.speed });
    case "cage-pull": {
      const pull = pullCage(state, options.seed ?? "cage");
      const current = state.wheel.pockets[pull.number]?.gaff ?? 0;
      const level = (pull.level > current ? pull.level : current) as GaffLevel;
      return {
        ...withWheel(spent, { pockets: withGaff(state.wheel.pockets, pull.number, level) }),
        pity: pull.level >= 2 ? 0 : state.pity + 1,
      };
    }
    case "marker":
      return {
        ...spent,
        bankroll: spent.bankroll + purchase.amount,
        debt:
          state.debt +
          Math.ceil((purchase.amount * MARKER_INTEREST_NUMERATOR) / MARKER_INTEREST_DENOMINATOR),
        heat: state.heat + MARKER_HEAT,
      };
  }
}

function withWheel(state: FloorState, patch: Partial<WheelState>): FloorState {
  return { ...state, wheel: { ...state.wheel, ...patch } };
}

/** Everything the floor could offer, for a UI that wants to list a shop. */
export function offers(
  state: FloorState,
  nextQuota = 0,
): Array<{
  purchase: Purchase;
  price: number;
  refusal: Refusal | null;
}> {
  const all: Purchase[] = [];
  for (let n = 0; n < POCKET_COUNT; n++) {
    all.push({ kind: "gaff", number: n });
    for (const trait of Object.keys(PRICES.trait) as PocketTrait[]) {
      all.push({ kind: "trait", number: n, trait });
    }
  }
  for (const ball of state.wheel.balls) {
    for (const material of ["ivory", "rubber", "steel", "glass", "lead", "teflon"] as const) {
      all.push({ kind: "ball-material", ballId: ball.id, material });
    }
    for (const size of ["small", "standard", "large"] as const) {
      all.push({ kind: "ball-size", ballId: ball.id, size });
    }
    if (ball.chipped) all.push({ kind: "ball-repair", ballId: ball.id });
  }
  all.push({ kind: "ball-add" });
  for (let i = 0; i < state.wheel.deflectors.length; i++) {
    for (const deflector of ["dominant", "magnetic", "dead"] as const) {
      all.push({ kind: "deflector", index: i, deflector });
    }
  }
  for (let i = 0; i < POCKET_COUNT; i++) {
    for (const fret of ["spring", "sticky"] as const) all.push({ kind: "fret", index: i, fret });
  }
  for (const speed of Object.values(ROTOR_SPEEDS)) all.push({ kind: "rotor", speed });
  all.push({ kind: "cage-pull" });

  return all.map((purchase) => ({
    purchase,
    price: priceOf(state, purchase),
    refusal: checkPurchase(state, purchase, nextQuota),
  }));
}

/** What the validator compares for a floor visit. */
export function floorSummary(state: FloorState) {
  return {
    bankroll: state.bankroll,
    debt: state.debt,
    heat: state.heat,
    pity: state.pity,
    purchases: state.purchases.length,
  };
}
