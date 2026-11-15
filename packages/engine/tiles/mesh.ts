/** Per-chunk quad geometry and UVs into a tileset image; the Pixi mesh is built in render/. Pure. */
import { FLIP_D, FLIP_X, FLIP_Y, TILE_ID_BITS } from "../game/tile-cell";
import { gridGeometry } from "../grid/geometry";
import type { TileDef, TilesetFile } from "../project/kinds/tileset";
import { GRID_CHUNK } from "../scene/grid";
import type { Bounds, GridSettings, Pt } from "../scene/types";
import type { TileChunk } from "./chunks";

/** One chunk's quads: positions in world px, UVs in 0–1 of the image. */
export type ChunkMesh = {
  positions: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  /** The quads' box in world px, what the chunk culls by. */
  bounds: Bounds;
  /** Quads whose tile animates, by quad index, so a frame swaps only their UVs. */
  animated: readonly { quad: number; tile: number; flags: number }[];
};

/** What a chunk's mesh is cut from: the tileset, the image's px size and where the map sits on its grid. */
export type ChunkMeshInput = {
  tileset: TilesetFile;
  image: [w: number, h: number];
  grid: GridSettings;
  pxPerMetre: number;
  /** The grid cell the map's own cell (0, 0) is; default (0, 0). */
  offset?: readonly [col: number, row: number];
};

const ID_MASK = (1 << TILE_ID_BITS) - 1;
const FLAG_MASK = FLIP_X | FLIP_Y | FLIP_D;

/** The grid cell a map at `at` (metres) starts on: the one whose top-left corner is `at`. */
export function tileOffset(grid: GridSettings, at: Pt): [number, number] {
  const [w, h] = grid.cell;
  const [c, r] = gridGeometry(grid).cellAt([at[0] + w / 2, at[1] + h / 2]);
  return [c, r];
}

/** Tile `id`'s rect in the tileset's image: `[x, y, w, h]` in image px. */
export function tileFrame(id: number, tileset: TilesetFile): [number, number, number, number] {
  const [tw, th] = tileset.tile;
  const margin = tileset.margin ?? 0;
  const spacing = tileset.spacing ?? 0;
  return [
    margin + (id % tileset.columns) * (tw + spacing),
    margin + Math.floor(id / tileset.columns) * (th + spacing),
    tw,
    th,
  ];
}

/**
 * Writes a quad's four UVs (top-left, top-right, bottom-right, bottom-left
 * of the drawn cell) for tile `id` drawn with Tiled's flip `flags`:
 * the diagonal flip first, then horizontal, then vertical.
 */
export function writeTileUVs(
  out: Float32Array,
  quad: number,
  id: number,
  flags: number,
  tileset: TilesetFile,
  image: readonly [number, number],
): void {
  const [x, y, tw, th] = tileFrame(id, tileset);
  const u0 = x / image[0];
  const v0 = y / image[1];
  const du = tw / image[0];
  const dv = th / image[1];
  for (let k = 0; k < 4; k++) {
    let sx = k === 1 || k === 2 ? 1 : 0;
    let sy = k >= 2 ? 1 : 0;
    if (flags & FLIP_Y) sy = 1 - sy;
    if (flags & FLIP_X) sx = 1 - sx;
    if (flags & FLIP_D) [sx, sy] = [sy, sx];
    out[quad * 8 + k * 2] = u0 + sx * du;
    out[quad * 8 + k * 2 + 1] = v0 + sy * dv;
  }
}

/** The tile an animated tile shows at `nowMs`; its own id without frames. */
export function animationFrame(def: TileDef | undefined, nowMs: number): number | null {
  const frames = def?.animation;
  if (!frames || frames.length === 0) return null;
  const total = frames.reduce((sum, f) => sum + f.ms, 0);
  if (total <= 0) return frames[0]!.tile;
  let t = ((nowMs % total) + total) % total;
  for (const f of frames) {
    if (t < f.ms) return f.tile;
    t -= f.ms;
  }
  return frames[frames.length - 1]!.tile;
}

/**
 * One chunk's quads, each a cell's box centred on the grid's cell centre
 * (so hex maps place quads at `GridGeometry.center`); null when the chunk
 * draws nothing.
 */
export function buildChunkMesh(chunk: TileChunk, input: ChunkMeshInput): ChunkMesh | null {
  const { tileset, image, grid, pxPerMetre: ppm } = input;
  const [oc, or] = input.offset ?? [0, 0];
  const geo = gridGeometry(grid);
  const hw = (grid.cell[0] * ppm) / 2;
  const hh = (grid.cell[1] * ppm) / 2;
  const animatedDefs = new Map<number, TileDef>();
  for (const t of tileset.tiles ?? []) if (t.animation?.length) animatedDefs.set(t.id, t);

  let count = 0;
  for (const v of chunk.values) if ((v & ID_MASK) !== 0) count++;
  if (count === 0) return null;

  const positions = new Float32Array(count * 8);
  const uvs = new Float32Array(count * 8);
  const indices = new Uint32Array(count * 6);
  const animated: { quad: number; tile: number; flags: number }[] = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let q = 0;
  for (let i = 0; i < chunk.values.length; i++) {
    const value = chunk.values[i]!;
    const raw = value & ID_MASK;
    if (raw === 0) continue;
    const id = raw - 1;
    const flags = value & FLAG_MASK;
    const col = chunk.cx * GRID_CHUNK + (i % GRID_CHUNK) + oc;
    const row = chunk.cy * GRID_CHUNK + Math.floor(i / GRID_CHUNK) + or;
    const [mx, my] = geo.center([col, row]);
    const x0 = mx * ppm - hw;
    const y0 = my * ppm - hh;
    const x1 = mx * ppm + hw;
    const y1 = my * ppm + hh;
    positions.set([x0, y0, x1, y0, x1, y1, x0, y1], q * 8);
    const b = q * 4;
    indices.set([b, b + 1, b + 2, b, b + 2, b + 3], q * 6);
    const def = animatedDefs.get(id);
    writeTileUVs(uvs, q, def ? (animationFrame(def, 0) ?? id) : id, flags, tileset, image);
    if (def) animated.push({ quad: q, tile: id, flags });
    if (x0 < minX) minX = x0;
    if (y0 < minY) minY = y0;
    if (x1 > maxX) maxX = x1;
    if (y1 > maxY) maxY = y1;
    q++;
  }
  return { positions, uvs, indices, bounds: [minX, minY, maxX, maxY], animated };
}
