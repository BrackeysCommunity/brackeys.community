import type { PuzzleLayout, PuzzleMove } from "../../api.ts";
import { BROKE, Untimed, until, type Model, type Status } from "../../shell/kit.ts";

// Fuse, as sim/puzzle/fuse.go plays it: the fuses come out in one order,
// and any other pull blows the box.
export class FuseModel extends Untimed implements Model {
  /** Fuses pulled so far. */
  k = 0;
  private readonly order: number[];

  constructor(private readonly layout: PuzzleLayout) {
    super();
    this.order = layout.order ?? [];
  }

  apply(m: PuzzleMove): Status {
    if (m.a !== this.order[this.k]) return BROKE;
    this.k++;
    return until(this.k === this.layout.size);
  }

  /** Whether a fuse is out. */
  pulled(fuse: number): boolean {
    const i = this.order.indexOf(fuse);
    return i >= 0 && i < this.k;
  }

  snapshot(): number[] {
    return [this.k];
  }
}
