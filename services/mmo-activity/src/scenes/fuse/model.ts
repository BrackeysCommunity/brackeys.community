import type { PuzzleLayout, PuzzleMove } from "../../api.ts";
import { BROKE, DONE, GOING, type Model, type Status } from "../../shell/kit.ts";

// Fuse, as sim/puzzle/fuse.go plays it: the fuses come out in one order,
// and any other pull blows the box.
export class FuseModel implements Model {
  /** Fuses pulled so far. */
  k = 0;
  private readonly order: number[];

  constructor(private readonly layout: PuzzleLayout) {
    this.order = layout.order ?? [];
  }

  run(at: number): [Status, number] {
    return [GOING, at];
  }

  apply(m: PuzzleMove): Status {
    if (m.a !== this.order[this.k]) return BROKE;
    this.k++;
    return this.k === this.layout.size ? DONE : GOING;
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
