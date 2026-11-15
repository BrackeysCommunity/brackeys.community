/**
 * The tile cell codec: a tilemap cell's grid value is 0 for empty, else the
 * tile id + 1 in the low 13 bits with Tiled's flip flags above it. Pure and
 * import-free, so every module that reads cells (the canvas-sync image's
 * transforms and validation among them) can take it.
 */

/** Bits of a cell value that hold the tile id + 1. */
export const TILE_ID_BITS = 13;
/** Tiles a tileset can hold: ids 0…8190. */
export const MAX_TILES = 8_191;
/** Tiled's horizontal flip. */
export const FLIP_X = 1 << 13;
/** Tiled's vertical flip. */
export const FLIP_Y = 1 << 14;
/** Tiled's diagonal flip (transpose), applied before the other two. */
export const FLIP_D = 1 << 15;

const ID_MASK = (1 << TILE_ID_BITS) - 1;
const VALUE_MAX = 0xffff;

/** A decoded cell; null is empty. */
export type TileCell = { id: number; flipX: boolean; flipY: boolean; flipD: boolean } | null;

/** A quarter turn or mirror: mirror x when `flip`, then turn `rot` quarter turns clockwise (y down). */
export type TileTurn = { rot: 0 | 1 | 2 | 3; flip: boolean };

/** The cell a value holds; null for 0, and for flags with no tile. */
export function decodeCell(value: number): TileCell {
  if (!Number.isInteger(value) || value < 0 || value > VALUE_MAX)
    throw new RangeError(`a tile cell value is an integer in [0, ${VALUE_MAX}], got ${value}`);
  const id = value & ID_MASK;
  if (id === 0) return null;
  return {
    id: id - 1,
    flipX: (value & FLIP_X) !== 0,
    flipY: (value & FLIP_Y) !== 0,
    flipD: (value & FLIP_D) !== 0,
  };
}

/** The value a cell is stored as; 0 for null. */
export function encodeCell(cell: TileCell): number {
  if (cell === null) return 0;
  if (!Number.isInteger(cell.id) || cell.id < 0 || cell.id >= MAX_TILES)
    throw new RangeError(`a tile id is an integer in [0, ${MAX_TILES - 1}], got ${cell.id}`);
  return (
    (cell.id + 1) |
    (cell.flipX ? FLIP_X : 0) |
    (cell.flipY ? FLIP_Y : 0) |
    (cell.flipD ? FLIP_D : 0)
  );
}

type Linear = readonly [a: number, b: number, c: number, d: number];

/** x' = a·x + c·y, y' = b·x + d·y. */
const mul = (o: Linear, i: Linear): Linear => [
  o[0] * i[0] + o[2] * i[1],
  o[1] * i[0] + o[3] * i[1],
  o[0] * i[2] + o[2] * i[3],
  o[1] * i[2] + o[3] * i[3],
];

const IDENTITY: Linear = [1, 0, 0, 1];
const MIRROR_X: Linear = [-1, 0, 0, 1];
const MIRROR_Y: Linear = [1, 0, 0, -1];
const TRANSPOSE: Linear = [0, 1, 1, 0];
const QUARTER_CW: Linear = [0, 1, -1, 0];

/** How a cell's flags draw its tile: the diagonal flip first, then horizontal, then vertical. */
function flagsLinear(flags: number): Linear {
  let m = IDENTITY;
  if (flags & FLIP_D) m = mul(TRANSPOSE, m);
  if (flags & FLIP_X) m = mul(MIRROR_X, m);
  if (flags & FLIP_Y) m = mul(MIRROR_Y, m);
  return m;
}

function turnLinear(d: TileTurn): Linear {
  let m = d.flip ? MIRROR_X : IDENTITY;
  for (let i = 0; i < d.rot; i++) m = mul(QUARTER_CW, m);
  return m;
}

const FLAG_BITS = FLIP_X | FLIP_Y | FLIP_D;

function flagsOf(m: Linear): number {
  for (let flags = 0; flags <= FLAG_BITS; flags += FLIP_X) {
    const f = flagsLinear(flags);
    if (f[0] === m[0] && f[1] === m[1] && f[2] === m[2] && f[3] === m[3]) return flags;
  }
  throw new Error("unreachable: every dihedral element has Tiled flags");
}

/** A quarter turn or mirror applied to a cell's flags (instance transforms, the brush's rotate keys); the id and an empty cell stay as they are. */
export function transformCell(value: number, d: TileTurn): number {
  if (decodeCell(value) === null) return value;
  const turned = mul(turnLinear(d), flagsLinear(value & FLAG_BITS));
  return (value & ID_MASK) | flagsOf(turned);
}
