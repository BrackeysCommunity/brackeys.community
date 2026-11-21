/**
 * A square grid's four sides, in the order a layout numbers them: east,
 * south, west, north. sim/puzzle's grid helpers, mirrored.
 */
export const SIDES = 4;

const ALL = (1 << SIDES) - 1;

/** A set of sides, as bits (east 1, south 2, west 4, north 8), turned clockwise by quarter turns. */
export function rotate(mask: number, turns: number): number {
  for (let i = turns % SIDES; i > 0; i--) mask = ((mask << 1) | (mask >> (SIDES - 1))) & ALL;
  return mask;
}

/** The cell one side over in an n by n grid, or nothing at the edge. */
export function step(cell: number, side: number, n: number): number | undefined {
  const x = (cell % n) + [1, 0, -1, 0][side]!;
  const y = Math.trunc(cell / n) + [0, 1, 0, -1][side]!;
  return x < 0 || y < 0 || x >= n || y >= n ? undefined : y * n + x;
}
