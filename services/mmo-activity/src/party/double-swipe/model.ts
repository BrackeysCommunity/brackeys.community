import type { PuzzleLayout, PuzzleMove } from "../../api.ts";
import type { Read } from "../../scenes/keycard/model.ts";
import { BROKE, GOING, Untimed, until, within, type Model, type Status } from "../../shell/kit.ts";
import { holder, passTurn, seated } from "../seats.ts";

// Where each number sits in the layout's par, as in the family's model.
const WIDTH = 0;
const STRIKES = 1;
const FASTEST = 2;

/** A double swipe has two readers. */
export const READERS = 2;

// Double swipe, as sim/puzzle/party_keycard.go plays it: Keycard with two
// readers that must both read a pass within the window of each other.
// Target is the first reader's speeds and key the second's, and the
// readers change hands on each pass.
export class SwipeModel extends Untimed implements Model {
  /** Passes read. */
  k = 0;
  /** Bad swipes so far. */
  bad = 0;
  /** The ms each reader's last swipe ended at. */
  readonly last = [0, 0];
  /** The ms of each reader's good swipe on this pass; -1 for none. */
  readonly good = [-1, -1];
  private readonly par: number[];

  constructor(private readonly layout: PuzzleLayout) {
    super();
    this.par = layout.par ?? [];
  }

  /** How far off a swipe may be, in ms. */
  get width(): number {
    return this.par[WIDTH] ?? 0;
  }

  /** The bad swipes the readers forgive between them. */
  get strikes(): number {
    return this.par[STRIKES] ?? 0;
  }

  /** The fastest swipe a reader can time, in ms. */
  get fastest(): number {
    return this.par[FASTEST] ?? 0;
  }

  /** The ms a reader wants on the pass in hand. */
  want(reader: number): number {
    const speeds = reader === 1 ? this.layout.key : this.layout.target;
    return speeds?.[this.k] ?? 0;
  }

  /** The seat holding a reader on the pass in hand. */
  readerSeat(reader: number): number {
    return holder(reader, passTurn(this.layout, this.k), this.layout.seats ?? 1);
  }

  /** How a swipe of a ms would read on a reader. */
  read(reader: number, a: number): Read {
    const off = a - this.want(reader);
    if (off < -this.width) return "fast";
    return off > this.width ? "slow" : "good";
  }

  // A swipe of reader b that took a ms, by the seat holding it.
  apply(m: PuzzleMove): Status {
    const b = m.b ?? 0;
    if (!seated(this.layout, m) || !within(b, READERS) || m.a < 1) return BROKE;
    if ((m.seat ?? 0) !== this.readerSeat(b)) return GOING;
    if (m.a > m.at - this.last[b]!) return BROKE;
    this.last[b] = m.at;
    if (this.read(b, m.a) !== "good") {
      this.bad++;
      this.good[b] = -1;
      return this.bad > this.strikes ? BROKE : GOING;
    }
    this.good[b] = m.at;
    const [x, y] = this.good as [number, number];
    if (x < 0 || y < 0) return GOING;
    if (Math.abs(x - y) <= (this.layout.window ?? 0)) {
      this.k++;
      this.good[0] = -1;
      this.good[1] = -1;
      return until(this.k === this.layout.size);
    }
    this.good[x < y ? 0 : 1] = -1;
    return GOING;
  }

  snapshot(): number[] {
    return [this.k, this.bad, this.good[0]!, this.good[1]!];
  }
}
