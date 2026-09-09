/**
 * The wheel's upgrade grid: what a pocket, a diamond and a fret can become.
 *
 * The shape here is the one `07` implies rather than the one its bullet list
 * reads like. A pocket is not *one* of gaff, spring, sticky and the rest —
 * the doc says a spring "placed next to a gaffed number is a funnel" and a
 * sticky "placed on a gaffed number is a lock", which only means anything if
 * a number can carry a gaff and a behaviour at once. So a pocket is a gaff
 * level plus a set of traits, and the funnel is three pockets a player
 * assembled on purpose rather than a single SKU.
 *
 * Every trait names the stage it hooks, because that is the property the
 * spin is built to keep: one modifier, one stage, no reach across.
 */

import { FP_ONE, fpMul, fpRatio } from "../../sim-kit/index.ts";
import { POCKET_COUNT, SECTORS, type SectorName, sectorOf } from "./wheel.ts";

/**
 * A pocket's behaviours. Traps join this union in Phase 5 — they are the
 * same shape, which is the point of it.
 *
 * - `hot` (stage 6) gains a multiplier each time it is hit this table.
 * - `magnet` (stage 4) pulls a steel ball settling nearby into it.
 * - `spring` (stage 4) throws the ball one pocket in a chosen direction.
 * - `sticky` (stage 4) refuses to let the ball bounce out.
 * - `echo` (stage 6) doubles whatever the pocket already pays.
 * - `bank` (stage 6) holds its payout for the next hit anywhere.
 * - `wild` (stage 6) pays every bet on the layout, once per table.
 * - `cold` (stage 6) cools the pit by one when it is hit.
 */
export type PocketTrait =
  | "hot"
  | "magnet"
  | "spring"
  | "sticky"
  | "echo"
  | "bank"
  | "wild"
  | "cold";

export type GaffLevel = 0 | 1 | 2 | 3;

export type Pocket = {
  gaff: GaffLevel;
  traits: readonly PocketTrait[];
  /** Which way a `spring` throws, in slots. Ignored without the trait. */
  springDirection: 1 | -1;
};

/** Gaff pays x1, x2, x3, x4 as `07` prints it. Level 0 is a plain pocket. */
export const GAFF_MULTIPLIERS: readonly number[] = [FP_ONE, FP_ONE * 2, FP_ONE * 3, FP_ONE * 4];

/** How much a `hot` pocket gains per hit inside a table. */
export const HOT_STEP = FP_ONE;

/** How far a `magnet` reaches for a steel ball, in pockets. */
export const MAGNET_REACH = 2;

/** Heat a `cold` pocket takes off when it is hit. */
export const COLD_RELIEF = 1;

export function plainPocket(): Pocket {
  return { gaff: 0, traits: [], springDirection: 1 };
}

export function plainPockets(): Pocket[] {
  return Array.from({ length: POCKET_COUNT }, plainPocket);
}

export function hasTrait(pocket: Pocket, trait: PocketTrait): boolean {
  return pocket.traits.includes(trait);
}

/** A pocket counts as upgraded, for the sector set bonuses, if it is not plain. */
export function isUpgraded(pocket: Pocket): boolean {
  return pocket.gaff > 0 || pocket.traits.length > 0;
}

export type DeflectorKind = "plain" | "dominant" | "magnetic" | "dead";

export type Deflector = {
  kind: DeflectorKind;
  /** Where a `magnetic` diamond throws a steel ball. Ignored otherwise. */
  sector: SectorName;
};

export function plainDeflectors(): Deflector[] {
  return Array.from({ length: 8 }, () => ({ kind: "plain" as const, sector: "voisins" as const }));
}

/**
 * Frets are the dividers between pockets. Fret `i` sits between slot `i` and
 * slot `i + 1`, so there are as many frets as pockets and crossing one is
 * what a scatter step actually is.
 *
 * `rusted` is a house trap and arrives in Phase 5; it is in the union now
 * because scatter has to have somewhere to put it and a union is cheaper to
 * widen than a stage is to re-thread.
 */
export type FretKind = "plain" | "spring" | "sticky" | "rusted";

export function plainFrets(): FretKind[] {
  return Array.from({ length: POCKET_COUNT }, () => "plain" as const);
}

/**
 * The three sector set bonuses. `07`: three or more upgraded pockets inside
 * one sector turns it on.
 *
 * Orphelins is the odd one — "bounce-outs are free of heat" is a rule about
 * a cost that does not exist yet, since bounce-outs raise no heat until
 * Phase 5 puts the rest of the heat rules in. It is reported anyway so the
 * UI can show the set as live, and so Phase 5 has a flag to read rather than
 * a bonus to invent.
 */
export const SET_BONUS_THRESHOLD = 3;

export type SetBonuses = {
  /** Voisins: +1 multiplier on every pocket in the set. */
  voisins: boolean;
  /** Tiers: one extra nudge per table. */
  tiers: boolean;
  /** Orphelins: bounce-outs cost no heat. */
  orphelins: boolean;
};

export function setBonuses(pockets: readonly Pocket[]): SetBonuses {
  const counts: Record<SectorName, number> = { voisins: 0, tiers: 0, orphelins: 0 };
  for (let n = 0; n < POCKET_COUNT; n++) {
    if (isUpgraded(pockets[n] ?? plainPocket())) counts[sectorOf(n)] += 1;
  }
  return {
    voisins: counts.voisins >= SET_BONUS_THRESHOLD,
    tiers: counts.tiers >= SET_BONUS_THRESHOLD,
    orphelins: counts.orphelins >= SET_BONUS_THRESHOLD,
  };
}

export const VOISINS_SET_BONUS = FP_ONE;

/**
 * What a pocket pays, as a fixed-point multiplier on the odds.
 *
 * Order is gaff, then the Voisins set, then hot, then echo — additive terms
 * first and the doubling last, so a fully built pocket reads as "the gaff,
 * plus what the set and the table have added, doubled". Echo doubling the
 * total rather than adding two is what keeps it distinct from a gaff level;
 * `07` prints it as "pays twice", and twice of everything is the only
 * reading under which it is not just a cheaper gaff.
 */
export function pocketMultiplier(
  pocket: Pocket,
  options: { hits?: number; sector?: SectorName; bonuses?: SetBonuses } = {},
): number {
  let multiplier = GAFF_MULTIPLIERS[pocket.gaff] ?? FP_ONE;
  if (options.bonuses?.voisins && options.sector === "voisins") multiplier += VOISINS_SET_BONUS;
  if (hasTrait(pocket, "hot")) multiplier += HOT_STEP * (options.hits ?? 0);
  if (hasTrait(pocket, "echo")) multiplier = fpMul(multiplier, FP_ONE * 2);
  return multiplier;
}

/**
 * Builder for a wheel's pockets, so tests and the floor both describe a
 * build the same way: `gaff(17, 3)`, `trait(16, "spring", -1)`.
 */
export function withGaff(pockets: readonly Pocket[], n: number, level: GaffLevel): Pocket[] {
  return pockets.map((pocket, i) => (i === n ? { ...pocket, gaff: level } : pocket));
}

export function withTrait(
  pockets: readonly Pocket[],
  n: number,
  trait: PocketTrait,
  springDirection: 1 | -1 = 1,
): Pocket[] {
  return pockets.map((pocket, i) =>
    i === n
      ? {
          ...pocket,
          traits: pocket.traits.includes(trait) ? pocket.traits : [...pocket.traits, trait],
          springDirection: trait === "spring" ? springDirection : pocket.springDirection,
        }
      : pocket,
  );
}

/** The named sectors, for a UI that wants to draw a set's membership. */
export function sectorMembers(sector: SectorName): readonly number[] {
  return SECTORS[sector];
}

/** Tilt: `07` gives it a free dominant diamond and a heat surcharge. */
export const TILT_HEAT_MULTIPLIER = fpRatio(3, 2);
