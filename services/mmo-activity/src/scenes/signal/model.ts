import type { PuzzleLayout, PuzzleMove } from "../../api.ts";
import { BROKE, Untimed, until, within, type Model, type Status } from "../../shell/kit.ts";

// Signal, as sim/puzzle/signal.go plays it: every knob starts at 0 and a
// move sets one outright.
export class SignalModel extends Untimed implements Model {
  /** Each knob's value. */
  readonly knobs: number[];
  private readonly target: number[];

  constructor(private readonly layout: PuzzleLayout) {
    super();
    this.target = layout.target ?? [];
    this.knobs = Array.from({ length: layout.size }, () => 0);
  }

  apply(m: PuzzleMove): Status {
    const b = m.b ?? 0;
    if (!within(m.a, this.layout.size)) return BROKE;
    if (!within(b, this.layout.range ?? 0)) return BROKE;
    this.knobs[m.a] = b;
    return until(this.matched());
  }

  /** Whether every knob sits on its value. */
  matched(): boolean {
    return this.knobs.every((v, i) => v === this.target[i]);
  }

  snapshot(): number[] {
    return [...this.knobs];
  }
}
