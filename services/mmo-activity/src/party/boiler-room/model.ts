import type { PuzzleLayout, PuzzleMove } from "../../api.ts";
import { PressureModel } from "../../scenes/pressure/model.ts";
import { BROKE, GOING, within, type Status } from "../../shell/kit.ts";
import { seated } from "../seats.ts";

// Where the coupling sits in the layout's par, as in the family's model.
const COUPLE = 3;

/** The seat whose hands a valve is in. */
export function valveSeat(valve: number, seats: number): number {
  return valve % Math.max(1, seats);
}

// Boiler room, as sim/puzzle/party_pressure.go plays it: Pressure with
// every needle coupled to every valve, and each valve held by one seat.
export class BoilerModel extends PressureModel {
  private readonly layout: PuzzleLayout;

  constructor(layout: PuzzleLayout) {
    super(layout);
    this.layout = layout;
  }

  /** What a turn takes from every needle but its own. */
  get couple(): number {
    return this.layout.par?.[COUPLE] ?? 0;
  }

  /** Whether a seat holds a valve. */
  holds(seat: number, valve: number): boolean {
    return valveSeat(valve, this.layout.seats ?? 0) === seat;
  }

  // Turns valve a: its own needle by nudge, every other needle by couple
  // the other way. A turn by a seat that does not hold the valve is
  // ignored.
  override apply(m: PuzzleMove): Status {
    const a = m.a;
    const b = m.b ?? 0;
    if (!seated(this.layout, m) || !within(a, this.v.length) || (b !== 1 && b !== -1)) return BROKE;
    if (!this.holds(m.seat ?? 0, a)) return GOING;
    for (let i = 0; i < this.v.length; i++)
      this.v[i]! += i === a ? b * this.nudge : -b * this.couple;
    const range = this.layout.range ?? 0;
    for (const [i, x] of this.v.entries()) {
      this.v[i] = Math.max(0, x);
      if (x >= range) return BROKE;
    }
    return GOING;
  }
}
