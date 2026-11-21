import type { PuzzleLayout, PuzzleMove } from "../../api.ts";
import { Clock } from "../../shell/clock.ts";
import { BROKE, GOING, until, within, type Model, type Status } from "../../shell/kit.ts";
import { seated } from "../seats.ts";

// Where each number sits in the layout's par, as in the family's model.
const GAUGE = 0;
const DRAIN = 1;
const MISS = 2;

// A leak is four numbers in the track: its step, slot, taps and the steps
// a clamp holds.
const AT = 0;
const SLOT = 1;
const TAPS = 2;
const HOLD = 3;
const ROW = 4;

/** The run a slot is on, and the seat that holds it. */
export function runOf(slot: number, seats: number): number {
  return slot % Math.max(1, seats);
}

// Pipe crew, as sim/puzzle/party_leak.go plays it: Leak with the pipe cut
// into runs, one a seat, each with its own gauge. An open slot drains its
// own run's gauge, and any run running dry breaks the whole machine.
export class PipeModel implements Model {
  /** Each run's gauge. */
  readonly g: number[];
  /** Leaks sprung so far. */
  next = 0;
  /** Taps each slot still needs; 0 is dry. */
  readonly left: number[];
  /** The step a slot's clamp slips at; 0 is not clamped. */
  readonly until: number[];
  private readonly hold: number[];
  private readonly par: number[];
  private readonly track: number[];
  private readonly size: number;
  private readonly seats: number;
  private readonly clock: Clock;

  constructor(private readonly layout: PuzzleLayout) {
    this.par = layout.par ?? [];
    this.track = layout.track ?? [];
    this.size = layout.size;
    this.seats = layout.seats ?? 0;
    this.clock = new Clock(layout.step);
    this.g = Array.from({ length: this.seats }, () => this.par[GAUGE] ?? 0);
    this.left = Array.from({ length: this.size }, () => 0);
    this.until = Array.from({ length: this.size }, () => 0);
    this.hold = Array.from({ length: this.size }, () => 0);
  }

  /** A run's gauge when full. */
  get full(): number {
    return this.par[GAUGE] ?? 0;
  }

  /** The lowest run's gauge: the one that breaks the machine first. */
  get gauge(): number {
    return Math.min(...this.g);
  }

  /** Leaks in the whole run of the machine. */
  get leaks(): number {
    return Math.trunc(this.track.length / ROW);
  }

  /** Whether a slot is leaking and not clamped. */
  open(slot: number): boolean {
    return this.left[slot]! > 0 && this.until[slot] === 0;
  }

  /** Whether a slot has leaked and been tapped shut. */
  sealed(slot: number): boolean {
    if (this.left[slot] !== 0) return false;
    for (let i = 0; i < this.next; i++) if (this.track[i * ROW + SLOT] === slot) return true;
    return false;
  }

  /** The steps a slot's clamp holds, once it has leaked. */
  holds(slot: number): number {
    return this.hold[slot]!;
  }

  /** Steps run. */
  get n(): number {
    return this.clock.n;
  }

  run(at: number): [Status, number] {
    return this.clock.run(at, (k) => this.tick(k));
  }

  private tick(k: number): Status {
    const t = this.track;
    for (; this.next * ROW < t.length && t[this.next * ROW + AT]! <= k; this.next++) {
      const row = this.next * ROW;
      const slot = t[row + SLOT]!;
      this.left[slot] = t[row + TAPS]!;
      this.hold[slot] = t[row + HOLD]!;
      this.until[slot] = 0;
    }
    let wet = 0;
    for (let s = 0; s < this.size; s++) {
      if (this.until[s]! > 0 && this.until[s]! <= k) this.until[s] = 0;
      if (this.left[s]! > 0) wet++;
      if (this.open(s)) this.g[runOf(s, this.seats)]! -= this.par[DRAIN] ?? 0;
    }
    if (this.g.some((x) => x <= 0)) return BROKE;
    return until(this.next * ROW >= t.length && wet === 0);
  }

  // Taps slot a, charged to its run's gauge. A tap on another seat's run
  // is ignored.
  apply(m: PuzzleMove): Status {
    const a = m.a;
    if (!seated(this.layout, m) || !within(a, this.size)) return BROKE;
    const r = runOf(a, this.seats);
    if ((m.seat ?? 0) !== r) return GOING;
    if (!this.open(a)) {
      this.g[r]! -= this.par[MISS] ?? 0;
      return GOING;
    }
    this.left[a]!--;
    if (this.left[a]! > 0) this.until[a] = this.n + this.hold[a]!;
    return GOING;
  }

  snapshot(): number[] {
    return [...this.g, this.next, ...this.left, ...this.until];
  }
}
