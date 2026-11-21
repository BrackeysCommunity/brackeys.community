import type { PuzzleLayout, PuzzleMove } from "../../api.ts";
import { BROKE, Untimed, until, within, type Model, type Status } from "../../shell/kit.ts";

// Rewire, as sim/puzzle/rewire.go plays it: wire w starts in port w and
// belongs in port target[w].
export class RewireModel extends Untimed implements Model {
  /** Each wire's port. */
  readonly at: number[];
  private readonly target: number[];

  constructor(layout: PuzzleLayout) {
    super();
    this.target = layout.target ?? [];
    this.at = Array.from({ length: layout.size }, (_, i) => i);
  }

  // Plugs wire a into port b; the wire that was there takes a's port.
  apply(m: PuzzleMove): Status {
    const n = this.at.length;
    const a = m.a;
    const b = m.b ?? 0;
    if (!within(a, n) || !within(b, n)) return BROKE;
    const from = this.at[a]!;
    for (let w = 0; w < n; w++) if (this.at[w] === b) this.at[w] = from;
    this.at[a] = b;
    return until(this.at.every((port, w) => port === this.target[w]));
  }

  /** Whether wire w sits in its own port. */
  seated(w: number): boolean {
    return this.at[w] === this.target[w];
  }

  snapshot(): number[] {
    return [...this.at];
  }
}
