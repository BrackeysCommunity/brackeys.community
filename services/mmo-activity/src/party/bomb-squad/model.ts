import type { PuzzleLayout, PuzzleMove } from "../../api.ts";
import fuse from "../../scenes/fuse/index.ts";
import { BROKE, GOING, within, type Model, type Status } from "../../shell/kit.ts";
import { holder, passTurn, seatOf, seated } from "../seats.ts";

/** The one role, the cutters. */
export const CUTTERS = 0;

/** The seat holding the cutters after some fuses are out. */
export function cutter(layout: PuzzleLayout, pulled: number): number {
  return holder(CUTTERS, passTurn(layout, pulled), layout.seats ?? 1);
}

// Bomb squad, as sim/puzzle/party_fuse.go plays it: one seat at a time
// holds the cutters, passing them on every few fuses, and pulls while the
// others read their clues out. No seat is dealt the order, so on screen the
// model only counts the pulls: whether one was right is the server's.
export class BombSquadModel implements Model {
  /** Fuses pulled, in the order they came out. */
  readonly out: number[] = [];
  private readonly fuse: Model | undefined;

  constructor(private readonly layout: PuzzleLayout) {
    this.fuse = layout.order ? fuse.start(layout) : undefined;
  }

  run(at: number): [Status, number] {
    return [GOING, at];
  }

  /** Fuses pulled so far. */
  get k(): number {
    return this.out.length;
  }

  /** The seat holding the cutters now. */
  cutter(): number {
    return cutter(this.layout, this.out.length);
  }

  apply(m: PuzzleMove): Status {
    if (!seated(this.layout, m) || !within(m.a, this.layout.size)) return BROKE;
    if (seatOf(m) !== this.cutter()) return GOING;
    if (!this.fuse) {
      if (!this.out.includes(m.a)) this.out.push(m.a);
      return GOING;
    }
    const st = this.fuse.apply(m);
    if (st !== BROKE) this.out.push(m.a);
    return st;
  }

  /** Whether a fuse is out. */
  pulled(f: number): boolean {
    return this.out.includes(f);
  }

  snapshot(): number[] {
    return this.fuse ? this.fuse.snapshot() : [this.out.length];
  }
}
