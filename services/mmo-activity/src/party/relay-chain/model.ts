import type { PuzzleLayout, PuzzleMove } from "../../api.ts";
import { BROKE, GOING, Untimed, until, within, type Model, type Status } from "../../shell/kit.ts";
import { seatOf, seated } from "../seats.ts";

/** A panel that is not locked. */
export const UNLOCKED = -1;

// Relay chain, as sim/puzzle/party_signal.go plays it: each seat tunes its
// own panel of knobs, a panel locks when all its knobs are on target, and
// the chain holds only when every panel locked within the window. A panel
// locked too long before the last is reset.
export class RelayChainModel extends Untimed implements Model {
  /** Each knob's value. */
  readonly knobs: number[];
  /** The ms each seat's panel locked at. */
  readonly lock: number[];
  /** Knobs on each panel. */
  readonly per: number;
  private readonly target: number[];

  constructor(private readonly layout: PuzzleLayout) {
    super();
    const seats = layout.seats ?? 0;
    this.target = layout.target ?? [];
    this.knobs = Array.from({ length: layout.size }, () => 0);
    this.lock = Array.from({ length: seats }, () => UNLOCKED);
    this.per = seats > 0 ? Math.trunc(layout.size / seats) : 0;
  }

  /** The seat whose panel holds knob i. */
  panelOf(i: number): number {
    return Math.trunc(i / this.per);
  }

  apply(m: PuzzleMove): Status {
    const l = this.layout;
    const b = m.b ?? 0;
    if (!seated(l, m) || !within(m.a, l.size) || !within(b, l.range ?? 0)) return BROKE;
    const s = seatOf(m);
    if (this.panelOf(m.a) !== s) return GOING;
    this.knobs[m.a] = b;
    if (!this.tuned(s)) {
      this.lock[s] = UNLOCKED;
      return GOING;
    }
    if (this.lock[s] === UNLOCKED) this.lock[s] = m.at;
    if (this.lock.includes(UNLOCKED)) return GOING;
    const last = Math.max(m.at, ...this.lock);
    let held = true;
    for (const [t, at] of this.lock.entries()) {
      if (at < last - (l.window ?? 0)) {
        held = false;
        this.reset(t);
      }
    }
    return until(held);
  }

  /** Whether every knob of seat s's panel is on its value. */
  tuned(s: number): boolean {
    for (let i = s * this.per; i < (s + 1) * this.per; i++)
      if (this.knobs[i] !== this.target[i]) return false;
    return true;
  }

  private reset(s: number): void {
    for (let i = s * this.per; i < (s + 1) * this.per; i++) this.knobs[i] = 0;
    this.lock[s] = UNLOCKED;
  }

  snapshot(): number[] {
    return [...this.knobs, ...this.lock];
  }
}
