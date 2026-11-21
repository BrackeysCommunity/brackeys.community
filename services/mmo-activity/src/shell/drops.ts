/** A touch that missed or barely landed, as a scene reports it. */
export interface Drop {
  missPx: number;
  hitPx: number;
  landed: boolean;
  pointer: string;
}

// How often, at most, a play's missed touches are reported while it runs.
const DROPS_EVERY = 5000;

/**
 * The missed touches of one play, summed between reports, so a tap is
 * never a request of its own.
 */
export class Drops {
  private n = 0;
  private landed = 0;
  private sumPx = 0;
  private worstPx = 0;
  private hitPx = 0;
  private pointer = "";
  private at = 0; // the device's clock at the last report

  constructor(
    private readonly wall: () => number,
    private readonly beacon: (event: string, data: Record<string, string | number>) => void,
  ) {}

  /** The play begins: the first report is a while from now. */
  begin(): void {
    this.at = this.wall();
  }

  add(d: Drop): void {
    this.n++;
    if (d.landed) this.landed++;
    this.sumPx += d.missPx;
    this.worstPx = Math.max(this.worstPx, d.missPx);
    this.hitPx = d.hitPx;
    this.pointer = d.pointer;
  }

  /** Reports the drops so far once a while has passed since the last. */
  tick(family: string): void {
    if (this.n && this.wall() - this.at >= DROPS_EVERY) this.report(family);
  }

  report(family: string): void {
    this.at = this.wall();
    if (!this.n) return;
    this.beacon("drop", {
      family,
      touches: this.n,
      landed: this.landed,
      missPx: Math.round(this.sumPx / this.n),
      worstPx: Math.round(this.worstPx),
      hitPx: Math.round(this.hitPx),
      pointer: this.pointer,
    });
    this.n = this.landed = this.sumPx = this.worstPx = this.hitPx = 0;
    this.pointer = "";
  }
}
