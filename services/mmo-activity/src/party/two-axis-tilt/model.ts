import type { PuzzleLayout, PuzzleMove } from "../../api.ts";
import lockMaze from "../../scenes/lock-maze/index.ts";
import { BROKE, GOING, within, type Model, type Status } from "../../shell/kit.ts";
import { holder, passTurn, seatOf, seated } from "../seats.ts";

/** A hex maze is shape 1; it tilts along three axes, a square one along two. */
export const HEX = 1;

/** The axes a maze tilts along; each is a side and its opposite. */
export function axes(layout: PuzzleLayout): number {
  return layout.shape === HEX ? 3 : 2;
}

// Two-axis tilt, as sim/puzzle/party_maze.go plays it: each seat tilts the
// maze only along the axis it holds, and the axes pass round the seats
// every few cells the bit rolls. The tilt itself is the family's.
export class TwoAxisModel implements Model {
  /** Tilts that moved the bit. */
  rolls = 0;
  /** The family's maze, which the tilts go through. */
  readonly maze: Model;

  constructor(private readonly layout: PuzzleLayout) {
    this.maze = lockMaze.start(layout);
  }

  run(at: number): [Status, number] {
    return [GOING, at];
  }

  /** The seat tilting toward side now. */
  tilter(side: number): number {
    return holder(
      side % axes(this.layout),
      passTurn(this.layout, this.rolls),
      this.layout.seats ?? 1,
    );
  }

  /** The axes seat s holds now: none when there are more seats than axes and it waits a turn. */
  axesOf(s: number): number[] {
    return Array.from({ length: axes(this.layout) }, (_, a) => a).filter(
      (a) => this.tilter(a) === s,
    );
  }

  /** Where the bit is. */
  cell(): number {
    return this.maze.snapshot()[0]!;
  }

  apply(m: PuzzleMove): Status {
    if (!seated(this.layout, m) || !within(m.a, axes(this.layout) * 2)) return BROKE;
    if (seatOf(m) !== this.tilter(m.a)) return GOING;
    const from = this.cell();
    const st = this.maze.apply(m);
    if (this.cell() !== from) this.rolls++;
    return st;
  }

  snapshot(): number[] {
    return [...this.maze.snapshot(), this.rolls];
  }
}
