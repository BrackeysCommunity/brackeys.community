/** Deterministic autotiling: neighbour masks taken before the pass, cells in row-major order. Pure. */
import { encodeCell } from "../game/tile-cell";
import type { CellBounds } from "../grid/geometry";
import type { AutotileRule, TilesetFile } from "../project/kinds/tileset";
import { readCell, type CellEdit, type GridCells } from "../scene/grid";

/** Neighbour bits: N=1, NE=2, E=4, SE=8, S=16, SW=32, W=64, NW=128. */
export const MASK_N = 1;
export const MASK_NE = 2;
export const MASK_E = 4;
export const MASK_SE = 8;
export const MASK_S = 16;
export const MASK_SW = 32;
export const MASK_W = 64;
export const MASK_NW = 128;

/** The neighbour mask of a cell for a terrain; corners count only when both adjacent edges do (blob47). */
export function terrainMask(
  isTerrain: (col: number, row: number) => boolean,
  col: number,
  row: number,
  kind: AutotileRule["kind"],
): number {
  const n = isTerrain(col, row - 1);
  const e = isTerrain(col + 1, row);
  const s = isTerrain(col, row + 1);
  const w = isTerrain(col - 1, row);
  let mask = (n ? MASK_N : 0) | (e ? MASK_E : 0) | (s ? MASK_S : 0) | (w ? MASK_W : 0);
  if (kind === "edge16") return mask;
  if (n && e && isTerrain(col + 1, row - 1)) mask |= MASK_NE;
  if (s && e && isTerrain(col + 1, row + 1)) mask |= MASK_SE;
  if (s && w && isTerrain(col - 1, row + 1)) mask |= MASK_SW;
  if (n && w && isTerrain(col - 1, row - 1)) mask |= MASK_NW;
  return mask;
}

/**
 * The cells `rule` gives every terrain cell in `rect` and its one-cell border,
 * whose masks change. Only cells whose value changes are returned.
 */
export function applyAutotile(
  grid: GridCells,
  _tileset: TilesetFile,
  rule: AutotileRule,
  rect: CellBounds,
  isTerrain: (value: number) => boolean,
): CellEdit[] {
  const at = (col: number, row: number) => isTerrain(readCell(grid, col, row));
  const out: CellEdit[] = [];
  for (let row = rect.r0 - 1; row <= rect.r1 + 1; row++)
    for (let col = rect.c0 - 1; col <= rect.c1 + 1; col++) {
      const value = readCell(grid, col, row);
      if (!isTerrain(value)) continue;
      const mask = terrainMask(at, col, row, rule.kind);
      const id = rule.tiles[String(mask)] ?? rule.fallback;
      const next = encodeCell({ id, flipX: false, flipY: false, flipD: false });
      if (next !== value) out.push([col, row, next]);
    }
  return out;
}
