import type { PuzzleLayout, PuzzleMove } from "../../api.ts";
import circuit from "../../scenes/circuit/index.ts";
import { BROKE, GOING, within, type Model, type Status } from "../../shell/kit.ts";
import { seatOf, seated } from "../seats.ts";

/**
 * The seat whose region cell c is in: four seats share the board in
 * quarters, fewer in columns. A hex board uses the same rhombus indices.
 */
export function region(layout: PuzzleLayout, c: number): number {
  const n = layout.size;
  const seats = layout.seats ?? 1;
  const x = c % n;
  const y = Math.trunc(c / n);
  if (seats === 4) return Math.trunc((x * 2) / n) + 2 * Math.trunc((y * 2) / n);
  return Math.trunc((x * seats) / n);
}

// Split grid, as sim/puzzle/party_circuit.go plays it: each seat turns only
// the tiles of its own region, and the power has to cross the seams. The
// turn itself is the family's.
export class SplitGridModel implements Model {
  /** The family's board, which the turns go through. */
  readonly grid: Model;

  constructor(private readonly layout: PuzzleLayout) {
    this.grid = circuit.start(layout);
  }

  run(at: number): [Status, number] {
    return [GOING, at];
  }

  apply(m: PuzzleMove): Status {
    const n = this.layout.size;
    if (!seated(this.layout, m) || !within(m.a, n * n)) return BROKE;
    if (seatOf(m) !== region(this.layout, m.a)) return GOING;
    return this.grid.apply(m);
  }

  snapshot(): number[] {
    return this.grid.snapshot();
  }
}
