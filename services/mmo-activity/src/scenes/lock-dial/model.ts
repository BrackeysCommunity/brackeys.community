import type { PuzzleLayout, PuzzleMove } from "../../api.ts";
import { BROKE, DONE, GOING, type Model, type Status } from "../../shell/kit.ts";

// The dial lock, as sim/puzzle/dial.go plays it: the dials click one after
// another, each at its number and only when turned its own way.
export class DialModel implements Model {
  /** Dials clicked so far; dial k is the one in turn. */
  k = 0;
  private readonly target: number[];
  private readonly turn: number[];

  constructor(private readonly layout: PuzzleLayout) {
    this.target = layout.target ?? [];
    this.turn = layout.turn ?? [];
  }

  run(at: number): [Status, number] {
    return [GOING, at];
  }

  // Leaves dial a at number b, turned the way c says. Touching a dial out
  // of turn drops them all.
  apply(m: PuzzleMove): Status {
    if (!(m.a >= 0 && m.a < this.layout.size)) return BROKE;
    if (m.a !== this.k) this.k = 0;
    else if ((m.b ?? 0) === this.target[m.a] && (m.c ?? 0) === this.turn[m.a]) this.k++;
    return this.k === this.layout.size ? DONE : GOING;
  }

  /** Whether dial a would click at number b, arrived at the way c says. */
  clicks(a: number, b: number, c: number): boolean {
    return a === this.k && b === this.target[a] && c === this.turn[a];
  }

  snapshot(): number[] {
    return [this.k];
  }
}
