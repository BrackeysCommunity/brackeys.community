/**
 * The wheel as the sim sees it: the parts, their tuning, and the tables the
 * stages read. Everything a run buys on the floor ends up as a field here,
 * which is what makes "the wheel is the character sheet" true in code and
 * not just in the pitch.
 */

import { FP_ONE, fpRatio } from "../../sim-kit/index.ts";
import type { ZeroRule } from "./bets.ts";
import {
  type Deflector,
  type FretKind,
  plainDeflectors,
  plainFrets,
  plainPockets,
  type Pocket,
} from "./upgrades.ts";
import { ANGLE_UNITS, UNITS_PER_POCKET } from "./wheel.ts";

export type BallMaterial = "ivory" | "rubber" | "steel" | "glass" | "lead" | "teflon";
export type BallSize = "small" | "standard" | "large";

/**
 * How a material behaves once the ball is off the track. `scatterWeights`
 * is the distribution over frets crossed (index = fret count), `bounceOut`
 * is the base chance of leaving the pocket it first settles in, and
 * `fretDrift` biases the extra frets a Teflon ball slides.
 *
 * These are the numbers the ball line tunes and the only place a material's
 * identity lives, so milestone 4 is a table edit rather than new stages.
 */
export const MATERIALS: Record<
  BallMaterial,
  { scatterWeights: readonly number[]; bounceOut: number; fretDrift: number }
> = {
  ivory: {
    scatterWeights: [2, 5, 9, 12, 12, 10, 7, 4, 2],
    bounceOut: fpRatio(22, 100),
    fretDrift: 0,
  },
  rubber: {
    scatterWeights: [1, 3, 6, 9, 12, 13, 12, 9, 6],
    bounceOut: fpRatio(41, 100),
    fretDrift: 0,
  },
  steel: {
    scatterWeights: [3, 7, 11, 13, 11, 8, 5, 3, 1],
    bounceOut: fpRatio(18, 100),
    fretDrift: 0,
  },
  glass: {
    scatterWeights: [2, 5, 9, 12, 12, 10, 7, 4, 2],
    bounceOut: fpRatio(24, 100),
    fretDrift: 0,
  },
  lead: { scatterWeights: [22, 16, 9, 5, 2, 1, 0, 0, 0], bounceOut: fpRatio(4, 100), fretDrift: 0 },
  teflon: {
    scatterWeights: [1, 3, 7, 11, 13, 12, 9, 6, 4],
    bounceOut: fpRatio(26, 100),
    fretDrift: 2,
  },
};

/** Size trades settling speed against scatter and bounce-outs. */
export const SIZES: Record<BallSize, { scatterBonus: number; bounceScale: number }> = {
  small: { scatterBonus: 1, bounceScale: fpRatio(130, 100) },
  standard: { scatterBonus: 0, bounceScale: FP_ONE },
  large: { scatterBonus: -1, bounceScale: fpRatio(75, 100) },
};

export type Ball = {
  /** Stable across a run so co-op can say whose ball this is. */
  id: string;
  material: BallMaterial;
  size: BallSize;
  /** A chipped ball launches wider until it is repaired at the floor. */
  chipped: boolean;
};

export type WheelState = {
  balls: readonly Ball[];
  /** Rotor travel per tick in angle units, signed. Positive is clockwise. */
  rotorSpeed: number;
  rotorStartAngle: number;
  /** Where on the rim the launch marker sits, in table-frame units. */
  markerAngle: number;
  /** Half-width of the perfect launch window, in angle units. */
  perfectWindow: number;
  /** Half-width of the whole window; past this the launch is a shrug. */
  window: number;
  /** The upgrade grid, indexed by number 0..36. */
  pockets: readonly Pocket[];
  /** The eight diamonds, in table-angle order. */
  deflectors: readonly Deflector[];
  /** The dividers, fret `i` between slot `i` and slot `i + 1`. */
  frets: readonly FretKind[];
  zeroRule: ZeroRule;
  /**
   * Nudges are a table's allowance, not a spin's: `07` starts a run with one
   * per table and sells more (the Tiers set bonus grants "an extra nudge per
   * table"). Spending it early is the decision, which is the whole point.
   */
  nudgesPerTable: number;
};

/** Rotor speeds the mechanic sells, in angle units per tick. */
export const ROTOR_SPEEDS = { slow: 21, standard: 31, fast: 45 } as const;

/** Ticks are the sim's clock: 60 to the second, matching the input log. */
export const TICKS_PER_SECOND = 60;

/**
 * The ball's run on the track: about fifteen laps over eight seconds. The
 * total angle is not a constant — see `trackPhase` — but the duration very
 * nearly is, which is the asymmetry the launch mechanic rests on. A small
 * speed difference compounds into most of a revolution over fifteen laps
 * while barely moving the clock, so the *tick* the ball drops on is
 * predictable and the *angle* it drops at is not.
 */
export const BASE_TRACK_TRAVEL = 15 * ANGLE_UNITS;
export const BASE_TRACK_TICKS = 480;
/** Average track speed, used to turn a launch spread into a tick jitter. */
export const TRACK_SPEED = Math.trunc(BASE_TRACK_TRAVEL / BASE_TRACK_TICKS);

/** Spread of the drop on a perfect tap, and on a tap that missed entirely. */
export const PERFECT_TRAVEL_JITTER = UNITS_PER_POCKET * 2;
export const MAX_TRAVEL_JITTER = Math.trunc(ANGLE_UNITS / 2);
/** A chipped ball adds this much spread whatever the tap was worth. */
export const CHIPPED_TRAVEL_JITTER = UNITS_PER_POCKET * 3;

/** Ticks from leaving the track to striking a diamond, and per fret crossed. */
export const DEFLECTOR_TICKS = 12;
export const FRET_TICKS = 7;

/** How far off a diamond can throw the ball, in angle units. */
export const DEFLECTOR_KICK = Math.trunc(UNITS_PER_POCKET * 3) / 2;

/** Chance the ball reverses direction crossing a fret. */
export const FRET_REVERSAL = fpRatio(1, 6);

/** Bounce-out chance moves this much per unit of rotor speed off standard. */
export const BOUNCE_PER_ROTOR_UNIT = fpRatio(1, 100);
/** A settle can only rebound so many times before the pit stops the wheel. */
export const MAX_BOUNCE_CHAIN = 3;
/** Frets crossed on a rebound leg. */
export const BOUNCE_SCATTER_MIN = 1;
export const BOUNCE_SCATTER_MAX = 3;

/** The wheel a run starts on: one ivory ball, no gaffs, standard rotor. */
export function plainWheel(overrides: Partial<WheelState> = {}): WheelState {
  return {
    balls: [{ id: "ball-1", material: "ivory", size: "standard", chipped: false }],
    rotorSpeed: ROTOR_SPEEDS.standard,
    rotorStartAngle: 0,
    markerAngle: 0,
    perfectWindow: 120,
    window: 900,
    pockets: plainPockets(),
    deflectors: plainDeflectors(),
    frets: plainFrets(),
    zeroRule: "none",
    nudgesPerTable: 1,
    ...overrides,
  };
}
