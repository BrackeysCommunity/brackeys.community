import type { PuzzleLayout, PuzzleMove } from "../../api.ts";
import { Clock } from "../../shell/clock.ts";
import { BROKE, DONE, GOING, type Model, type Status } from "../../shell/kit.ts";

// Where each number sits in the layout's par.
const LO = 0;
const HI = 1;
const BLOW = 2;
const KICK = 3;
const DRAG = 4;
const SPIKE_DRAG = 5;
const NEED = 6;

// A spike is two numbers in the track: its first step and its length.
const SPIKE = 2;

/** The move a quarter turn sends. */
export const TURN = 1;
/** A hint's code for the start of a spike; it is never played. */
export const WARN = 2;

// Crank, as sim/puzzle/crank.go plays it: each quarter turn kicks the
// speed up, drag takes it down every step and harder inside a load spike,
// and the dynamo is charged after enough steps in the band.
export class CrankModel implements Model {
  speed = 0;
  /** Steps spent in the band. */
  charge = 0;
  private readonly par: number[];
  private readonly track: number[];
  private readonly clock: Clock;

  constructor(layout: PuzzleLayout) {
    this.par = layout.par ?? [];
    this.track = layout.track ?? [];
    this.clock = new Clock(layout.step);
  }

  get lo(): number {
    return this.par[LO] ?? 0;
  }

  get hi(): number {
    return this.par[HI] ?? 0;
  }

  /** The speed past which the dynamo blows. */
  get blow(): number {
    return this.par[BLOW] ?? 0;
  }

  /** The steps of charge the dynamo needs. */
  get need(): number {
    return this.par[NEED] ?? 0;
  }

  /** Whether step k falls inside a load spike. */
  spiking(k: number): boolean {
    return this.load(k) > 0;
  }

  private load(k: number): number {
    let d = 0;
    for (let i = 0; i + SPIKE <= this.track.length; i += SPIKE) {
      const start = this.track[i]!;
      if (k >= start && k < start + this.track[i + 1]!) d += this.par[SPIKE_DRAG] ?? 0;
    }
    return d;
  }

  run(at: number): [Status, number] {
    return this.clock.run(at, (k) => this.tick(k));
  }

  private tick(k: number): Status {
    this.speed = Math.max(0, this.speed - (this.par[DRAG] ?? 0) - this.load(k));
    if (this.speed >= this.lo && this.speed <= this.hi) this.charge++;
    return this.charge >= this.need ? DONE : GOING;
  }

  // One quarter turn. Wound past its limit, the dynamo blows.
  apply(m: PuzzleMove): Status {
    if (m.a !== TURN) return BROKE;
    this.speed += this.par[KICK] ?? 0;
    return this.speed > this.blow ? BROKE : GOING;
  }

  snapshot(): number[] {
    return [this.speed, this.charge];
  }
}
