/**
 * Grid maths in world space, laid out as Tiled lays out orthogonal and
 * staggered-hex maps. Hex cells are Tiled's offset coordinates, converted to
 * axial (cube) coordinates for neighbours, distances and lines. Only
 * + − × ÷ and exact quarter turns, so every platform agrees.
 */
import { aabb, turnBy } from "../scene/shape-geometry";
import type { Bounds, GridSettings, Pt, ShapeObj } from "../scene/types";

export type Cell = readonly [col: number, row: number];
/** Packed (col + 2^20) · 2^21 + (row + 2^20); cells must lie in [−2^20, 2^20). */
export type CellKey = number;
/** An inclusive range of cells. */
export type CellBounds = { c0: number; r0: number; c1: number; r1: number };

const HALF_RANGE = 2 ** 20;
const ROW_SPAN = 2 ** 21;

const inRange = (n: number) => Number.isInteger(n) && n >= -HALF_RANGE && n < HALF_RANGE;

export function cellKey(c: Cell): CellKey {
  const [col, row] = c;
  if (!inRange(col) || !inRange(row))
    throw new RangeError(`cell [${col}, ${row}] is outside [−2^20, 2^20) or not whole`);
  return (col + HALF_RANGE) * ROW_SPAN + (row + HALF_RANGE);
}

export function cellOf(k: CellKey): Cell {
  const hi = Math.floor(k / ROW_SPAN);
  return [hi - HALF_RANGE, k - hi * ROW_SPAN - HALF_RANGE];
}

export interface GridGeometry {
  readonly settings: GridSettings;
  /** Fixed order: square N, E, S, W, then NE, SE, SW, NW with diagonals; hex the six edges clockwise from the top (or top-right). */
  neighbors(c: Cell, diagonals?: boolean): Cell[];
  /** 10 for an edge neighbour, 14 for a diagonal. */
  stepCost(a: Cell, b: Cell): number;
  /** Admissible: octile (10/14) on squares, 10 × hex distance on hexes. */
  heuristic(a: Cell, b: Cell): number;
  /** Steps between cells (Chebyshev with diagonals, else Manhattan; hex distance). */
  distance(a: Cell, b: Cell, diagonals?: boolean): number;
  /** World px, as Tiled places cells (origin, cell size, hex side and stagger). */
  center(c: Cell): Pt;
  /** The cell whose centre is nearest, as Tiled picks it; a point on a square's edge goes to the higher cell. */
  cellAt(p: Pt): Cell;
  /** Clockwise on screen: a square from its top-left, a hex from its top (or left) vertex. */
  corners(c: Cell): Pt[];
  /**
   * Every cell a segment between centres passes through, both ends included:
   * supercover on squares (a segment through a corner takes both cells beside
   * it), cube lerp on hexes. Ties go the same way from either end, so
   * `line(b, a)` is `line(a, b)` reversed.
   */
  line(a: Cell, b: Cell): Cell[];
  /** Cells whose centre a shape contains (rasterising solids), row by row. */
  cellsIn(shape: ShapeObj): Cell[];
  /** The cells a world rectangle covers. */
  rect(bounds: Bounds): CellBounds;
}

const SQUARE_EDGES: readonly Cell[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];
const SQUARE_DIAGONALS: readonly Cell[] = [
  [1, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
];
/** Axial steps clockwise from the top-right edge, for rows staggered (pointy top). */
const AXIAL_STAGGER_Y: readonly Cell[] = [
  [1, -1],
  [1, 0],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [0, -1],
];
/** Axial steps clockwise from the top edge, for columns staggered (flat top). */
const AXIAL_STAGGER_X: readonly Cell[] = [
  [0, -1],
  [1, -1],
  [1, 0],
  [0, 1],
  [-1, 1],
  [-1, 0],
];

const DEG = Math.PI / 180;
const abs = (n: number) => (n < 0 ? 0 - n : n);
const sign = (n: number) => (n > 0 ? 1 : n < 0 ? -1 : 0);

/** The integer nearest `x / d` (`d` > 0), exactly, for integers below 2^53 whose quotient is never a half. */
function roundDiv(x: number, d: number): number {
  let m = Math.floor(x / d);
  while (m * d > x) m--;
  while ((m + 1) * d <= x) m++;
  return 2 * (x - m * d) > d ? m + 1 : m;
}

/** Squared distance from `p` to the segment `a`→`b`. */
function segmentDist2([px, py]: Pt, [ax, ay]: Pt, [bx, by]: Pt): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = px - (ax + t * dx);
  const ey = py - (ay + t * dy);
  return ex * ex + ey * ey;
}

function insidePolygon([px, py]: Pt, pts: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]!;
    const [xj, yj] = pts[j]!;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Whether `p` lies in `s`, edges included; a chain has no inside, only its own segments. */
function containsCentre(s: ShapeObj, p: Pt): boolean {
  switch (s.type) {
    case "box": {
      const [lx, ly] = turnBy([p[0] - s.cx, p[1] - s.cy], (0 - s.rotDeg) * DEG);
      return abs(lx) <= s.hw && abs(ly) <= s.hh;
    }
    case "circle": {
      const dx = p[0] - s.cx;
      const dy = p[1] - s.cy;
      return dx * dx + dy * dy <= s.r * s.r;
    }
    case "capsule": {
      const [dx, dy] = turnBy([0, s.halfLen], s.rotDeg * DEG);
      return segmentDist2(p, [s.cx - dx, s.cy - dy], [s.cx + dx, s.cy + dy]) <= s.r * s.r;
    }
    case "poly":
      return insidePolygon(p, s.pts);
    case "chain":
      return s.pts.slice(1).some((b, i) => segmentDist2(p, s.pts[i]!, b) === 0);
  }
}

/** A cell with `-0` folded to `0`. */
const cell = (col: number, row: number): Cell => [col + 0, row + 0];

export function gridGeometry(settings: GridSettings): GridGeometry {
  const [w, h] = settings.cell;
  const [ox, oy] = settings.origin ?? [0, 0];
  const square = settings.kind === "square";
  const side = settings.kind === "hex" ? settings.side : 0;
  const staggerX = settings.kind === "hex" && settings.stagger === "x";
  const odd = settings.kind === "hex" && settings.index === "odd";
  /** Whether a row (stagger y) or column (stagger x) of this index is pushed half a cell along. */
  const shifted = (n: number) => ((n & 1) === 1) === odd;
  /** The distance between two rows (stagger y) or columns (stagger x) of hexes. */
  const pitch = staggerX ? (w + side) / 2 : (h + side) / 2;

  const toAxial = ([col, row]: Cell): Cell => {
    if (staggerX) return [col, row - (odd ? col - (col & 1) : col + (col & 1)) / 2];
    return [col - (odd ? row - (row & 1) : row + (row & 1)) / 2, row];
  };
  const fromAxial = (q: number, r: number): Cell => {
    if (staggerX) return cell(q, r + (odd ? q - (q & 1) : q + (q & 1)) / 2);
    return cell(q + (odd ? r - (r & 1) : r + (r & 1)) / 2, r);
  };
  const hexDistance = (a: Cell, b: Cell): number => {
    const [aq, ar] = toAxial(a);
    const [bq, br] = toAxial(b);
    const dq = bq - aq;
    const dr = br - ar;
    return (abs(dq) + abs(dr) + abs(dq + dr)) / 2;
  };

  /** Top-left of the cell's bounding box, as Tiled's renderers place a tile. */
  const topLeft = ([col, row]: Cell): Pt => {
    if (square) return [ox + col * w, oy + row * h];
    if (staggerX) return [ox + col * pitch, oy + row * h + (shifted(col) ? h / 2 : 0)];
    return [ox + col * w + (shifted(row) ? w / 2 : 0), oy + row * pitch];
  };
  const center = (c: Cell): Pt => {
    const [x, y] = topLeft(c);
    return [x + w / 2, y + h / 2];
  };

  function cellAt([px, py]: Pt): Cell {
    if (square) return cell(Math.floor((px - ox) / w), Math.floor((py - oy) / h));
    // The nearest centre among the cells around the estimate, as Tiled's hexagonal renderer picks.
    const across = staggerX ? Math.floor((px - ox) / pitch) : Math.floor((py - oy) / pitch);
    let best: Cell = cell(0, 0);
    let bestD = Infinity;
    for (let a = across - 1; a <= across + 1; a++) {
      const along = staggerX
        ? Math.floor((py - oy - (shifted(a) ? h / 2 : 0)) / h)
        : Math.floor((px - ox - (shifted(a) ? w / 2 : 0)) / w);
      for (let b = along - 1; b <= along + 1; b++) {
        const c = staggerX ? cell(a, b) : cell(b, a);
        const [cx, cy] = center(c);
        const d = (px - cx) * (px - cx) + (py - cy) * (py - cy);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
    }
    return best;
  }

  function corners(c: Cell): Pt[] {
    const [x, y] = topLeft(c);
    if (square)
      return [
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h],
      ];
    if (staggerX) {
      const t = (w - side) / 2;
      return [
        [x, y + h / 2],
        [x + t, y],
        [x + t + side, y],
        [x + w, y + h / 2],
        [x + t + side, y + h],
        [x + t, y + h],
      ];
    }
    const t = (h - side) / 2;
    return [
      [x + w / 2, y],
      [x + w, y + t],
      [x + w, y + t + side],
      [x + w / 2, y + h],
      [x, y + t + side],
      [x, y + t],
    ];
  }

  function squareLine(a: Cell, b: Cell): Cell[] {
    const nx = abs(b[0] - a[0]);
    const ny = abs(b[1] - a[1]);
    const sx = sign(b[0] - a[0]);
    const sy = sign(b[1] - a[1]);
    let [x, y] = cell(a[0], a[1]);
    const out: Cell[] = [cell(x, y)];
    for (let ix = 0, iy = 0; ix < nx || iy < ny; ) {
      // Which cell edge the segment crosses next: compare (½ + ix) / nx with (½ + iy) / ny.
      const next = (1 + 2 * ix) * ny - (1 + 2 * iy) * nx;
      if (next === 0) {
        out.push(cell(x + sx, y), cell(x, y + sy));
        x += sx;
        y += sy;
        ix++;
        iy++;
      } else if (next < 0) {
        x += sx;
        ix++;
      } else {
        y += sy;
        iy++;
      }
      out.push(cell(x, y));
    }
    return out;
  }

  function hexLine(a: Cell, b: Cell): Cell[] {
    const n = hexDistance(a, b);
    if (n === 0) return [cell(a[0], a[1])];
    const [aq, ar] = toAxial(a);
    const [bq, br] = toAxial(b);
    const as = 0 - aq - ar;
    const bs = 0 - bq - br;
    // Exact rational lerp, scaled by 8 and nudged by (1, 2, −3): the nudge sums to zero, is
    // smaller than any real gap, and leaves no rounding tie, the same from either end.
    const d = 8 * n;
    const out: Cell[] = [];
    for (let i = 0; i <= n; i++) {
      const xq = 8 * (aq * (n - i) + bq * i) + 1;
      const xr = 8 * (ar * (n - i) + br * i) + 2;
      const xs = 8 * (as * (n - i) + bs * i) - 3;
      let q = roundDiv(xq, d);
      let r = roundDiv(xr, d);
      const s = roundDiv(xs, d);
      const dq = abs(q * d - xq);
      const dr = abs(r * d - xr);
      const ds = abs(s * d - xs);
      if (dq > dr && dq > ds) q = 0 - r - s;
      else if (dr > ds) r = 0 - q - s;
      out.push(fromAxial(q, r));
    }
    return out;
  }

  function rect([minX, minY, maxX, maxY]: Bounds): CellBounds {
    const lo = (v: number, size: number, o: number) => Math.floor((v - o) / size);
    const hi = (v: number, size: number, o: number, lo0: number) =>
      Math.max(lo0, Math.ceil((v - o) / size) - 1);
    if (square) {
      const c0 = lo(minX, w, ox);
      const r0 = lo(minY, h, oy);
      return { c0, r0, c1: hi(maxX, w, ox, c0), r1: hi(maxY, h, oy, r0) };
    }
    // Every cell whose bounding box overlaps the rectangle, whichever way its line is pushed.
    if (staggerX) {
      const c0 = Math.floor((minX - ox - w) / pitch) + 1;
      const r0 = Math.floor((minY - oy) / h - 1.5) + 1;
      return { c0, r0, c1: hi(maxX, pitch, ox, c0), r1: hi(maxY, h, oy, r0) };
    }
    const c0 = Math.floor((minX - ox) / w - 1.5) + 1;
    const r0 = Math.floor((minY - oy - h) / pitch) + 1;
    return { c0, r0, c1: hi(maxX, w, ox, c0), r1: hi(maxY, pitch, oy, r0) };
  }

  return {
    settings,
    neighbors([col, row], diagonals = false) {
      if (square) {
        const steps = diagonals ? [...SQUARE_EDGES, ...SQUARE_DIAGONALS] : SQUARE_EDGES;
        return steps.map(([dc, dr]) => cell(col + dc, row + dr));
      }
      const [q, r] = toAxial([col, row]);
      return (staggerX ? AXIAL_STAGGER_X : AXIAL_STAGGER_Y).map(([dq, dr]) =>
        fromAxial(q + dq, r + dr),
      );
    },
    stepCost(a, b) {
      return square && a[0] !== b[0] && a[1] !== b[1] ? 14 : 10;
    },
    heuristic(a, b) {
      if (!square) return 10 * hexDistance(a, b);
      const dx = abs(b[0] - a[0]);
      const dy = abs(b[1] - a[1]);
      return dx > dy ? 10 * dx + 4 * dy : 10 * dy + 4 * dx;
    },
    distance(a, b, diagonals = false) {
      if (!square) return hexDistance(a, b);
      const dx = abs(b[0] - a[0]);
      const dy = abs(b[1] - a[1]);
      return diagonals ? (dx > dy ? dx : dy) : dx + dy;
    },
    center,
    cellAt,
    corners,
    line: (a, b) => (square ? squareLine(a, b) : hexLine(a, b)),
    cellsIn(shape) {
      const box = aabb(shape);
      const { c0, r0, c1, r1 } = rect([box.minX, box.minY, box.maxX, box.maxY]);
      const out: Cell[] = [];
      for (let r = r0; r <= r1; r++)
        for (let c = c0; c <= c1; c++)
          if (containsCentre(shape, center([c, r]))) out.push(cell(c, r));
      return out;
    },
    rect,
  };
}
