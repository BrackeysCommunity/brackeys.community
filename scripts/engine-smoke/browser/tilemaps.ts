/**
 * What the browser smoke's tilemap run draws and where it reads it, shared
 * by the page, the runner and their tests: the kitchen sink's `tiles` strip
 * alone, once on the sink's square grid and once on a hex grid, each read at
 * a painted cell's centre and at a point off the map.
 */
import { gridGeometry } from "@jams/engine/game";
import type { GridSettings, SceneDefinition } from "@jams/engine/scene";

import { SINK_SCENE } from "./sink";

/** The sink's tilemap entity: an 8 by 2 strip of the kitchen tileset. */
export const TILEMAP_ENTITY = "tiles";

/** The fill inside each tile's 2 px border in `art/kitchen-tiles.png`: stone (tile 0), then moss (tile 1). */
export const TILE_COLOURS = [0x8a8f99, 0x5f9e4f] as const;

/** The painted cell each map is read at: inside the strip, away from its edges. */
export const TILE_CELL: readonly [col: number, row: number] = [3, 0];

/** The cell a map is read off at: below the strip, which no tile covers. */
export const EMPTY_CELL: readonly [col: number, row: number] = [3, 4];

/** The hex map's grid, its cell one 25 px kitchen tile at 100 px per metre; the tilemap sits at its origin. */
export const HEX_GRID: GridSettings = {
  kind: "hex",
  cell: [0.25, 0.25],
  side: 0.125,
  stagger: "y",
  index: "odd",
};

export type TilemapShape = "square" | "hex";
export const TILEMAP_SHAPES: readonly TilemapShape[] = ["square", "hex"];

/** One map as the page read it back: a painted cell's centre and an empty one's. */
export type TilemapRead = {
  shape: TilemapShape;
  renderer: string;
  tile: readonly [number, number, number, number];
  empty: readonly [number, number, number, number];
};

export type TilemapProbe = { square: TilemapRead; hex: TilemapRead };

/** `scene` cut down to its tilemap, on `grid` with the map at `at` when given. */
export function tilemapScene(
  scene: SceneDefinition,
  grid: GridSettings | undefined,
  at?: readonly [number, number],
): SceneDefinition {
  const map = (scene.entities ?? []).find((e) => e.id === TILEMAP_ENTITY);
  if (!map) throw new Error(`${SINK_SCENE} has no ${TILEMAP_ENTITY} tilemap`);
  return {
    ...scene,
    settings: { ...scene.settings, ...(grid ? { grid } : {}) },
    instances: [],
    solid: [],
    entities: [at ? { ...map, at: [at[0], at[1]] } : map],
  };
}

/** World metres of `TILE_CELL`'s and `EMPTY_CELL`'s centres on a cut-down scene's map. */
export function tilemapPoints(
  scene: SceneDefinition,
): [tile: [x: number, y: number], empty: [x: number, y: number]] {
  const at = scene.entities?.[0]?.at as readonly [number, number] | undefined;
  const grid = scene.settings?.grid;
  if (!at || !grid) throw new Error(`${TILEMAP_ENTITY} has no grid or position`);
  const geometry = gridGeometry({ ...grid, origin: [at[0], at[1]] });
  return [geometry.center(TILE_CELL), geometry.center(EMPTY_CELL)];
}
