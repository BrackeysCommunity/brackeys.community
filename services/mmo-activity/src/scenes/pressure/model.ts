import type { PuzzleLayout, PuzzleMove } from "../../api.ts";
import { Clock } from "../../shell/clock.ts";
import { BROKE, GOING, until, within, type Model, type Status } from "../../shell/kit.ts";

// Where each number sits in the layout's par.
const LO = 0;
const HI = 1;
const NUDGE = 2;
const COUPLE = 3;
const HOLD = 4;
const LEAK = 5;

// The leak is counted in hundredths of a unit a step.
const HUNDREDTHS = 100;

// One valve turned dir: its needle rises by nudge, its neighbours' fall by couple.
function turnValve(v: number[], a: number, dir: number, nudge: number, couple: number): void {
  v[a]! += dir * nudge;
  if (a > 0) v[a - 1]! -= dir * couple;
  if (a + 1 < v.length) v[a + 1]! -= dir * couple;
}

// Pressure, as sim/puzzle/pressure.go plays it: a valve lifts its own
// needle and drops its neighbours', one needle leaks, and the machine is
// solved once every needle has sat in the band for the hold.
export class PressureModel implements Model {
  /** Each needle, out of the layout's range. */
  readonly v: number[];
  /** Steps every needle has sat in the band. */
  held = 0;
  private acc = 0;
  private readonly par: number[];
  private readonly goal: number;
  private readonly range: number;
  private readonly clock: Clock;

  constructor(layout: PuzzleLayout) {
    this.v = [...(layout.init ?? [])];
    this.par = layout.par ?? [];
    this.goal = layout.goal;
    this.range = layout.range ?? 0;
    this.clock = new Clock(layout.step);
  }

  get lo(): number {
    return this.par[LO] ?? 0;
  }

  get hi(): number {
    return this.par[HI] ?? 0;
  }

  /** What a turn of a valve adds to its own needle. */
  get nudge(): number {
    return this.par[NUDGE] ?? 0;
  }

  /** The steps the needles must hold in the band. */
  get hold(): number {
    return this.par[HOLD] ?? 0;
  }

  /** Whether the goal needle leaks at all. */
  get leaks(): boolean {
    return (this.par[LEAK] ?? 0) > 0;
  }

  run(at: number): [Status, number] {
    return this.clock.run(at, () => this.tick());
  }

  private tick(): Status {
    this.acc += this.par[LEAK] ?? 0;
    while (this.acc >= HUNDREDTHS) {
      this.acc -= HUNDREDTHS;
      this.v[this.goal] = Math.max(0, this.v[this.goal]! - 1);
    }
    for (const x of this.v) {
      if (x < this.lo || x > this.hi) {
        this.held = 0;
        return GOING;
      }
    }
    this.held++;
    return until(this.held >= this.hold);
  }

  // Turns valve a: b is 1 to open it, -1 to close it. A needle driven off
  // the top of the gauge bursts the machine.
  apply(m: PuzzleMove): Status {
    const a = m.a;
    const b = m.b ?? 0;
    const n = this.v.length;
    if (!within(a, n) || (b !== 1 && b !== -1)) return BROKE;
    turnValve(this.v, a, b, this.nudge, this.par[COUPLE] ?? 0);
    // The needles are floored in order and the burst ends the pass, as the
    // replay does, so the two leave the same numbers behind.
    for (const [i, x] of this.v.entries()) {
      this.v[i] = Math.max(0, x);
      if (x >= this.range) return BROKE;
    }
    return GOING;
  }

  snapshot(): number[] {
    return [...this.v, this.acc, this.held];
  }
}
