import type { PuzzleLayout, PuzzleMove } from "../../api.ts";
import { BROKE, DONE, GOING, type Model, type Status } from "../../shell/kit.ts";

/** The four tilts, in the order a move names them: east, south, west, north. */
export const TILTS = 4;

/** The cell one side over in an n by n grid, or nothing at the edge. */
export function step(cell: number, tilt: number, n: number): number | undefined {
  const x = (cell % n) + [1, 0, -1, 0][tilt]!;
  const y = Math.trunc(cell / n) + [0, 1, 0, -1][tilt]!;
  return x < 0 || y < 0 || x >= n || y >= n ? undefined : y * n + x;
}

// The tumbler maze, as sim/puzzle/maze.go plays it: each tilt rolls the
// bit one cell unless a wall stops it.
export class MazeModel implements Model {
  /** Where the bit is. */
  cell: number;
  private readonly walls: number[];

  constructor(private readonly layout: PuzzleLayout) {
    this.walls = layout.walls ?? [];
    this.cell = layout.start;
  }

  run(at: number): [Status, number] {
    return [GOING, at];
  }

  apply(m: PuzzleMove): Status {
    if (!(m.a >= 0 && m.a < TILTS)) return BROKE;
    if (this.open(this.cell, m.a)) this.cell = step(this.cell, m.a, this.layout.size) ?? 0;
    return this.cell === this.layout.goal ? DONE : GOING;
  }

  /** Whether a cell's side has no wall. */
  open(cell: number, tilt: number): boolean {
    return ((this.walls[cell] ?? 0) & (1 << tilt)) === 0;
  }

  snapshot(): number[] {
    return [this.cell];
  }
}
