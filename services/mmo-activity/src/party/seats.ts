import { Unseen, type PuzzleLayout, type PuzzleMove } from "../api.ts";
import { within } from "../shell/kit.ts";

// The seat rules every party version shares, as sim/puzzle/make_party.go
// has them.

/** The seat a move was made from; seat 0 is left off the wire. */
export function seatOf(m: PuzzleMove): number {
  return m.seat ?? 0;
}

/** Whether a move names a seat the machine has. */
export function seated(layout: PuzzleLayout, m: PuzzleMove): boolean {
  return within(seatOf(m), layout.seats ?? 0);
}

/** The seat holding role r once the roles have passed turn times. */
export function holder(r: number, turn: number, seats: number): number {
  return (r + turn) % seats;
}

/** How many times the roles have passed after progress; never with no pass. */
export function passTurn(layout: PuzzleLayout, progress: number): number {
  const pass = layout.pass ?? 0;
  return pass > 0 ? Math.trunc(progress / pass) : 0;
}

/**
 * A dealt array with what a glimpse of another seat's part shows besides:
 * an element this seat is not shown takes the glimpse's.
 */
export function glimpsed(
  mine: number[] | undefined,
  more: number[] | undefined,
): number[] | undefined {
  if (!more) return mine;
  if (!mine) return [...more];
  return mine.map((x, i) => (x === Unseen ? (more[i] ?? Unseen) : x));
}
