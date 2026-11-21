import type { PuzzleLayout, PuzzleMove } from "../../api.ts";
import { BROKE, DONE, GOING, type Model, type Status } from "../../shell/kit.ts";

// Where each number sits in the layout's par.
const WIDTH = 0;
const STRIKES = 1;
const FASTEST = 2;

/** How a swipe read against the pass it was for. */
export type Read = "good" | "fast" | "slow";

// Keycard, as sim/puzzle/keycard.go plays it: each pass wants a swipe of
// its own length in ms, the reader forgives a few bad ones, and a swipe
// longer than the time since the last could not have happened.
export class KeycardModel implements Model {
  /** Passes read. */
  k = 0;
  /** Bad swipes so far. */
  bad = 0;
  /** The ms the last swipe ended at. */
  last = 0;
  private readonly target: number[];
  private readonly par: number[];
  private readonly size: number;

  constructor(layout: PuzzleLayout) {
    this.target = layout.target ?? [];
    this.par = layout.par ?? [];
    this.size = layout.size;
  }

  /** How far off a swipe may be, in ms. */
  get width(): number {
    return this.par[WIDTH] ?? 0;
  }

  /** The bad swipes the reader forgives. */
  get strikes(): number {
    return this.par[STRIKES] ?? 0;
  }

  /** The fastest swipe the reader can time, in ms. */
  get fastest(): number {
    return this.par[FASTEST] ?? 0;
  }

  /** How a swipe of a ms would read on the pass in hand. */
  read(a: number): Read {
    const off = a - (this.target[this.k] ?? 0);
    if (off < -this.width) return "fast";
    return off > this.width ? "slow" : "good";
  }

  run(at: number): [Status, number] {
    return [GOING, at];
  }

  // One swipe that took a ms and ended at the move's stamp.
  apply(m: PuzzleMove): Status {
    if (m.a < 1 || m.a > m.at - this.last) return BROKE;
    this.last = m.at;
    if (this.read(m.a) === "good") {
      this.k++;
      return this.k === this.size ? DONE : GOING;
    }
    this.bad++;
    return this.bad > this.strikes ? BROKE : GOING;
  }

  snapshot(): number[] {
    return [this.k, this.bad, this.last];
  }
}
