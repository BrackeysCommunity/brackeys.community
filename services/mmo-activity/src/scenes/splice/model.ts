import type { PuzzleLayout, PuzzleMove } from "../../api.ts";
import { Clock } from "../../shell/clock.ts";
import { BROKE, DONE, GOING, type Model, type Status } from "../../shell/kit.ts";

// A twitch is two numbers in the track: its step and the rows it shifts.
const TWITCH = 2;

/** What c says of a move: the iron is lifted, dragged into a cell, or set down on one. */
export const LIFT = 0;
export const DRAG = 1;
export const DOWN = 2;

// Splice, as sim/puzzle/splice.go plays it: the trace is soldered a
// position at a time from one edge to the other, the iron is lifted over
// its gaps, and the part not yet soldered twitches a row at a time.
export class SpliceModel implements Model {
  /** Positions soldered. */
  k = 0;
  /** Rows the loose end has shifted. */
  off = 0;
  /** The cell last soldered; -1 before the first. */
  cur = -1;
  /** Whether the iron is down. */
  on = false;
  /** The shift each position past was soldered, or skipped, at. */
  readonly shift: number[] = [];
  private next = 0;
  private readonly order: number[];
  private readonly gap: boolean[];
  private readonly track: number[];
  private readonly cols: number;
  private readonly rows: number;
  private readonly clock: Clock;

  constructor(layout: PuzzleLayout) {
    this.order = layout.order ?? [];
    this.track = layout.track ?? [];
    this.cols = layout.size;
    this.rows = layout.range ?? 0;
    this.clock = new Clock(layout.step);
    this.gap = this.order.map(() => false);
    for (const i of layout.false ?? []) this.gap[i] = true;
  }

  /** Positions along the trace. */
  get length(): number {
    return this.order.length;
  }

  /** Whether a position is a break in the trace. */
  gapAt(i: number): boolean {
    return this.gap[i] === true;
  }

  /** Where a position sits now: where it was soldered, or where the loose end has shifted it. */
  cell(i: number): number {
    return this.order[i]! + (i < this.k ? this.shift[i]! : this.off) * this.cols;
  }

  /** The next position to solder, past any gap. */
  across(): number {
    let i = this.k;
    while (i < this.gap.length && this.gap[i]) i++;
    return i;
  }

  /** The step and rows of the twitch to come, if one is left. */
  twitch(): { step: number; rows: number } | undefined {
    const i = this.next * TWITCH;
    return i < this.track.length ? { step: this.track[i]!, rows: this.track[i + 1]! } : undefined;
  }

  /** Steps run. */
  get steps(): number {
    return this.clock.n;
  }

  run(at: number): [Status, number] {
    return this.clock.run(at, (k) => this.tick(k));
  }

  private tick(k: number): void {
    const t = this.track;
    for (; this.next * TWITCH < t.length && t[this.next * TWITCH]! <= k; this.next++)
      this.off += t[this.next * TWITCH + 1]!;
  }

  private solder(i: number, cell: number): Status {
    for (let j = this.k; j <= i; j++) this.shift[j] = this.off;
    this.k = i + 1;
    this.cur = cell;
    this.on = true;
    return this.k === this.order.length ? DONE : GOING;
  }

  // Moves the iron. Set down, it solders the next position past any gap,
  // or picks up where it left off. Dragged, it solders the next position
  // only; into any other cell it bridges the board.
  apply(m: PuzzleMove): Status {
    const a = m.a;
    if (!Number.isInteger(a) || a < 0 || a >= this.cols * this.rows) return BROKE;
    switch (m.c ?? 0) {
      case LIFT:
        this.on = false;
        return GOING;
      case DOWN: {
        const i = this.across();
        if (a === this.cell(i)) return this.solder(i, a);
        if (a === this.cur) this.on = true;
        return GOING;
      }
      case DRAG:
        if (!this.on) return GOING;
        if (!this.gap[this.k] && a === this.cell(this.k)) return this.solder(this.k, a);
        return a === this.cur ? GOING : BROKE;
      default:
        return BROKE;
    }
  }

  snapshot(): number[] {
    return [this.k, this.off, this.cur, this.on ? 1 : 0];
  }
}
