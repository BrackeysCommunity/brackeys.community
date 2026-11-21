import type { PuzzleLayout, PuzzleMove } from "../../api.ts";
import { gridOf, type Grid } from "../../shell/grid.ts";
import { BROKE, Untimed, until, within, type Model, type Status } from "../../shell/kit.ts";

// The tumbler maze, as sim/puzzle/maze.go plays it: each tilt rolls the
// bit one cell unless a wall stops it. Shape 1 is a hex maze, six tilts.
export class MazeModel extends Untimed implements Model {
  /** Where the bit is. */
  cell: number;
  readonly grid: Grid;
  private readonly walls: number[];

  constructor(private readonly layout: PuzzleLayout) {
    super();
    this.walls = layout.walls ?? [];
    this.cell = layout.start;
    this.grid = gridOf(layout.shape);
  }

  apply(m: PuzzleMove): Status {
    if (!within(m.a, this.grid.sides)) return BROKE;
    if (this.open(this.cell, m.a))
      this.cell = this.grid.step(this.cell, m.a, this.layout.size) ?? 0;
    return until(this.cell === this.layout.goal);
  }

  /** Whether a cell's side has no wall. */
  open(cell: number, tilt: number): boolean {
    return ((this.walls[cell] ?? 0) & (1 << tilt)) === 0;
  }

  snapshot(): number[] {
    return [this.cell];
  }
}
