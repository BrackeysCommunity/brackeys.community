import type { PuzzleLayout, PuzzleMove } from "../../api.ts";
import { BROKE, Untimed, until, within, type Model, type Status } from "../../shell/kit.ts";

// The pin lock, as sim/puzzle/pins.go plays it: the pins bind one at a
// time, in order, and each holds only at its own height.
export class PinsModel extends Untimed implements Model {
  /** Pins set so far. */
  k = 0;
  private readonly order: number[];
  private readonly target: number[];
  private readonly pins: number;

  constructor(private readonly layout: PuzzleLayout) {
    super();
    this.order = layout.order ?? [];
    this.target = layout.target ?? [];
    this.pins = layout.size + (layout.false?.length ?? 0);
  }

  // Leaves pin a at height b: the binding pin at its height holds;
  // anything else drops every pin.
  apply(m: PuzzleMove): Status {
    if (!within(m.a, this.pins)) return BROKE;
    if (m.a === this.order[this.k] && (m.b ?? 0) === this.target[m.a]) this.k++;
    else this.k = 0;
    return until(this.k === this.layout.size);
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

  snapshot(): number[] {
    return [this.k];
  }
}
