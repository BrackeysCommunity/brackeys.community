import type { PuzzleLayout, PuzzleMove } from "../../api.ts";
import { CrankModel, TURN } from "../../scenes/crank/model.ts";
import { Clock } from "../../shell/clock.ts";
import { BROKE, GOING, until, within, type Model, type Status } from "../../shell/kit.ts";
import { holder, passTurn, seated } from "../seats.ts";

/** A tandem winch has two cranks. */
export const CRANKS = 2;

// Tandem winch, as sim/puzzle/party_crank.go plays it: two of Crank's
// dynamos, each dragged by its own tick, that charge only while both run
// in the band within a band's width of each other. The cranks change
// hands every pass ms.
export class WinchModel implements Model {
  readonly cranks: CrankModel[];
  /** Steps both cranks spent in the band together. */
  charge = 0;
  private readonly clock: Clock;

  constructor(private readonly layout: PuzzleLayout) {
    this.cranks = Array.from({ length: CRANKS }, () => new CrankModel(layout));
    this.clock = new Clock(layout.step);
  }

  get lo(): number {
    return this.cranks[0]!.lo;
  }

  get hi(): number {
    return this.cranks[0]!.hi;
  }

  get blow(): number {
    return this.cranks[0]!.blow;
  }

  get need(): number {
    return this.cranks[0]!.need;
  }

  /** The seat winding a crank at a ms. */
  seatAt(crank: number, at: number): number {
    return holder(crank, passTurn(this.layout, at), this.layout.seats ?? 1);
  }

  /** The ms the cranks next change hands, after at; undefined when they never do. */
  handsChange(at: number): number | undefined {
    const pass = this.layout.pass ?? 0;
    return pass > 0 ? (Math.trunc(at / pass) + 1) * pass : undefined;
  }

  /** Whether both cranks run in the band together, close enough to charge. */
  together(): boolean {
    const [a, b] = this.cranks.map((c) => c.speed) as [number, number];
    const inBand = (s: number) => s >= this.lo && s <= this.hi;
    return inBand(a) && inBand(b) && Math.abs(a - b) <= this.hi - this.lo;
  }

  run(at: number): [Status, number] {
    return this.clock.run(at, (k) => this.tick(k));
  }

  // Each crank runs its own step; the charge is the pair's.
  private tick(k: number): Status {
    const at = k * this.clock.step;
    for (const c of this.cranks) c.run(at);
    if (this.together()) this.charge++;
    return until(this.charge >= this.need);
  }

  // A quarter turn of crank b, by the seat winding it now.
  apply(m: PuzzleMove): Status {
    const b = m.b ?? 0;
    if (!seated(this.layout, m) || !within(b, CRANKS) || m.a !== TURN) return BROKE;
    if ((m.seat ?? 0) !== this.seatAt(b, m.at)) return GOING;
    return this.cranks[b]!.apply(m);
  }

  snapshot(): number[] {
    return [this.cranks[0]!.speed, this.cranks[1]!.speed, this.charge];
  }
}
