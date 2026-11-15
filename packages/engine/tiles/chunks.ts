/** Chunk bookkeeping over a tilemap's cells: decoding, traits per tile, and which chunks changed. Pure. */
import type { Side } from "../game/types";
import { DEFAULT_TILE_COST, type TileDef } from "../project/kinds/tileset";
import { compareChunkKeys, forEachRun, GRID_CHUNK, parseChunkKey } from "../scene/grid";
import type { ChunkKey, GridCells, GridRow } from "../scene/grid";
import type { ShapeTuple } from "../scene/types";

/** What a tile means to colliders, grid walls, path costs and schematic renders alike. */
export type TileTraits = {
  solid: boolean;
  /** The side a one-way solid lands actors on; null for none. */
  oneWay: Side | null;
  /** Path cost to enter the cell on the grid's scale; null when the tile walls it. */
  cost: number | null;
  /** Collision shapes in tile px that replace the full square; null for the square. */
  shapes: readonly ShapeTuple[] | null;
};

/** One chunk's cells, decoded: 32 × 32 values row-major. */
export type TileChunk = { key: ChunkKey; cx: number; cy: number; values: Uint16Array };

export { DEFAULT_TILE_COST };

const CHUNK_CELLS = GRID_CHUNK * GRID_CHUNK;

/** A map-local cell as a `"col,row"` key, for sets and maps of cells with no range limit. */
export const mapCellKey = (col: number, row: number): string => `${col},${row}`;

/** The `[col, row]` a `mapCellKey` names. */
export const parseMapCellKey = (key: string): [col: number, row: number] =>
  key.split(",").map(Number) as [number, number];

/** The one rule for a tile's solidity, one-way side, cost and shapes; every reader of tiles goes through it. */
export function tileTraits(def: TileDef | undefined): TileTraits {
  const solid = def?.solid === true;
  const shapes = solid && def?.shapes && def.shapes.length > 0 ? def.shapes : null;
  return {
    solid,
    oneWay: solid ? (def?.oneWay ?? null) : null,
    cost: solid ? null : (def?.cost ?? DEFAULT_TILE_COST),
    shapes,
  };
}

/** Whether a tile joins the merged full-square colliders: two-way solid with no shapes of its own. */
export const mergesAsBox = (t: TileTraits): boolean =>
  t.solid && t.oneWay === null && t.shapes === null;

/**
 * Calls `fn` with each run of a chunk's rows, by chunk-local row and first
 * column; throws on a chunk past 32 rows or a row outside the row grammar.
 */
export function forEachChunkRun(
  key: ChunkKey,
  rows: readonly GridRow[] | undefined,
  fn: (value: number, col: number, row: number, count: number) => void,
): void {
  if (!rows) return;
  if (rows.length > GRID_CHUNK)
    throw new Error(`tile chunk "${key}" has more than ${GRID_CHUNK} rows`);
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]!;
    if (row === "") continue;
    if (!forEachRun(row, (value, col, count) => fn(value, col, r, count)))
      throw new Error(`tile chunk "${key}" row ${r} isn't a valid row: ${JSON.stringify(row)}`);
  }
}

/** A chunk's 1024 values, and whether any is non-zero. */
function decodeRows(
  key: ChunkKey,
  rows: readonly GridRow[] | undefined,
): { values: Uint16Array; empty: boolean } {
  const values = new Uint16Array(CHUNK_CELLS);
  let empty = true;
  forEachChunkRun(key, rows, (value, col, row, count) => {
    if (value === 0) return;
    const at = row * GRID_CHUNK + col;
    values.fill(value, at, at + count);
    empty = false;
  });
  return { values, empty };
}

/** Every non-empty chunk of `cells`, decoded, in chunk-key order. */
export function decodeChunks(cells: GridCells): TileChunk[] {
  const out: TileChunk[] = [];
  for (const key of Object.keys(cells).sort(compareChunkKeys)) {
    const at = parseChunkKey(key);
    if (!at) throw new Error(`tile chunk key "${key}" isn't "cx,cy"`);
    const { values, empty } = decodeRows(key, cells[key]);
    if (!empty) out.push({ key, cx: at[0], cy: at[1], values });
  }
  return out;
}

function sameRows(
  key: ChunkKey,
  a: readonly GridRow[] | undefined,
  b: readonly GridRow[] | undefined,
) {
  if (a === b) return true;
  const n = Math.max(a?.length ?? 0, b?.length ?? 0);
  let textual = true;
  for (let r = 0; r < n && textual; r++) textual = (a?.[r] ?? "") === (b?.[r] ?? "");
  if (textual) return true;
  const va = decodeRows(key, a).values;
  const vb = decodeRows(key, b).values;
  for (let i = 0; i < CHUNK_CELLS; i++) if (va[i] !== vb[i]) return false;
  return true;
}

/** The chunks whose cells differ between two versions of a tilemap's cells, in chunk-key order. */
export function dirtyChunks(prev: GridCells, next: GridCells): ChunkKey[] {
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  return [...keys].filter((k) => !sameRows(k, prev[k], next[k])).sort(compareChunkKeys);
}
