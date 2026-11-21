import type { PuzzleLayout, PuzzleMove } from "../../api.ts";
import { Clock } from "../../shell/clock.ts";
import { BROKE, DONE, GOING, within, type Model, type Status } from "../../shell/kit.ts";

// A patch of grit creeping back is two numbers in the track: its step and
// its cell.
const PATCH = 2;

/** Under this many layers a cell shows what it is. */
export const HIDDEN = 2;

// Scrub, as sim/puzzle/scrub.go plays it: a rub takes a layer of grit off
// a cell, a cracked cell rubbed down to its last layer breaks, grit creeps
// back onto the reading on a schedule, and the machine is solved when the
// whole reading is clean.
export class ScrubModel implements Model {
  /** Layers of grit on each cell. */
  readonly grit: number[];
  private next = 0;
  private readonly init: number[];
  private readonly cracked: boolean[];
  private readonly reading: boolean[];
  private readonly target: number[];
  private readonly track: number[];
  private readonly clock: Clock;

  constructor(layout: PuzzleLayout) {
    this.init = layout.init ?? [];
    this.grit = [...this.init];
    this.target = layout.target ?? [];
    this.track = layout.track ?? [];
    this.clock = new Clock(layout.step);
    this.cracked = this.init.map(() => false);
    for (const c of layout.false ?? []) this.cracked[c] = true;
    this.reading = this.init.map(() => false);
    for (const c of this.target) this.reading[c] = true;
  }

  /** What a cell is, once it shows: part of the reading, cracked, or nothing. */
  kind(cell: number): "reading" | "crack" | "blank" {
    if (this.cracked[cell]) return "crack";
    return this.reading[cell] ? "reading" : "blank";
  }

  /** The reading's cells, in order. */
  get cells(): number[] {
    return this.target;
  }

  run(at: number): [Status, number] {
    return this.clock.run(at, (k) => this.tick(k));
  }

  private tick(k: number): void {
    const t = this.track;
    for (; this.next * PATCH < t.length && t[this.next * PATCH]! <= k; this.next++) {
      const c = t[this.next * PATCH + 1]!;
      this.grit[c] = Math.min(this.init[c]!, this.grit[c]! + 1);
    }
  }

  // Rubs cell a once.
  apply(m: PuzzleMove): Status {
    const a = m.a;
    if (!within(a, this.grit.length)) return BROKE;
    if (this.cracked[a] && this.grit[a]! <= 1) return BROKE;
    this.grit[a] = Math.max(0, this.grit[a]! - 1);
    return this.target.some((c) => this.grit[c]! > 0) ? GOING : DONE;
  }

  snapshot(): number[] {
    return [...this.grit];
  }
}
