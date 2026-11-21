import type { PuzzleLayout, PuzzleMove } from "../../api.ts";
import { ScrubModel } from "../../scenes/scrub/model.ts";
import { BROKE, GOING, until, within, type Status } from "../../shell/kit.ts";
import { seated } from "../seats.ts";

/** The panel a cell is in, and the seat it is: bands of rows. */
export function panelOf(cell: number, side: number, seats: number): number {
  return Math.trunc((Math.trunc(cell / side) * seats) / side);
}

// Panel array, as sim/puzzle/party_scrub.go plays it: Scrub's plate cut
// into bands of rows, one a seat. Every pass-th rub on a panel blows a
// layer of grit onto the first clean cell of the next panel's reading.
export class PanelModel extends ScrubModel {
  /** Rubs on each panel. */
  readonly rubs: number[];
  /** The cell grit last arrived on in each panel, and the ms; cell -1 for none yet. */
  readonly blown: { cell: number; at: number }[];

  constructor(private readonly layout: PuzzleLayout) {
    super(layout);
    this.rubs = Array.from({ length: layout.seats ?? 0 }, () => 0);
    this.blown = this.rubs.map(() => ({ cell: -1, at: 0 }));
  }

  /** The panel, and the seat, a cell is in. */
  panel(cell: number): number {
    return panelOf(cell, this.layout.size, this.layout.seats ?? 1);
  }

  /** Rubs a panel has left before it blows grit next door; 0 when it never does. */
  untilBlow(panel: number): number {
    const pass = this.layout.pass ?? 0;
    return pass > 0 ? pass - (this.rubs[panel]! % pass) : 0;
  }

  override apply(m: PuzzleMove): Status {
    const l = this.layout;
    if (!seated(l, m) || !within(m.a, this.grit.length)) return BROKE;
    const panel = this.panel(m.a);
    if ((m.seat ?? 0) !== panel) return GOING;
    if (super.apply(m) === BROKE) return BROKE;
    this.rubs[panel]!++;
    const pass = l.pass ?? 0;
    const seats = l.seats ?? 1;
    if (pass > 0 && this.rubs[panel]! % pass === 0) {
      const next = (panel + 1) % seats;
      const init = l.init ?? [];
      for (const c of this.cells) {
        if (this.panel(c) === next && this.grit[c] === 0) {
          this.grit[c] = Math.min(init[c]!, this.grit[c]! + 1);
          this.blown[next] = { cell: c, at: m.at };
          break;
        }
      }
    }
    return until(!this.cells.some((c) => this.grit[c]! > 0));
  }

  override snapshot(): number[] {
    return [...this.grit, ...this.rubs];
  }
}
