import type { PuzzleLayout, PuzzleMove } from "../../api.ts";
import { BROKE, Untimed, until, type Model, type Status } from "../../shell/kit.ts";

// Override, as sim/puzzle/override.go plays it: round r wants the first r
// symbols of the sequence, and a wrong press breaks the machine.
export class OverrideModel extends Untimed implements Model {
  /** Presses made, over every round. */
  k = 0;
  private readonly seq: number[] = [];

  constructor(layout: PuzzleLayout) {
    super();
    const order = layout.order ?? [];
    for (let r = 0; r < layout.size; r++) this.seq.push(...order.slice(0, r + 1));
  }

  apply(m: PuzzleMove): Status {
    if (m.a !== this.seq[this.k]) return BROKE;
    this.k++;
    return until(this.k === this.seq.length);
  }

  /** The round in play, counted from 0, and the presses made in it. */
  progress(): { round: number; entered: number } {
    let round = 0;
    let left = this.k;
    while (left > round) left -= ++round;
    return { round, entered: left };
  }

  snapshot(): number[] {
    return [this.k];
  }
}
