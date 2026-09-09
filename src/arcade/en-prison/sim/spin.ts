/**
 * The spin: six stages, in order, each a pure function of the wheel, the
 * inputs, and its own RNG substream.
 *
 * The staging is the point. `07` says every upgrade, trap, and boss rule
 * attaches to exactly one stage, so the stages are separate exported
 * functions with explicit records rather than one loop — a magnetic
 * deflector modifies `drop`, a sticky fret modifies `scatter`, and neither
 * can reach the other. It is also what keeps the sim readable as roulette
 * rather than as a slot machine with a wheel drawn on it.
 *
 * Determinism: no `Date`, no `Math.random`, no trig, no floats in anything
 * that decides an outcome. Each stage forks its own named RNG substream, so
 * adding a roll to scatter cannot shift the settle roll.
 */

import { fpApply, fpClamp, fpLerp, FP_ONE, fpMul, fpRatio, Rng } from "../../sim-kit/index.ts";
import {
  type Bet,
  type BetOutcome,
  isLegalBet,
  type LandedBall,
  resolveBet,
  samePocketBonus,
} from "./bets.ts";
import {
  BASE_TRACK_TICKS,
  BOUNCE_PER_ROTOR_UNIT,
  BOUNCE_SCATTER_MAX,
  BOUNCE_SCATTER_MIN,
  CHIPPED_TRAVEL_JITTER,
  DEFLECTOR_KICK,
  DEFLECTOR_TICKS,
  FRET_REVERSAL,
  FRET_TICKS,
  MATERIALS,
  MAX_BOUNCE_CHAIN,
  MAX_TRAVEL_JITTER,
  PERFECT_TRAVEL_JITTER,
  ROTOR_SPEEDS,
  SIZES,
  TRACK_SPEED,
  type Ball,
  type WheelState,
} from "./state.ts";
import {
  COLD_RELIEF,
  hasTrait,
  MAGNET_REACH,
  plainPocket,
  type Pocket,
  pocketMultiplier,
  type FretKind,
  type SetBonuses,
  setBonuses,
} from "./upgrades.ts";
import {
  ANGLE_UNITS,
  angleToSlot,
  deflectorAngle,
  nearestDeflector,
  normalizeAngle,
  normalizeSlot,
  numberAt,
  POCKET_COUNT,
  sectorOf,
  slotDistance,
  slotOf,
  UNITS_PER_DEFLECTOR,
  UNITS_PER_POCKET,
} from "./wheel.ts";

/** One player's inputs for one ball on one spin. */
/** The table's nudge allowance, drained in place as a spin spends it. */
export type NudgePool = { remaining: number };

/**
 * What a spin needs from the table it is being played at.
 *
 * These are the pocket effects whose memory is longer than one spin — `hot`
 * counts hits across a table, `bank` holds chips until something pays, and
 * `wild` fires once — so they cannot live on the wheel, which is a run-long
 * object, or in the spin, which forgets. The table owns them and hands them
 * down; the result hands back what changed.
 */
export type SpinContext = {
  nudges: number;
  /** Times each number has been hit this table, for `hot`. */
  hits: readonly number[];
  /** Chips a `bank` pocket is holding for the next hit anywhere. */
  banked: number;
  /** Numbers whose `wild` has already fired this table. */
  wildSpent: readonly number[];
};

export function emptyContext(wheel: WheelState): SpinContext {
  return {
    nudges: wheel.nudgesPerTable,
    hits: new Array<number>(POCKET_COUNT).fill(0),
    banked: 0,
    wildSpent: [],
  };
}

export type BallInput = {
  ballId: string;
  /** Tick the launch tap landed on. */
  launchTick: number;
  /** Ticks of nudge taps, in order. Extras beyond the wheel's allowance are ignored. */
  nudgeTicks?: readonly number[];
};

export type SpinInput = {
  bets: readonly Bet[];
  balls: readonly BallInput[];
};

export type LaunchRecord = {
  ballId: string;
  /** How well the tap hit the marker, fixed point, 1 at dead centre. */
  quality: number;
  /** Signed angular miss against the marker, in angle units. */
  offset: number;
  /** This spin's track phase, table frame. Drawn before the tap. */
  phase: number;
  /** Where the ball actually leaves the track, table frame. */
  exitAngle: number;
  dropTick: number;
  /** Tick the ball reaches the rotor, which is what the band predicts against. */
  contactTick: number;
  /** Centre of the drop zone in rotor frame, as a pocket slot. */
  dropZoneSlot: number;
  /** Half-width of the drop zone in pockets. */
  dropZoneHalfWidth: number;
};

export type DropRecord = {
  ballId: string;
  deflector: number;
  /** How far off the diamond's centre the ball arrived. */
  approach: number;
  /** The kick the diamond gave it. */
  kick: number;
  contactTick: number;
  /** Slot the ball hits the rotor at. */
  contactSlot: number;
};

export type FretHit = {
  tick: number;
  slot: number;
  direction: 1 | -1;
  /** True when this crossing was bought with a nudge tap. */
  nudged: boolean;
  /** The divider crossed, which is what decided whether another followed. */
  fret: FretKind;
};

export type ScatterRecord = {
  ballId: string;
  /** 0 for the first scatter, then one per rebound. */
  leg: number;
  frets: readonly FretHit[];
  endSlot: number;
  endTick: number;
  /** True when a sticky fret ended the leg before its rolled count. */
  stopped: boolean;
};

export type SettleRecord = {
  ballId: string;
  leg: number;
  /** Where the scatter left the ball, before any pocket acted on it. */
  landedSlot: number;
  /** Where it ended up once magnet and spring had their turn. */
  slot: number;
  number: number;
  /** Pocket effects that fired here, in the order they fired. */
  effects: readonly PocketEffect[];
  bounced: boolean;
  /** The bounce-out chance that was rolled against, fixed point. */
  bounceChance: number;
};

export type PocketEffect = "magnet" | "spring" | "sticky";

/**
 * Stage 4's pocket effects, in the fixed precedence the multi-ball
 * resolution order sets down: magnet, then spring, then sticky. (Vacuum
 * comes before all three and arrives with the traps in Phase 5.)
 *
 * Each fires at most once per settle, which is what stops a magnet and a
 * spring facing each other from oscillating. Sticky is checked against the
 * pocket the ball is in *after* the moves, because that is what makes the
 * funnel work: spring out of one pocket, into a sticky gaff, locked.
 */
export function applyPocketEffects(
  wheel: WheelState,
  ball: Ball,
  landedSlot: number,
): { slot: number; effects: PocketEffect[]; sticky: boolean } {
  const effects: PocketEffect[] = [];
  let slot = landedSlot;

  if (ball.material === "steel") {
    const pulled = magnetWithinReach(wheel, slot);
    if (pulled !== null) {
      slot = pulled;
      effects.push("magnet");
    }
  }

  const landed = pocketAt(wheel, slot);
  if (hasTrait(landed, "spring")) {
    slot = normalizeSlot(slot + landed.springDirection);
    effects.push("spring");
  }

  const sticky = hasTrait(pocketAt(wheel, slot), "sticky");
  if (sticky) effects.push("sticky");
  return { slot, effects, sticky };
}

function pocketAt(wheel: WheelState, slot: number): Pocket {
  return wheel.pockets[numberAt(slot)] ?? plainPocket();
}

/** The nearest magnet pocket within reach, or null. Ties go clockwise. */
function magnetWithinReach(wheel: WheelState, slot: number): number | null {
  for (let distance = 0; distance <= MAGNET_REACH; distance++) {
    for (const direction of [1, -1] as const) {
      const candidate = normalizeSlot(slot + direction * distance);
      if (hasTrait(pocketAt(wheel, candidate), "magnet")) {
        return candidate === slot ? null : candidate;
      }
      if (distance === 0) break;
    }
  }
  return null;
}

export type BallTrace = {
  ballId: string;
  launch: LaunchRecord;
  drop: DropRecord;
  scatters: readonly ScatterRecord[];
  settles: readonly SettleRecord[];
  /** Nudge taps that were inside a scatter window and had allowance left. */
  nudgesUsed: number;
  final: LandedBall;
};

export type SpinResult = {
  balls: readonly BallTrace[];
  pockets: readonly LandedBall[];
  outcomes: readonly BetOutcome[];
  stake: number;
  /** Chips returned across every bet, stakes included. */
  returned: number;
  /** Returned minus stake. Negative on a losing spin. */
  net: number;
  samePocket: { pairs: number; profit: number };
  imprisoned: number;
  /** Nudges drawn from the table's allowance by this spin, across all balls. */
  nudgesUsed: number;
  /** Chips a `bank` pocket is holding after this spin. */
  banked: number;
  /** Chips this spin's bank pocket swallowed. */
  bankedThisSpin: number;
  /** Chips a bank released into this spin's payout. */
  released: number;
  /** Numbers whose `wild` fired, which spends it for the table. */
  wildSpent: readonly number[];
  /** Heat a `cold` pocket takes off. */
  heatRelief: number;
  bonuses: SetBonuses;
};

export class IllegalBetError extends Error {
  // A plain field rather than a parameter property: the sim has to survive
  // type-stripping so a bare engine can run it, and a parameter property is
  // not erasable syntax.
  readonly bet: Bet;

  constructor(bet: Bet) {
    super(`illegal bet: ${JSON.stringify(bet)}`);
    this.name = "IllegalBetError";
    this.bet = bet;
  }
}

/** Rotor angle at a given tick. The rotor is the only thing on a clock. */
export function rotorAngleAt(wheel: WheelState, tick: number): number {
  return normalizeAngle(wheel.rotorStartAngle + wheel.rotorSpeed * tick);
}

/**
 * This spin's track phase: where on the rim the ball's decay puts it, drawn
 * per ball from the seed alone and *not* from the tap.
 *
 * It exists because of a bias the first cut of this file had. With the
 * ball's total track travel fixed, its exit sat at one table angle every
 * spin, so the diamond nearest that angle was struck twice as often as the
 * one opposite: a plain wheel came with a dominant deflector built in,
 * which is a thing `07` sells as an upgrade and warns about as a risk. A
 * per-spin phase is also the truthful model — a real dealer's launch speed
 * varies, and over fifteen laps a small speed difference is most of a
 * revolution — and it is what the drop-zone band is drawn around, so the
 * player can read it before committing to a tap.
 */
export function trackPhase(seed: number | string, ballId: string): number {
  return Rng.from(seed).fork(`phase:${ballId}`).below(ANGLE_UNITS);
}

/**
 * How good a tap on this tick is, and how wide a drop that makes. Shared by
 * the launch itself and by the band the UI paints before it, so what the
 * player is shown cannot drift from what is rolled.
 */
function readWindow(
  wheel: WheelState,
  ball: Ball,
  launchTick: number,
): { offset: number; quality: number; spread: number } {
  let offset = normalizeAngle(rotorAngleAt(wheel, launchTick) - wheel.markerAngle);
  if (offset > ANGLE_UNITS / 2) offset -= ANGLE_UNITS;

  const miss = Math.abs(offset);
  const quality =
    miss <= wheel.perfectWindow
      ? FP_ONE
      : miss >= wheel.window
        ? 0
        : FP_ONE - fpRatio(miss - wheel.perfectWindow, wheel.window - wheel.perfectWindow);

  let spread = fpLerp(MAX_TRAVEL_JITTER, PERFECT_TRAVEL_JITTER, quality);
  if (ball.chipped) spread += CHIPPED_TRAVEL_JITTER;
  return { offset, quality, spread };
}

/**
 * The floor on how narrow the drop-zone band can get.
 *
 * `07`'s risks section asks for a number here — "the ceiling on drop-zone
 * narrowing needs a number" — and this is it. A dominant diamond plus a
 * perfect tap would otherwise report a band of one or two pockets, and a
 * band that tight beside a sticky gaff is the funnel dominating the game,
 * which is the exact failure the doc names. Three pockets of contact
 * uncertainty, with scatter still to come after it, keeps a built wheel a
 * favourite rather than a certainty. `spin.test.ts` measures what the
 * strongest build actually achieves against it.
 */
export const MIN_BAND_HALF_WIDTH = 3;

/**
 * The band, given a phase and a tick.
 *
 * Its centre is the rotor-frame slot of the diamond nearest the phase, and
 * its width is honest about both sources of doubt: how many diamonds the
 * launch spread can reach, and how far a diamond can kick the ball once it
 * is struck. A perfect tap on a plain wheel still leaves a band of about
 * fifteen pockets, because eight diamonds spaced four and a half pockets
 * apart is genuinely all the precision a level wheel has. Narrowing it
 * further is what a dominant deflector is for.
 *
 * The band predicts where the ball *meets the rotor*, not where it comes to
 * rest. Scatter is a separate stage and is deliberately outside it.
 */
function band(
  wheel: WheelState,
  phase: number,
  spread: number,
  launchTick: number,
): { slot: number; halfWidth: number } {
  // The nominal contact tick, with no launch jitter in it. The band is a
  // promise made before the tap, so it has to be computable before the tap;
  // the jitter is paid for in the width instead.
  const contactTick = launchTick + BASE_TRACK_TICKS + DEFLECTOR_TICKS;
  const index = strikingDeflector(wheel, phase);
  const deflector = wheel.deflectors[index];

  // When a dominant diamond owns this phase, and owns it far enough either
  // side that the launch spread cannot escape it, the diamond is known and
  // the band loses its largest term. This is the only thing in the game that
  // narrows the band, and it is what the ceiling above exists to bound.
  const known =
    deflector?.kind === "dominant" &&
    withinDominantReach(normalizeAngle(phase - spread), index) &&
    withinDominantReach(normalizeAngle(phase + spread), index);

  const reach = known ? 0 : Math.ceil(spread / UNITS_PER_DEFLECTOR) * UNITS_PER_DEFLECTOR;
  // A dead diamond drops the ball straight down, so there is no kick to be
  // uncertain about.
  const kick = deflector?.kind === "dead" ? 0 : DEFLECTOR_KICK;
  const tickSlip = Math.abs(wheel.rotorSpeed) * Math.ceil(spread / TRACK_SPEED);

  return {
    slot: angleToSlot(deflectorAngle(index) - rotorAngleAt(wheel, contactTick)),
    halfWidth: Math.max(
      MIN_BAND_HALF_WIDTH,
      Math.min(18, Math.ceil((reach + kick + tickSlip) / UNITS_PER_POCKET)),
    ),
  };
}

/**
 * Stage 1 — Launch.
 *
 * Quality is measured as an angle, not as a tick offset: the marker is a
 * point on the rim and the rotor passes it once a revolution, so the player
 * can take any pass and a faster rotor genuinely is a tighter window
 * without the sim needing to know the rotor's period.
 *
 * The tap does not move where the ball leaves the track by much — that is
 * roughly fixed by the track. What it moves is *which numbers are under
 * that point*, because the rotor has turned. That is visual ballistics, and
 * it is why the drop zone is reported in rotor frame.
 */
export function launch(
  wheel: WheelState,
  ball: Ball,
  input: BallInput,
  phase: number,
  rng: Rng,
): LaunchRecord {
  const { offset, quality, spread } = readWindow(wheel, ball, input.launchTick);
  const jitter = rng.range(-spread, spread);
  // The ball runs the track against the rotor, so the jitter subtracts.
  const exitAngle = normalizeAngle(phase - jitter);
  const dropTick = input.launchTick + BASE_TRACK_TICKS + Math.trunc(jitter / TRACK_SPEED);
  const contactTick = dropTick + DEFLECTOR_TICKS;
  const predicted = band(wheel, phase, spread, input.launchTick);

  return {
    ballId: ball.id,
    quality,
    offset,
    phase,
    exitAngle,
    dropTick,
    contactTick,
    dropZoneSlot: predicted.slot,
    dropZoneHalfWidth: predicted.halfWidth,
  };
}

/**
 * The band the UI paints before the tap: where the ball would drop if the
 * player tapped on this tick and the track behaved. Same maths as `launch`
 * with the jitter left out, so what is shown cannot drift from what is
 * rolled.
 */
export function previewDropZone(
  wheel: WheelState,
  ball: Ball,
  launchTick: number,
  phase: number,
): { slot: number; halfWidth: number; quality: number } {
  const { quality, spread } = readWindow(wheel, ball, launchTick);
  return { ...band(wheel, phase, spread, launchTick), quality };
}

/**
 * Stage 2 — Drop.
 *
 * Eight diamonds, bolted to the bowl and therefore fixed in the table
 * frame. The ball takes the nearest one and comes off it with a kick. This
 * is the stage a dominant deflector attacks, and the reason it is worth
 * anything: the diamonds are the only part of the wheel that does not turn
 * under the ball.
 */
export function drop(wheel: WheelState, ball: Ball, launched: LaunchRecord, rng: Rng): DropRecord {
  const index = strikingDeflector(wheel, launched.exitAngle);
  const { offset } = nearestDeflector(launched.exitAngle);
  const deflector = wheel.deflectors[index] ?? {
    kind: "plain" as const,
    sector: "voisins" as const,
  };

  // A dead diamond drops the ball straight into the pocket beneath it, so
  // there is no kick to roll: that is the whole of what it sells.
  const kick = deflector.kind === "dead" ? 0 : rng.range(-DEFLECTOR_KICK, DEFLECTOR_KICK);
  const contactAngle = normalizeAngle(deflectorAngle(index) + kick);
  let contactSlot = angleToSlot(contactAngle - rotorAngleAt(wheel, launched.contactTick));

  // A magnetic diamond throws a steel ball at a sector of the player's
  // choosing. Only steel: it is the material's entire identity, and a
  // magnetic diamond on a wheel with no steel ball is a wasted purchase,
  // which is the trade `07` is selling.
  if (deflector.kind === "magnetic" && ball.material === "steel") {
    const target = SECTOR_TARGET[deflector.sector];
    const toward = slotDistance(contactSlot, slotOf(target));
    contactSlot = normalizeSlot(
      contactSlot + Math.sign(toward) * Math.min(Math.abs(toward), MAGNETIC_PULL),
    );
  }

  return {
    ballId: launched.ballId,
    deflector: index,
    approach: offset,
    kick,
    contactTick: launched.contactTick,
    contactSlot,
  };
}

/**
 * Which diamond the ball actually hits.
 *
 * Normally the nearest. A dominant diamond — the wear a real wheel develops,
 * and the one part of it that does not turn under the ball — captures
 * anything that leaves the track within a full gap of it, which is three
 * gaps' worth of the rim and is why it is the upgrade that makes a launch
 * worth timing. `bandKnowsDeflector` below is the same test, and the two
 * have to agree or the band lies.
 */
export function strikingDeflector(wheel: WheelState, exitAngle: number): number {
  const dominant = wheel.deflectors.findIndex((d) => d.kind === "dominant");
  if (dominant >= 0 && withinDominantReach(exitAngle, dominant)) return dominant;
  return nearestDeflector(exitAngle).index;
}

function withinDominantReach(angle: number, index: number): boolean {
  const gap = normalizeAngle(angle - deflectorAngle(index));
  return gap <= DOMINANT_REACH || gap >= ANGLE_UNITS - DOMINANT_REACH;
}

/** How far a dominant diamond reaches for a ball, in angle units. */
export const DOMINANT_REACH = UNITS_PER_DEFLECTOR;

/** How far a magnetic diamond drags a steel ball, in pockets. */
export const MAGNETIC_PULL = 6;

/** Where each sector's magnetic pull aims: the middle of the arc. */
const SECTOR_TARGET = { voisins: 0, tiers: 8, orphelins: 20 } as const;

/**
 * Stage 3 — Scatter.
 *
 * The ball crosses frets. How many comes from the material's distribution
 * and the ball's size; direction starts against the rotor, because the ball
 * keeps its own way round, and flips on a fret now and then. Every crossing
 * is recorded so the renderer can tick and the validator can compare.
 *
 * Nudges land here: a tap whose tick falls inside this leg buys one extra
 * crossing in the direction the ball is already going, which is exactly
 * what the doc promises and is why nudges chain with bounces.
 */
export function scatter(
  wheel: WheelState,
  ball: Ball,
  startSlot: number,
  startTick: number,
  leg: number,
  fretCount: number,
  nudges: { ticks: readonly number[]; pool: NudgePool },
  rng: Rng,
): ScatterRecord {
  let direction: 1 | -1 = wheel.rotorSpeed >= 0 ? -1 : 1;
  let slot = normalizeSlot(startSlot);
  let tick = startTick;
  const frets: FretHit[] = [];

  let stopped = false;

  const step = (nudged: boolean) => {
    if (rng.chance(FRET_REVERSAL, FP_ONE)) direction = direction === 1 ? -1 : 1;
    // The fret crossed is the divider between where the ball is and where it
    // is going, which is the lower of the two slots.
    const crossed = wheel.frets[normalizeSlot(direction === 1 ? slot : slot - 1)] ?? "plain";
    slot = normalizeSlot(slot + direction);
    tick += FRET_TICKS;
    frets.push({ tick, slot, direction, nudged, fret: crossed });
    if (crossed === "sticky") stopped = true;
    return crossed;
  };

  /** One crossing, plus the extra a spring fret throws in. */
  const cross = (nudged: boolean) => {
    if (stopped) return;
    if (step(nudged) === "spring" && !stopped) step(false);
  };

  for (let i = 0; i < fretCount && !stopped; i++) {
    cross(false);
    // A nudge tap is consumed by the crossing it lands on or before, so a
    // player who taps early does not lose it to rounding. A sticky fret that
    // has already stopped the ball refunds nothing: the tap was late.
    while (
      !stopped &&
      nudges.pool.remaining > 0 &&
      nudges.ticks.length > 0 &&
      nudges.ticks[0]! <= tick
    ) {
      nudges.ticks = nudges.ticks.slice(1);
      nudges.pool.remaining -= 1;
      cross(true);
    }
  }

  return { ballId: ball.id, leg, frets, endSlot: slot, endTick: tick, stopped };
}

/** How many frets this ball crosses on its first leg. */
export function rollFretCount(ball: Ball, rng: Rng): number {
  const material = MATERIALS[ball.material];
  const size = SIZES[ball.size];
  const rolled = rng.weighted(material.scatterWeights);
  return Math.max(0, rolled + size.scatterBonus + material.fretDrift);
}

/**
 * Stage 4 — Settle, and Stage 5 — Bounce.
 *
 * The bounce chance is material, size, and rotor speed. Rubber on a fast
 * rotor leaves the pocket most times it lands; lead almost never does. A
 * bounce sends the ball back through a short scatter leg, which is what
 * makes a spring pocket next to a gaff a funnel rather than a coin flip.
 */
export function bounceChance(wheel: WheelState, ball: Ball): number {
  const material = MATERIALS[ball.material];
  const size = SIZES[ball.size];
  const rotorOffset = Math.abs(wheel.rotorSpeed) - ROTOR_SPEEDS.standard;
  const base = fpMul(material.bounceOut, size.bounceScale);
  return fpClamp(base + rotorOffset * BOUNCE_PER_ROTOR_UNIT, 0, FP_ONE);
}

/** Runs one ball through all five pre-payout stages. */
export function spinBall(
  wheel: WheelState,
  ball: Ball,
  input: BallInput,
  phase: number,
  pool: NudgePool,
  context: SpinContext,
  bonuses: SetBonuses,
  rng: Rng,
): BallTrace {
  const launched = launch(wheel, ball, input, phase, rng.fork(`launch:${ball.id}`));
  const dropped = drop(wheel, ball, launched, rng.fork(`drop:${ball.id}`));

  const scatterRng = rng.fork(`scatter:${ball.id}`);
  const settleRng = rng.fork(`settle:${ball.id}`);
  const nudges = { ticks: [...(input.nudgeTicks ?? [])].sort((a, b) => a - b), pool };
  const before = pool.remaining;

  const scatters: ScatterRecord[] = [];
  const settles: SettleRecord[] = [];

  let leg = 0;
  let slot = dropped.contactSlot;
  let tick = dropped.contactTick;
  const chance = bounceChance(wheel, ball);

  for (;;) {
    const fretCount =
      leg === 0
        ? rollFretCount(ball, scatterRng)
        : scatterRng.range(BOUNCE_SCATTER_MIN, BOUNCE_SCATTER_MAX);
    const record = scatter(wheel, ball, slot, tick, leg, fretCount, nudges, scatterRng);
    scatters.push(record);
    tick = record.endTick;

    const effects = applyPocketEffects(wheel, ball, record.endSlot);
    slot = effects.slot;

    // Sticky refuses the bounce outright rather than lowering its odds: it
    // is a lock, and a lock that fails one time in five is not one.
    const bounced = !effects.sticky && leg < MAX_BOUNCE_CHAIN && settleRng.chance(chance, FP_ONE);

    settles.push({
      ballId: ball.id,
      leg,
      landedSlot: record.endSlot,
      slot,
      number: numberAt(slot),
      effects: effects.effects,
      bounced,
      bounceChance: chance,
    });
    if (!bounced) break;
    leg += 1;
  }

  const number = numberAt(slot);
  const pocket = wheel.pockets[number] ?? plainPocket();
  return {
    ballId: ball.id,
    launch: launched,
    drop: dropped,
    scatters,
    settles,
    nudgesUsed: before - pool.remaining,
    final: {
      number,
      multiplier: pocketMultiplier(pocket, {
        hits: context.hits[number] ?? 0,
        sector: sectorOf(number),
        bonuses,
      }),
      wild: hasTrait(pocket, "wild") && !context.wildSpent.includes(number),
    },
  };
}

/**
 * Stage 6 — Payout, and the whole spin.
 *
 * Bets are validated here rather than trusted, because the validator runs
 * this same function against an input log it did not write: a crafted split
 * across two numbers that do not touch would otherwise buy 17-to-1 odds on
 * an arbitrary pair.
 */
export function spin(
  wheel: WheelState,
  input: SpinInput,
  seed: number | string,
  context: SpinContext = emptyContext(wheel),
): SpinResult {
  for (const bet of input.bets) {
    if (!isLegalBet(bet)) throw new IllegalBetError(bet);
  }

  const bonuses = setBonuses(wheel.pockets);
  // Tiers du cylindre buys a nudge for the table. It lands here rather than
  // in the table loop because the set is a property of the wheel, and the
  // table should not have to know which pockets are upgraded.
  const nudgeBudget = context.nudges;

  const rng = Rng.from(seed);
  // One pool for the whole spin, drained in ball order: the allowance
  // belongs to the table, so a two-ball spin cannot nudge twice as much as
  // a one-ball spin on the same wheel.
  const pool: NudgePool = { remaining: nudgeBudget };
  const byId = new Map(wheel.balls.map((ball) => [ball.id, ball]));
  const traces: BallTrace[] = [];
  for (const ballInput of input.balls) {
    const ball = byId.get(ballInput.ballId);
    if (!ball) throw new RangeError(`no ball ${ballInput.ballId} on this wheel`);
    traces.push(
      spinBall(wheel, ball, ballInput, trackPhase(seed, ball.id), pool, context, bonuses, rng),
    );
  }

  const pockets = traces.map((trace) => trace.final);
  const stake = input.bets.reduce((sum, bet) => sum + bet.amount, 0);
  const outcomes = input.bets.map((bet) => resolveBet(bet, pockets, wheel.zeroRule));
  const bonus = samePocketBonus(pockets, stake);

  const gross = outcomes.reduce((sum, o) => sum + o.returned, 0) + bonus.profit;
  const imprisoned = outcomes.reduce((sum, o) => sum + o.imprisoned, 0);

  // Stage 6's table-lived pockets, in order. `bank` swallows what its own
  // ball won and holds it; whatever is already held is released by the next
  // spin that pays anything, which is `07`'s "adds its payout to the next
  // hit anywhere". A spin that banks does not also release: a bank pocket is
  // a delay, and letting it pay out on the same spin would make it free.
  const bankedNow = bankedProfit(wheel, traces, outcomes);
  const paysSomething = gross > 0 && bankedNow < gross;
  const released = bankedNow === 0 && paysSomething ? context.banked : 0;
  const returned = gross - bankedNow + released;

  const cold = pockets.filter((p) => hasTrait(wheel.pockets[p.number] ?? plainPocket(), "cold"));
  const wildSpent = pockets.filter((p) => p.wild).map((p) => p.number);

  return {
    balls: traces,
    pockets,
    outcomes,
    stake,
    returned,
    net: returned + imprisoned - stake,
    samePocket: bonus,
    imprisoned,
    nudgesUsed: nudgeBudget - pool.remaining,
    banked: context.banked + bankedNow - released,
    bankedThisSpin: bankedNow,
    released,
    wildSpent,
    heatRelief: cold.length * COLD_RELIEF,
    bonuses,
  };
}

/**
 * Chips a `bank` pocket swallowed this spin.
 *
 * Only the winnings a bank ball itself produced: with two balls, one landing
 * on a bank pocket and one on a gaff, the gaff still pays now. `perBall` on
 * the outcome is what makes that possible, and is why `resolveBet` keeps it.
 */
function bankedProfit(
  wheel: WheelState,
  traces: readonly BallTrace[],
  outcomes: readonly BetOutcome[],
): number {
  const banking = new Set<number>();
  traces.forEach((trace, index) => {
    if (hasTrait(wheel.pockets[trace.final.number] ?? plainPocket(), "bank")) banking.add(index);
  });
  if (banking.size === 0) return 0;

  let total = 0;
  for (const outcome of outcomes) {
    outcome.perBall.forEach((profit, index) => {
      if (banking.has(index)) total += profit;
    });
  }
  return total;
}

/**
 * The shape the validator compares. Deliberately not the whole trace: it is
 * every number a payout depends on and nothing a renderer-only change could
 * shift, so a cosmetic edit to the fret records does not invalidate stored
 * runs.
 */
export function spinSummary(result: SpinResult) {
  return {
    pockets: result.pockets.map((p) => [p.number, p.multiplier]),
    stake: result.stake,
    returned: result.returned,
    net: result.net,
    imprisoned: result.imprisoned,
    samePocketPairs: result.samePocket.pairs,
    nudges: result.balls.map((b) => b.nudgesUsed),
  };
}

/** Applied by the table loop when a boss or trap scales a whole payout. */
export function scalePayout(returned: number, multiplier: number): number {
  return fpApply(returned, multiplier);
}
