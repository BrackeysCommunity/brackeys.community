import type { PuzzleLayout, PuzzleMove } from "../../api.ts";
import { gridOf, type Grid } from "../../shell/grid.ts";
import { BROKE, GOING, Untimed, until, within, type Model, type Status } from "../../shell/kit.ts";

/** Square tile kinds, as the layout numbers them. */
export const EMPTY = 0;
export const STRAIGHT = 1;
export const CORNER = 2;
export const TEE = 3;
export const END = 4;

/** Hex tile kinds: a wide bend turns a third, a sharp one a sixth; a Y is only ever a decoy. */
export const HEX_EMPTY = 0;
export const HEX_STRAIGHT = 1;
export const HEX_WIDE = 2;
export const HEX_SHARP = 3;
export const HEX_Y = 4;
export const HEX_END = 5;

// The sides each kind opens before it is turned, as bits. Square: east 1,
// south 2, west 4, north 8. Hex: east 1, south-east 2, south-west 4,
// west 8, north-west 16, north-east 32.
const SQUARE_OPENS = [0, 5, 3, 7, 1];
const HEX_OPENS = [0, 9, 5, 3, 21, 1];

function opensOf(grid: Grid): number[] {
  return grid.hex ? HEX_OPENS : SQUARE_OPENS;
}

/** The sides a tile opens at its turn. */
export function sidesOf(layout: PuzzleLayout, turns: number[], cell: number): number {
  const grid = gridOf(layout.shape);
  return grid.rotate(opensOf(grid)[layout.tiles?.[cell] ?? EMPTY] ?? 0, turns[cell] ?? 0);
}

/** The tiles power reaches from the source, through sides open on both tiles. */
export function lit(layout: PuzzleLayout, turns: number[]): boolean[] {
  const n = layout.size;
  const grid = gridOf(layout.shape);
  const on: boolean[] = Array.from({ length: n * n }, () => false);
  on[layout.start] = true;
  const queue = [layout.start];
  for (let c = queue.shift(); c !== undefined; c = queue.shift()) {
    const mask = sidesOf(layout, turns, c);
    for (let side = 0; side < grid.sides; side++) {
      if ((mask & (1 << side)) === 0) continue;
      const nb = grid.step(c, side, n);
      const back = 1 << grid.opposite(side);
      if (nb === undefined || on[nb] || (sidesOf(layout, turns, nb) & back) === 0) continue;
      on[nb] = true;
      queue.push(nb);
    }
  }
  return on;
}

// Circuit, as sim/puzzle/circuit.go plays it: a move gives a tile one
// turn, a quarter on a square board and a sixth on a hex one; the load
// must be lit and no trap.
export class CircuitModel extends Untimed implements Model {
  /** Each tile's turn. */
  readonly at: number[];
  readonly grid: Grid;

  constructor(private readonly layout: PuzzleLayout) {
    super();
    this.at = [...(layout.turn ?? [])];
    this.grid = gridOf(layout.shape);
  }

  apply(m: PuzzleMove): Status {
    const l = this.layout;
    if (!within(m.a, l.size * l.size)) return BROKE;
    this.at[m.a] = ((this.at[m.a] ?? 0) + 1) % this.grid.sides;
    const on = this.lit();
    if ((l.false ?? []).some((trap) => on[trap])) return GOING;
    return until(on[l.goal] === true);
  }

  lit(): boolean[] {
    return lit(this.layout, this.at);
  }

  snapshot(): number[] {
    return [...this.at];
  }
}
