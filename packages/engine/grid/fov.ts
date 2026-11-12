/**
 * Field of view on a grid. Squares use symmetric shadowcasting (a floor cell
 * sees another exactly when that one sees it back; walls are revealed but
 * hide what lies behind them). Hexes test a `line` to each cell. Integer
 * arithmetic only, so every platform agrees.
 */
import { cellKey, type Cell, type CellKey, type GridGeometry } from "./geometry";

type Row = { depth: number; sn: number; sd: number; en: number; ed: number };

/** North, east, south, west: a quadrant's (depth, col) to a cell. */
const QUADRANTS: readonly ((o: Cell, depth: number, col: number) => Cell)[] = [
  ([x, y], d, c) => [x + c, y - d],
  ([x, y], d, c) => [x + d, y + c],
  ([x, y], d, c) => [x + c, y + d],
  ([x, y], d, c) => [x - d, y + c],
];

const abs = (n: number) => (n < 0 ? 0 - n : n);

/** ⌊x / d⌋ exactly, for integers below 2^53 and `d` > 0. */
function floorDiv(x: number, d: number): number {
  let m = Math.floor(x / d);
  while (m * d > x) m--;
  while ((m + 1) * d <= x) m++;
  return m;
}

function checkRadius(radius: number): number {
  if (!Number.isFinite(radius) || radius < 0)
    throw new RangeError(`fieldOfView: radius must be finite and ≥ 0, got ${radius}`);
  return Math.floor(radius);
}

/** One quadrant of symmetric shadowcasting, out to `radius` rows. */
function castQuadrant(
  origin: Cell,
  toCell: (o: Cell, depth: number, col: number) => Cell,
  radius: number,
  opaque: (c: Cell) => boolean,
  reveal: (c: Cell) => void,
): void {
  const stack: Row[] = [{ depth: 1, sn: -1, sd: 1, en: 1, ed: 1 }];
  for (let row = stack.pop(); row; row = stack.pop()) {
    const { depth } = row;
    if (depth > radius) continue;
    // Columns whose centres the wedge reaches, a tie at either edge rounded inward.
    const min = floorDiv(2 * depth * row.sn + row.sd, 2 * row.sd);
    const max = 0 - floorDiv(row.ed - 2 * depth * row.en, 2 * row.ed);
    let prev: "none" | "wall" | "floor" = "none";
    for (let col = min; col <= max; col++) {
      const c = toCell(origin, depth, col);
      const wall = opaque(c);
      const centred = col * row.sd >= depth * row.sn && col * row.ed <= depth * row.en;
      if (wall || centred) reveal(c);
      if (prev === "wall" && !wall) {
        row.sn = 2 * col - 1;
        row.sd = 2 * depth;
      }
      if (prev === "floor" && wall)
        stack.push({ depth: depth + 1, sn: row.sn, sd: row.sd, en: 2 * col - 1, ed: 2 * depth });
      prev = wall ? "wall" : "floor";
    }
    if (prev === "floor")
      stack.push({ depth: depth + 1, sn: row.sn, sd: row.sd, en: row.en, ed: row.ed });
  }
}

/** Whether no cell strictly between `a` and `b` on the hex line is opaque. */
function hexClear(grid: GridGeometry, a: Cell, b: Cell, opaque: (c: Cell) => boolean): boolean {
  const cells = grid.line(a, b);
  for (let i = 1; i < cells.length - 1; i++) if (opaque(cells[i]!)) return false;
  return true;
}

/**
 * Visible cells within `radius` steps (Chebyshev on squares, hex distance on
 * hexes), the origin included whatever it is: symmetric shadowcasting on
 * squares, a line to each cell on hexes. Opaque cells in view are visible;
 * the cells they hide are not.
 */
export function fieldOfView(
  grid: GridGeometry,
  origin: Cell,
  radius: number,
  opaque: (c: Cell) => boolean,
): Set<CellKey> {
  const r = checkRadius(radius);
  const seen = new Set<CellKey>([cellKey(origin)]);
  if (grid.settings.kind === "square") {
    const reveal = (c: Cell) => void seen.add(cellKey(c));
    for (const toCell of QUADRANTS) castQuadrant(origin, toCell, r, opaque, reveal);
    return seen;
  }
  // Breadth-first out to the radius in neighbour order, testing a line to each cell found.
  const reached = new Set<CellKey>(seen);
  let ring: Cell[] = [origin];
  for (let d = 1; d <= r; d++) {
    const next: Cell[] = [];
    for (const c of ring)
      for (const n of grid.neighbors(c)) {
        const k = cellKey(n);
        if (reached.has(k) || grid.distance(origin, n) !== d) continue;
        reached.add(k);
        next.push(n);
        if (hexClear(grid, origin, n, opaque)) seen.add(k);
      }
    ring = next;
  }
  return seen;
}

/**
 * Whether `b` is in `a`'s field of view at any radius: the same answer
 * `fieldOfView` gives, and symmetric between two cells that aren't opaque.
 */
export function lineOfSight(
  grid: GridGeometry,
  a: Cell,
  b: Cell,
  opaque: (c: Cell) => boolean,
): boolean {
  if (grid.settings.kind !== "square") return hexClear(grid, a, b, opaque);
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return true;
  const depth = abs(dx) > abs(dy) ? abs(dx) : abs(dy);
  // Only the quadrants that hold `b` (two when it lies on a diagonal), out to its row.
  const holds = [
    dy < 0 && abs(dx) <= -dy,
    dx > 0 && abs(dy) <= dx,
    dy > 0 && abs(dx) <= dy,
    dx < 0 && abs(dy) <= -dx,
  ];
  let found = false;
  const reveal = (c: Cell) => {
    if (c[0] === b[0] && c[1] === b[1]) found = true;
  };
  for (let q = 0; q < QUADRANTS.length && !found; q++)
    if (holds[q]) castQuadrant(a, QUADRANTS[q]!, depth, opaque, reveal);
  return found;
}
