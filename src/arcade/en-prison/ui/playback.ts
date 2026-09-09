/**
 * Turns a spin's trace into something a renderer can draw at 60fps.
 *
 * The sim reports ticks, not positions: a launch tick, a contact tick, a
 * tick per fret crossed. That is deliberate — it is the smallest thing a
 * validator can re-derive — but a renderer needs to know where the ball is
 * at an arbitrary moment, including between two crossings.
 *
 * This is the seam between them, and it is pure so it can be tested without
 * a browser. It never rolls anything; every number it returns is derived
 * from a trace the sim already produced.
 */

import type { BallTrace } from "../sim/spin.ts";
import { TICKS_PER_SECOND } from "../sim/state.ts";
import { ANGLE_UNITS, POCKET_COUNT, normalizeSlot, slotToAngle } from "../sim/wheel.ts";

/** What the ball is doing at a given moment. */
export type Phase = "waiting" | "track" | "drop" | "scatter" | "settled";

export type BallFrame = {
  ballId: string;
  phase: Phase;
  /**
   * Where the ball is, in angle units, in the *table* frame. The renderer
   * spins the rotor separately and this rides above it.
   */
  angle: number;
  /** Distance from the centre, 0 at the pocket ring and 1 on the ball track. */
  radius: number;
  /** The pocket under the ball once it is on the rotor, or null on the track. */
  slot: number | null;
  /** Frets crossed so far, for the tick cue. */
  crossings: number;
};

/** How long a whole spin takes, in ticks, from the launch tap. */
export function durationTicks(trace: BallTrace): number {
  const last = trace.scatters.at(-1);
  return (last ? last.endTick : trace.drop.contactTick) + SETTLE_HOLD_TICKS;
}

/** A beat of stillness after the ball stops, before the payout reads out. */
export const SETTLE_HOLD_TICKS = 30;

export function durationMs(trace: BallTrace): number {
  return Math.round((durationTicks(trace) * 1000) / TICKS_PER_SECOND);
}

export function tickAt(ms: number): number {
  return Math.floor((ms * TICKS_PER_SECOND) / 1000);
}

/**
 * Where a ball is at `tick`.
 *
 * The track phase is the one piece of motion the sim does not describe —
 * it has no reason to, since nothing about the outcome depends on where the
 * ball was mid-flight — so it is interpolated here: the ball runs backwards
 * around the rim, decelerating, and arrives at its exit angle exactly on
 * the drop tick. Everything after that is read off the trace.
 */
export function frameAt(trace: BallTrace, tick: number): BallFrame {
  const { launch, drop } = trace;

  if (tick < launch.dropTick) {
    const span = Math.max(1, launch.dropTick - launchTickOf(trace));
    const progress = Math.max(0, tick - launchTickOf(trace)) / span;
    // Ease out: the ball is fastest off the hand and slowest as it drops.
    const eased = 1 - (1 - progress) * (1 - progress);
    const travelled = TRACK_LAPS * ANGLE_UNITS * eased;
    return {
      ballId: trace.ballId,
      phase: tick <= launchTickOf(trace) ? "waiting" : "track",
      angle: wrap(launch.exitAngle + TRACK_LAPS * ANGLE_UNITS - travelled),
      radius: 1,
      slot: null,
      crossings: 0,
    };
  }

  if (tick < drop.contactTick) {
    // Falling off the track onto the rotor, past a diamond.
    const span = Math.max(1, drop.contactTick - launch.dropTick);
    const progress = (tick - launch.dropTick) / span;
    return {
      ballId: trace.ballId,
      phase: "drop",
      angle: wrap(launch.exitAngle),
      radius: 1 - progress,
      slot: null,
      crossings: 0,
    };
  }

  let slot = drop.contactSlot;
  let crossings = 0;
  for (const leg of trace.scatters) {
    for (const hit of leg.frets) {
      if (hit.tick > tick) {
        return {
          ballId: trace.ballId,
          phase: "scatter",
          angle: slotToAngle(slot),
          radius: 0,
          slot,
          crossings,
        };
      }
      slot = hit.slot;
      crossings += 1;
    }
    // A settle between legs: the ball is momentarily in a pocket it will
    // bounce out of, which is the beat the bounce cue plays on.
    const settle = trace.settles[leg.leg];
    if (settle) slot = settle.slot;
  }

  return {
    ballId: trace.ballId,
    phase: "settled",
    angle: slotToAngle(slot),
    radius: 0,
    slot,
    crossings,
  };
}

/** Laps the renderer shows the ball running before it drops. */
export const TRACK_LAPS = 4;

/**
 * The trace carries the drop, not the tap that caused it, because nothing
 * about the outcome depends on the run-up. The renderer only needs a
 * plausible one, so it shows a fixed three seconds of track.
 */
export const TRACK_RUN_UP_TICKS = 180;

function launchTickOf(trace: BallTrace): number {
  return trace.launch.dropTick - TRACK_RUN_UP_TICKS;
}

function wrap(angle: number): number {
  return ((angle % ANGLE_UNITS) + ANGLE_UNITS) % ANGLE_UNITS;
}

/**
 * The moments a sound or a shake hangs off: every fret crossing, every
 * settle, and the stop. Returned in tick order so a player can walk them
 * with a single cursor rather than searching the trace each frame.
 */
export type Cue =
  | { tick: number; kind: "fret"; nudged: boolean }
  | { tick: number; kind: "bounce" }
  | { tick: number; kind: "settle"; number: number };

export function cues(trace: BallTrace): Cue[] {
  const out: Cue[] = [];
  for (const leg of trace.scatters) {
    for (const hit of leg.frets) out.push({ tick: hit.tick, kind: "fret", nudged: hit.nudged });
    const settle = trace.settles[leg.leg];
    const end = leg.endTick;
    if (settle?.bounced) out.push({ tick: end, kind: "bounce" });
  }
  const last = trace.settles.at(-1);
  if (last) {
    out.push({
      tick: trace.scatters.at(-1)?.endTick ?? trace.drop.contactTick,
      kind: "settle",
      number: last.number,
    });
  }
  return out.sort((a, b) => a.tick - b.tick);
}

/** Pocket slots the drop band covers, for the highlight the player reads. */
export function bandSlots(centreSlot: number, halfWidth: number): number[] {
  const width = Math.min(halfWidth, Math.floor(POCKET_COUNT / 2));
  const out: number[] = [];
  for (let offset = -width; offset <= width; offset++) out.push(normalizeSlot(centreSlot + offset));
  return out;
}
