import type { Point } from "./board.ts";

/**
 * A square grid's four sides, in the order a layout numbers them: east,
 * south, west, north. sim/puzzle's grid helpers, mirrored.
 */
export const SIDES = 4;

/** A hex cell's six sides, clockwise from east: east, south-east, south-west, west, north-west, north-east. */
export const HEX_SIDES = 6;

/** The shape whose boards are hex: an n by n rhombus in axial coordinates, q across and r down. */
export const HEX_SHAPE = 1;

// Each side's step across and down, by board.
const SQUARE_STEPS: [number, number][] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];
const HEX_STEPS: [number, number][] = [
  [1, 0],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [0, -1],
  [1, -1],
];

/** A board's sides: side d (counted from east) is bit d, so a mask turns by shifting. */
export interface Grid {
  readonly sides: number;
  readonly hex: boolean;
  /** A set of sides, turned clockwise by so many sides. */
  rotate(mask: number, turns: number): number;
  /** The side facing side d. */
  opposite(side: number): number;
  /** The cell one side over in an n by n board, or nothing at the edge. */
  step(cell: number, side: number, n: number): number | undefined;
}

function grid(steps: [number, number][], hex: boolean): Grid {
  const sides = steps.length;
  const all = (1 << sides) - 1;
  return {
    sides,
    hex,
    rotate(mask, turns) {
      for (let i = turns % sides; i > 0; i--) mask = ((mask << 1) | (mask >> (sides - 1))) & all;
      return mask;
    },
    opposite: (side) => (side + sides / 2) % sides,
    step(cell, side, n) {
      const [dx, dy] = steps[side]!;
      const x = (cell % n) + dx;
      const y = Math.trunc(cell / n) + dy;
      return x < 0 || y < 0 || x >= n || y >= n ? undefined : y * n + x;
    },
  };
}

export const SQUARE = grid(SQUARE_STEPS, false);
export const HEX = grid(HEX_STEPS, true);

/** The board a shape's machine is laid on. */
export function gridOf(shape: number | undefined): Grid {
  return shape === HEX_SHAPE ? HEX : SQUARE;
}

/** A set of sides, as bits (east 1, south 2, west 4, north 8), turned clockwise by quarter turns. */
export function rotate(mask: number, turns: number): number {
  return SQUARE.rotate(mask, turns);
}

/** The cell one side over in an n by n grid, or nothing at the edge. */
export function step(cell: number, side: number, n: number): number | undefined {
  return SQUARE.step(cell, side, n);
}

/** A hex rhombus fitted to a box: where each cell sits and which way its sides face. */
export interface HexFit {
  /** A cell's inner radius in px: the distance from its centre to a side. */
  r: number;
  /** Turned a quarter, the rhombus stands tall for a tall box; the hexes are then flat on top. */
  tall: boolean;
  centres: Point[];
  /** The angle side d faces, in radians clockwise from east on the screen. */
  angle(side: number): number;
  /** A cell's outline as an SVG path, its corners at radius r × scale. */
  outline(cell: number, scale?: number): string;
}

/**
 * An n by n hex rhombus fitted inside a box with a margin: q runs along
 * one edge and r along the other, sixty degrees apart. Of the two ways to
 * stand it, the one that gives the larger cells is taken.
 */
export function hexFit(n: number, box: { width: number; height: number }, pad = 0): HexFit {
  // In units of the inner radius, pointy side up: east is (2, 0), south-east (1, √3).
  const unit = (cell: number) => {
    const q = cell % n;
    const r = Math.trunc(cell / n);
    return { x: 2 * q + r, y: Math.sqrt(3) * r };
  };
  const wide = 3 * n - 1;
  const deep = Math.sqrt(3) * (n - 1) + 4 / Math.sqrt(3);
  const w = Math.max(1, box.width - pad * 2);
  const h = Math.max(1, box.height - pad * 2);
  const flat = Math.min(w / wide, h / deep);
  const stood = Math.min(w / deep, h / wide);
  const tall = stood > flat;
  const r = Math.max(flat, stood);
  const turn = tall ? Math.PI / 2 : 0;
  const [bw, bh] = tall ? [deep, wide] : [wide, deep];
  const left = pad + (w - bw * r) / 2;
  const top = pad + (h - bh * r) / 2;
  const centres = Array.from({ length: n * n }, (_, c) => {
    const u = unit(c);
    // Pointy up, the rhombus's corner cell sits one radius in and 2/√3 down.
    const x = u.x + 1;
    const y = u.y + 2 / Math.sqrt(3);
    return tall
      ? { x: left + (deep - y) * r, y: top + x * r }
      : { x: left + x * r, y: top + y * r };
  });
  const angle = (side: number) => (side * Math.PI) / 3 + turn;
  return {
    r,
    tall,
    centres,
    angle,
    outline(cell, scale = 1) {
      const c = centres[cell]!;
      const R = ((r * 2) / Math.sqrt(3)) * scale;
      const pts = Array.from({ length: 6 }, (_, k) => {
        // A corner sits half a side round from each side's middle.
        const a = angle(k) + Math.PI / 6;
        return `${(c.x + R * Math.cos(a)).toFixed(2)},${(c.y + R * Math.sin(a)).toFixed(2)}`;
      });
      return `M${pts.join("L")}Z`;
    },
  };
}
