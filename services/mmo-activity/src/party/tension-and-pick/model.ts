import type { PuzzleLayout, PuzzleMove } from "../../api.ts";
import { BROKE, GOING, Untimed, until, within, type Model, type Status } from "../../shell/kit.ts";
import { holder, passTurn, seatOf, seated } from "../seats.ts";

/** The roles: the seat lifting pins, the seat on the tension lever. */
export const PICK = 0;
export const TENSION = 1;
/** A move's kind: a pin set, the tension on, the tension off. */
export const PIN = 0;
export const ON = 1;
export const OFF = 2;
/** No tension on the lock. */
export const SLACK = -1;

// Tension and pick, as sim/puzzle/party_pins.go plays it: one seat puts the
// tension on and another lifts the binding pin inside the window. Each pin
// set passes both roles on, and the new tension seat must pull again.
export class TensionPickModel extends Untimed implements Model {
  /** Pins set so far. */
  k = 0;
  /** The ms the tension went on. */
  ten = SLACK;
  private readonly order: number[];
  private readonly target: number[];
  private readonly pins: number;

  constructor(private readonly layout: PuzzleLayout) {
    super();
    this.order = layout.order ?? [];
    this.target = layout.target ?? [];
    this.pins = layout.size + (layout.false?.length ?? 0);
  }

  /** The seat holding role r now. */
  role(r: number): number {
    return holder(r, passTurn(this.layout, this.k), this.layout.seats ?? 1);
  }

  apply(m: PuzzleMove): Status {
    const l = this.layout;
    if (!seated(l, m) || !within(m.a, this.pins)) return BROKE;
    const s = seatOf(m);
    switch (m.c ?? 0) {
      case ON:
      case OFF:
        if (s !== this.role(TENSION)) return GOING;
        if (m.c === ON) this.ten = m.at;
        else this.drop();
        return GOING;
      case PIN:
        if (s !== this.role(PICK)) return GOING;
        if (
          this.ten === SLACK ||
          m.at - this.ten > (l.window ?? 0) ||
          m.a !== this.order[this.k] ||
          (m.b ?? 0) !== this.target[m.a]
        ) {
          this.drop();
          return GOING;
        }
        this.k++;
        this.ten = SLACK;
        return until(this.k === l.size);
    }
    return BROKE;
  }

  /** Whether the tension is on and still inside the window at ms. */
  tense(at: number): boolean {
    return this.ten !== SLACK && at - this.ten <= (this.layout.window ?? 0);
  }

  /** The pin that binds now. */
  binding(): number | undefined {
    return this.order[this.k];
  }

  /** Whether a pin is held at the line. */
  set(pin: number): boolean {
    const i = this.order.indexOf(pin);
    return i >= 0 && i < this.k;
  }

  private drop(): void {
    this.k = 0;
    this.ten = SLACK;
  }

  snapshot(): number[] {
    return [this.k, this.ten];
  }
}
