import { Unseen, type PuzzleLayout, type PuzzleMove } from "../../api.ts";
import { OverrideModel } from "../../scenes/override/model.ts";
import { BROKE, DONE, GOING, within, type Status } from "../../shell/kit.ts";
import { holder, passTurn, seated } from "../seats.ts";

/** What c says of a move: a press on the keypad, or a symbol called to the others. */
export const PRESS = 0;
export const CALL = 1;

// The keypad is the one role.
const KEYPAD = 0;

/** One symbol a seat called. */
export interface Call {
  seat: number;
  symbol: number;
  at: number;
}

// Call and answer, as sim/puzzle/party_override.go plays it: one seat
// holds the keypad and presses Override's growing sequence, the others
// call the symbols they were dealt, and the keypad passes each round. On a
// dealt part a press of a symbol this seat was not shown cannot be judged
// here, so the model takes it and never says done: the server does.
export class CallModel extends OverrideModel {
  /** Rounds pressed in full. */
  rounds = 0;
  /** Every call made, in the order it landed. */
  readonly calls: Call[] = [];
  /** A press was taken against a symbol this part does not show. */
  blind = false;
  private ends = 1;
  private readonly total: number;

  constructor(private readonly layout: PuzzleLayout) {
    super(layout);
    this.total = (layout.size * (layout.size + 1)) / 2;
  }

  /** The seat at the keypad now. */
  get keypad(): number {
    return holder(KEYPAD, passTurn(this.layout, this.rounds), this.layout.seats ?? 1);
  }

  /** Whether a seat was dealt symbol i of the sequence. */
  sees(seat: number, i: number): boolean {
    const order = this.layout.order ?? [];
    return i % Math.max(1, this.layout.seats ?? 1) === seat && order[i] !== Unseen;
  }

  /** The symbol the next press wants, Unseen when this part does not show it. */
  wanted(): number {
    if (this.k >= this.total) return Unseen;
    return this.layout.order?.[this.progress().entered] ?? Unseen;
  }

  override apply(m: PuzzleMove): Status {
    const c = m.c ?? 0;
    if (!seated(this.layout, m) || !within(m.a, this.layout.range ?? 0)) return BROKE;
    if (c === CALL) {
      this.calls.push({ seat: m.seat ?? 0, symbol: m.a, at: m.at });
      return GOING;
    }
    if (c !== PRESS) return BROKE;
    if ((m.seat ?? 0) !== this.keypad) return GOING;
    let st: Status;
    if (this.wanted() === Unseen) {
      this.blind = true;
      this.k++;
      st = GOING;
    } else st = super.apply(m);
    if (st === GOING && this.k === this.ends) {
      this.rounds++;
      this.ends += this.rounds + 1;
    }
    return st === DONE && this.blind ? GOING : st;
  }
}
