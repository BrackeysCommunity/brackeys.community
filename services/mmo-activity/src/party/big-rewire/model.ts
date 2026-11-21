import type { PuzzleLayout, PuzzleMove } from "../../api.ts";
import { BROKE, GOING, Untimed, until, within, type Model, type Status } from "../../shell/kit.ts";
import { seatOf, seated } from "../seats.ts";

/** A big rewire move's kind: a plug, or a grab of the wire. */
export const PLUG = 0;
export const GRAB = 1;
/** A hand holding no wire. */
export const EMPTY = -1;

// Big rewire, as sim/puzzle/party_rewire.go plays it: each seat holds one
// wire at a time, and a plug that crosses a wire another hand holds drops
// every hand.
export class BigRewireModel extends Untimed implements Model {
  /** Each wire's port. */
  readonly at: number[];
  /** The wire each seat holds. */
  readonly hold: number[];
  private readonly target: number[];
  private readonly n: number;

  constructor(private readonly layout: PuzzleLayout) {
    super();
    this.n = layout.size;
    this.target = layout.target ?? [];
    this.at = Array.from({ length: this.n }, (_, i) => i);
    this.hold = Array.from({ length: layout.seats ?? 0 }, () => EMPTY);
  }

  apply(m: PuzzleMove): Status {
    if (!seated(this.layout, m) || !within(m.a, this.n)) return BROKE;
    const s = seatOf(m);
    const b = m.b ?? 0;
    switch (m.c ?? 0) {
      case GRAB:
        if (this.hold[s] === EMPTY && !this.hold.includes(m.a)) this.hold[s] = m.a;
        return GOING;
      case PLUG:
        if (!within(b, this.n)) return BROKE;
        if (this.hold[s] !== m.a) return GOING;
        for (const [t, h] of this.hold.entries()) {
          if (t !== s && h !== EMPTY && this.crosses(m.a, b, h)) {
            this.hold.fill(EMPTY);
            return GOING;
          }
        }
        this.hold[s] = EMPTY;
        return until(this.plug(m.a, b));
    }
    return BROKE;
  }

  /** Whether wire a run to port b would cross held wire h where it sits. */
  crosses(a: number, b: number, h: number): boolean {
    return (a - h) * (b - this.at[h]!) < 0;
  }

  /** The seat holding wire w, if one does. */
  holderOf(w: number): number | undefined {
    const s = this.hold.indexOf(w);
    return s < 0 ? undefined : s;
  }

  /** Whether wire w sits in its own port. */
  seated(w: number): boolean {
    return this.at[w] === this.target[w];
  }

  private plug(a: number, b: number): boolean {
    const from = this.at[a]!;
    for (let w = 0; w < this.n; w++) if (this.at[w] === b) this.at[w] = from;
    this.at[a] = b;
    return this.at.every((port, w) => port === this.target[w]);
  }

  snapshot(): number[] {
    return [...this.at, ...this.hold];
  }
}
