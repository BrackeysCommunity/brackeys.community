import type { PuzzleLayout, PuzzleMove } from "../../api.ts";
import { SIDES, rotate, step } from "../../shell/grid.ts";
import { BROKE, GOING, Untimed, until, within, type Model, type Status } from "../../shell/kit.ts";

/** Tile kinds, as the layout numbers them. */
export const EMPTY = 0;
export const STRAIGHT = 1;
export const CORNER = 2;
export const TEE = 3;
export const END = 4;

// The sides each kind opens before it is turned, as bits: east 1, south 2,
// west 4, north 8.
const OPENS = [0, 5, 3, 7, 1];

/** The sides a tile opens at its turn. */
export function sidesOf(layout: PuzzleLayout, turns: number[], cell: number): number {
  return rotate(OPENS[layout.tiles?.[cell] ?? EMPTY] ?? 0, turns[cell] ?? 0);
}

/** The tiles power reaches from the source, through sides open on both tiles. */
export function lit(layout: PuzzleLayout, turns: number[]): boolean[] {
  const n = layout.size;
  const on: boolean[] = Array.from({ length: n * n }, () => false);
  on[layout.start] = true;
  const queue = [layout.start];
  for (let c = queue.shift(); c !== undefined; c = queue.shift()) {
    const mask = sidesOf(layout, turns, c);
    for (let side = 0; side < SIDES; side++) {
      if ((mask & (1 << side)) === 0) continue;
      const nb = step(c, side, n);
      const back = 1 << ((side + 2) % SIDES);
      if (nb === undefined || on[nb] || (sidesOf(layout, turns, nb) & back) === 0) continue;
      on[nb] = true;
      queue.push(nb);
    }
  }
  return on;
}

// Circuit, as sim/puzzle/circuit.go plays it: a move gives a tile a
// quarter turn; the load must be lit and no trap.
export class CircuitModel extends Untimed implements Model {
  /** Each tile's turn. */
  readonly at: number[];

  constructor(private readonly layout: PuzzleLayout) {
    super();
    this.at = [...(layout.turn ?? [])];
  }

  apply(m: PuzzleMove): Status {
    const l = this.layout;
    if (!within(m.a, l.size * l.size)) return BROKE;
    this.at[m.a] = ((this.at[m.a] ?? 0) + 1) % SIDES;
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
