/** Chunk bookkeeping over a tilemap's cells: decoding, traits per tile, and which chunks changed. Pure. */
import type { Side } from "../game/types";
import type { TileDef } from "../project/kinds/tileset";
import { compareChunkKeys, decodeRow, GRID_CHUNK, parseChunkKey } from "../scene/grid";
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

/** A grid step's cost, matching the grid geometry's edge cost. */
export const DEFAULT_TILE_COST = 10;

const CHUNK_CELLS = GRID_CHUNK * GRID_CHUNK;

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

function decodeRows(key: ChunkKey, rows: readonly GridRow[] | undefined): Uint16Array {
  const values = new Uint16Array(CHUNK_CELLS);
  if (!rows) return values;
  if (rows.length > GRID_CHUNK)
    throw new Error(`tile chunk "${key}" has more than ${GRID_CHUNK} rows`);
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]!;
    if (row === "") continue;
    const decoded = decodeRow(row);
    if (!decoded)
      throw new Error(`tile chunk "${key}" row ${r} isn't a valid row: ${JSON.stringify(row)}`);
    values.set(decoded, r * GRID_CHUNK);
  }
  return values;
}

const isEmpty = (values: Uint16Array): boolean => values.every((v) => v === 0);

/** Every non-empty chunk of `cells`, decoded, in chunk-key order. */
export function decodeChunks(cells: GridCells): TileChunk[] {
  const out: TileChunk[] = [];
  for (const key of Object.keys(cells).sort(compareChunkKeys)) {
    const at = parseChunkKey(key);
    if (!at) throw new Error(`tile chunk key "${key}" isn't "cx,cy"`);
    const values = decodeRows(key, cells[key]);
    if (!isEmpty(values)) out.push({ key, cx: at[0], cy: at[1], values });
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
  const va = decodeRows(key, a);
  const vb = decodeRows(key, b);
  for (let i = 0; i < CHUNK_CELLS; i++) if (va[i] !== vb[i]) return false;
  return true;
}

/** The chunks whose cells differ between two versions of a tilemap's cells, in chunk-key order. */
export function dirtyChunks(prev: GridCells, next: GridCells): ChunkKey[] {
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  return [...keys].filter((k) => !sameRows(k, prev[k], next[k])).sort(compareChunkKeys);
}
