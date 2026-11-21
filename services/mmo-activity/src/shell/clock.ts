import { GOING, type Status } from "./kit.ts";

/**
 * The step clock a timed family's model runs on: sim/puzzle's clock,
 * mirrored. Step k happens at k times the step, and a move applies after
 * every step up to its stamp.
 */
export class Clock {
  /** Steps run. */
  n = 0;
  /** Ms a step. */
  readonly step: number;

  constructor(step: number | undefined) {
    this.step = Math.max(step ?? 0, 1);
  }

  /** Takes the model to at ms, one tick a step, and stops at the first step that solves or breaks it. */
  run(at: number, tick: (k: number) => Status | void): [Status, number] {
    for (const due = Math.trunc(at / this.step); this.n < due; ) {
      this.n++;
      const st = tick(this.n) ?? GOING;
      if (st !== GOING) return [st, this.n * this.step];
    }
    return [GOING, at];
  }
}
