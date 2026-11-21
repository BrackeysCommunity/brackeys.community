import type { PuzzleLayout, PuzzleMove } from "../../api.ts";
import { BROKE, GOING, Untimed, until, within, type Model, type Status } from "../../shell/kit.ts";
import { seatOf, seated } from "../seats.ts";

/** A split panel move's kind: a plug by a wires seat, a lit port by a ports seat. */
export const PLUG = 0;
export const MARK = 2;
/** A ports seat that has lit nothing. */
export const UNLIT = -1;

/** Even seats hold wires, odd seats read ports. */
export function wiresSeat(seat: number): boolean {
  return seat % 2 === 0;
}

/** A seat's place among the seats on its side. */
export function rank(seat: number): number {
  return Math.trunc(seat / 2);
}

/** How many seats hold wires, and how many read ports. */
export function sides(seats: number): { wires: number; ports: number } {
  return { wires: Math.trunc((seats + 1) / 2), ports: Math.trunc(seats / 2) };
}

/** The wires seat that plugs wire w. */
export function plugger(w: number, seats: number): number {
  return 2 * (w % sides(seats).wires);
}

// Split panel, as sim/puzzle/party_rewire.go plays it: a wires seat plugs
// only its own wires, a ports seat lights a port for everyone. A seat is
// dealt no target, so on screen the model never says done: the server does.
export class SplitPanelModel extends Untimed implements Model {
  /** Each wire's port. */
  readonly at: number[];
  /** The port each seat has lit. */
  readonly mark: number[];
  private readonly target: number[] | undefined;
  private readonly n: number;

  constructor(private readonly layout: PuzzleLayout) {
    super();
    this.n = layout.size;
    this.target = layout.target;
    this.at = Array.from({ length: this.n }, (_, i) => i);
    this.mark = Array.from({ length: layout.seats ?? 0 }, () => UNLIT);
  }

  apply(m: PuzzleMove): Status {
    if (!seated(this.layout, m)) return BROKE;
    const s = seatOf(m);
    const b = m.b ?? 0;
    switch (m.c ?? 0) {
      case PLUG:
        if (!within(m.a, this.n) || !within(b, this.n)) return BROKE;
        if (!wiresSeat(s) || m.a % sides(this.layout.seats ?? 0).wires !== rank(s)) return GOING;
        this.plug(m.a, b);
        return until(this.target !== undefined && this.at.every((p, w) => p === this.target![w]));
      case MARK:
        if (!within(b, this.n)) return BROKE;
        if (!wiresSeat(s)) this.mark[s] = b;
        return GOING;
    }
    return BROKE;
  }

  /** Whether seat s may plug wire w. */
  holds(s: number, w: number): boolean {
    return wiresSeat(s) && w % sides(this.layout.seats ?? 0).wires === rank(s);
  }

  private plug(a: number, b: number): void {
    const from = this.at[a]!;
    for (let w = 0; w < this.n; w++) if (this.at[w] === b) this.at[w] = from;
    this.at[a] = b;
  }

  snapshot(): number[] {
    return [...this.at, ...this.mark];
  }
}
