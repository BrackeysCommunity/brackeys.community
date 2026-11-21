import type { PuzzleLayout, PuzzleMove } from "../../api.ts";
import { DOWN, DRAG, SpliceModel } from "../../scenes/splice/model.ts";
import { BROKE, GOING, within, type Status } from "../../shell/kit.ts";
import { holder, passTurn, seated } from "../seats.ts";

// The iron is the one role.
const IRON = 0;

// Relay solder, as sim/puzzle/party_splice.go plays it: Splice's trace
// cut into segments of pass positions, each a seat's. A solder that ends
// a segment lifts the iron, and the next seat sets it down at the joint.
export class SolderModel extends SpliceModel {
  constructor(private readonly layout: PuzzleLayout) {
    super(layout);
  }

  /** The seat that solders a position. */
  ironAt(i: number): number {
    return holder(IRON, passTurn(this.layout, i), this.layout.seats ?? 1);
  }

  /** The seat a move of code c must come from: a drag solders the next position only, a lift or set-down the next past any gap. */
  seatFor(c: number): number {
    return this.ironAt(c === DRAG ? this.k : this.across());
  }

  /** Whether position i ends its seat's segment. */
  joint(i: number): boolean {
    return passTurn(this.layout, i + 1) !== passTurn(this.layout, i);
  }

  override apply(m: PuzzleMove): Status {
    const c = m.c ?? 0;
    const l = this.layout;
    if (!seated(l, m) || !within(m.a, l.size * (l.range ?? 0)) || !within(c, DOWN + 1))
      return BROKE;
    if ((m.seat ?? 0) !== this.seatFor(c)) return GOING;
    const before = this.k;
    const st = super.apply(m);
    if (st === GOING && this.k > before && this.joint(this.k - 1)) this.on = false;
    return st;
  }

  override snapshot(): number[] {
    return [...super.snapshot(), this.ironAt(this.across())];
  }
}
