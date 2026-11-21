import type { PuzzleLayout, PuzzleMove } from "../../api.ts";
import { BROKE, GOING, Untimed, until, within, type Model, type Status } from "../../shell/kit.ts";
import { seatOf, seated } from "../seats.ts";

/** A dial of the open pair that has not clicked. */
export const UNCLICKED = -1;

/** The seat that turns dial i. */
export function dialHolder(i: number, seats: number): number {
  return i % seats;
}

// Two-hand lock, as sim/puzzle/party_dial.go plays it: the dials click in
// pairs, each turned by its own seat, and a pair holds only when both are
// set within the window. Touching a dial outside the open pair drops them all.
export class TwoHandModel extends Untimed implements Model {
  /** Dials clicked so far. */
  k = 0;
  /** The ms each dial of the open pair was set at. */
  readonly click: [number, number] = [UNCLICKED, UNCLICKED];
  private readonly target: number[];
  private readonly turn: number[];
  private readonly n: number;

  constructor(private readonly layout: PuzzleLayout) {
    super();
    this.n = layout.size;
    this.target = layout.target ?? [];
    this.turn = layout.turn ?? [];
  }

  /** The open pair's first dial and how many dials it has. */
  pair(): { first: number; size: number } {
    const first = Math.trunc(this.k / 2) * 2;
    return { first, size: Math.min(2, this.n - first) };
  }

  apply(m: PuzzleMove): Status {
    const l = this.layout;
    if (!seated(l, m) || !within(m.a, this.n)) return BROKE;
    if (seatOf(m) !== dialHolder(m.a, l.seats ?? 0)) return GOING;
    const { first, size } = this.pair();
    if (m.a < first || m.a >= first + size) {
      this.k = 0;
      this.clear();
      return GOING;
    }
    if ((m.b ?? 0) !== this.target[m.a] || (m.c ?? 0) !== this.turn[m.a]) return GOING;
    this.click[m.a - first] = m.at;
    const set = this.click.slice(0, size);
    if (set.includes(UNCLICKED)) return GOING;
    if (Math.max(...set) - Math.min(...set) <= (l.window ?? 0)) this.k += size;
    this.clear();
    return until(this.k === this.n);
  }

  /** Whether dial a would set at number b, arrived at the way c says. */
  sets(a: number, b: number, c: number): boolean {
    const { first, size } = this.pair();
    return a >= first && a < first + size && b === this.target[a] && c === this.turn[a];
  }

  /** The ms dial a of the open pair was set at, if it was. */
  clickedAt(a: number): number | undefined {
    const { first, size } = this.pair();
    const at = a >= first && a < first + size ? this.click[a - first]! : UNCLICKED;
    return at === UNCLICKED ? undefined : at;
  }

  private clear(): void {
    this.click[0] = UNCLICKED;
    this.click[1] = UNCLICKED;
  }

  snapshot(): number[] {
    return [this.k, this.click[0], this.click[1]];
  }
}
