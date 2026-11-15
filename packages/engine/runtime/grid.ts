import { OCCUPANT } from "../game/behaviors/occupant";
import type { EngineContext, Registry } from "../game/types";
import {
  cellKey,
  cellKeyRun,
  gridGeometry,
  inCellBounds,
  type Cell,
  type CellBounds,
  type CellKey,
  type GridGeometry,
} from "../grid/geometry";
import { createKeyedOccupancy, type KeyedOccupancy, type Occupancy } from "../grid/occupancy";
import { findPath, type GridPath } from "../grid/path";
import { GRID_CHUNK, type ChunkKey, type GridCells } from "../scene/grid";
import { makeIssue } from "../scene/issues";
import { geometryFields } from "../scene/schema";
import { translateShape } from "../scene/shape-geometry";
import type {
  Bounds,
  EntityTypeName,
  ExpandedScene,
  PathDef,
  Pt,
  RuntimeEntity,
  SceneIssue,
  ShapeObj,
} from "../scene/types";
import { isTilemapSystem, type TilemapSystem } from "../systems/tilemap";
import { chunkOrigin, DEFAULT_TILE_COST, forEachChunkRun, tileTraits } from "../tiles/chunks";
import { tileOffset } from "../tiles/mesh";
import type { OccupantSystem } from "./behaviors/occupant";
import { spawnPose } from "./spawn-pose";

/** The loaded scene's grid: present when its resolved settings have one. */
export type RuntimeGrid = {
  geometry: GridGeometry;
  occupancy: Occupancy;
  /** The scene bounds in cells. */
  bounds: CellBounds;
  /** In bounds, not a wall, not blocked. */
  passable(c: Cell): boolean;
  /**
   * The extra cost of stepping into `to`, for `findPath` and `flowField`'s
   * `cost`: what the tiles there cost beyond one plain step, never below 0.
   */
  cost?(from: Cell, to: Cell): number | null;
};

/** The runtime's grid across loads: built at load, kept in step with edits, gone at unload. */
export type GridState = {
  readonly current: RuntimeGrid | null;
  /** At a load, before anything spawns: walls come from the scene's wall entities. */
  load(scene: ExpandedScene): void;
  /** After each batch of adds, updates and removes. */
  sync(scene: ExpandedScene | null): void;
  /** A tilemap rebuilt `chunks` (its own chunk keys): they are re-read at the next sync or `tilesChanged`. */
  tileChunksChanged(id: string, chunks: readonly ChunkKey[]): void;
  /** Re-reads the tile chunks reported since the last read: after flushed runtime tile writes. */
  tilesChanged(): void;
  /** Re-reads the walls and costs of every tilemap in `scene`: after the load's spawns and after a restore. */
  tilesLoaded(scene: ExpandedScene | null): void;
  /** At unload. */
  clear(): void;
  /**
   * Widens the grid's cell bounds from the scene's to cover each of `rects`
   * too (attached sublevels' bounds, world metres); `[]` puts them back.
   */
  extend(rects: readonly Bounds[]): void;
};

const DEFAULT_GRID_WALLS: readonly EntityTypeName[] = ["solid"];

/** The types whose shapes are grid walls: `GameDefinition.world.gridWalls`, default `["solid"]`. */
export function gridWallTypes(registry: Registry): ReadonlySet<EntityTypeName> {
  return new Set(registry.game?.world?.gridWalls ?? DEFAULT_GRID_WALLS);
}

/** `e`'s shapes in world space: each shape field, carried to its path's first point when it has one. */
function worldShapes(registry: Registry, e: RuntimeEntity): ShapeObj[] {
  const type = registry.types.get(e.type);
  if (!type) return [];
  const shapes: ShapeObj[] = [];
  let start: [number, number] | undefined;
  for (const { field, kind } of geometryFields(type)) {
    const value = e[field];
    if (value === undefined || value === null) continue;
    if (kind === "shape") shapes.push(value as ShapeObj);
    else if (kind === "path") start ??= (value as PathDef).pts[0];
  }
  return start ? shapes.map((s) => translateShape(s, start)) : shapes;
}

/** A tilemap's walls and extra step costs as last read, by grid cell, and the cells each of its chunks gave. */
type MapTiles = {
  entity: RuntimeEntity;
  /** The grid cell its own cell (0, 0) lands on. */
  origin: Cell;
  chunks: Map<ChunkKey, readonly CellKey[]>;
  walls: Set<CellKey>;
  costs: Map<CellKey, number>;
};

/** Grid geometry, walls from wall-type shapes and solid tiles (kept in sync with entities and tile writes) and scene bounds, for a runtime. */
export function createGridState(
  ctx: EngineContext,
  registry: Registry,
  wallTypes: ReadonlySet<EntityTypeName> = gridWallTypes(registry),
): GridState {
  let current: RuntimeGrid | null = null;
  /** `current`'s occupancy, taking walls by cell key. */
  let walled: KeyedOccupancy | null = null;
  /** The loaded scene's bounds in cells, before any `extend`. */
  let own: CellBounds | null = null;
  /** Per wall entity, the entity as last rasterised and the wall cells it gave. */
  let rasterised = new Map<string, { entity: RuntimeEntity; keys: readonly CellKey[] }>();
  /** How many wall entities cover each wall cell. */
  let covers = new Map<CellKey, number>();
  let maps = new Map<string, MapTiles>();
  /** Chunks rebuilt since they were last read, by map. */
  const pending = new Map<string, Set<ChunkKey>>();
  /** Cells a solid tile walls. */
  let tileWalls = new Set<CellKey>();
  /** Extra step cost into a cell that isn't walled, where its tiles cost more than a plain step. */
  let tileCosts = new Map<CellKey, number>();

  function setWalls(was: (k: CellKey) => boolean, keys: Iterable<CellKey>): void {
    for (const k of keys) {
      const now = covers.has(k) || tileWalls.has(k);
      if (now !== was(k)) walled?.setWallKey(k, now);
    }
  }

  function mapOrigin(grid: RuntimeGrid, e: RuntimeEntity): Cell | null {
    if (!Array.isArray(e.at)) return null;
    return tileOffset(grid.geometry.settings, e.at as Pt, grid.geometry);
  }

  function dropChunk(t: MapTiles, key: ChunkKey, touched: Set<CellKey> | null): void {
    for (const k of t.chunks.get(key) ?? []) {
      t.walls.delete(k);
      t.costs.delete(k);
      touched?.add(k);
    }
    t.chunks.delete(key);
  }

  /**
   * Reads `keys` of a map (every chunk for null) from its cells now, run by
   * run: a solid tile walls its cells, a dearer one costs its extra. A
   * value's tile is resolved once per read. Cells read go into `touched`.
   */
  function readChunks(
    system: TilemapSystem,
    t: MapTiles,
    keys: readonly ChunkKey[] | null,
    touched: Set<CellKey> | null,
  ): void {
    const id = t.entity.id;
    const cells = system.cells(id) ?? (t.entity.cells as GridCells | undefined) ?? {};
    if (keys) for (const key of keys) dropChunk(t, key, touched);
    const costOf = new Map<number, number | null>();
    const [oc, or] = t.origin;
    for (const key of keys ?? Object.keys(cells)) {
      const rows = cells[key];
      if (!rows) continue;
      const [cx, cy] = chunkOrigin(key);
      const c0 = cx * GRID_CHUNK + oc;
      const r0 = cy * GRID_CHUNK + or;
      const mine: CellKey[] = [];
      forEachChunkRun(key, rows, (value, col, row, count) => {
        if (value === 0) return;
        let cost = costOf.get(value);
        if (cost === undefined) {
          const cell: Cell = [c0 + col, r0 + row];
          cost = tileTraits(system.at(cell).find((at) => at.map === id)?.def).cost;
          costOf.set(value, cost);
        }
        if (cost !== null && cost <= DEFAULT_TILE_COST) return;
        for (const k of cellKeyRun(c0 + col, r0 + row, count)) {
          if (cost === null) t.walls.add(k);
          else t.costs.set(k, cost - DEFAULT_TILE_COST);
          mine.push(k);
        }
      });
      if (mine.length === 0) continue;
      t.chunks.set(key, mine);
      if (touched) for (const k of mine) touched.add(k);
    }
  }

  /** Settles each touched cell's tile wall and cost across every map, and the occupancy's wall. */
  function settle(touched: Iterable<CellKey>): void {
    for (const k of touched) {
      let wall = false;
      let extra = 0;
      for (const t of maps.values()) {
        if (t.walls.has(k)) {
          wall = true;
          break;
        }
        const c = t.costs.get(k);
        if (c !== undefined && c > extra) extra = c;
      }
      const before = covers.has(k) || tileWalls.has(k);
      if (wall) tileWalls.add(k);
      else tileWalls.delete(k);
      if (!wall && extra > 0) tileCosts.set(k, extra);
      else tileCosts.delete(k);
      const now = covers.has(k) || wall;
      if (now !== before) walled?.setWallKey(k, now);
    }
  }

  function dropMap(t: MapTiles, touched: Set<CellKey>): void {
    for (const key of [...t.chunks.keys()]) dropChunk(t, key, touched);
    maps.delete(t.entity.id);
    pending.delete(t.entity.id);
  }

  function readMap(
    grid: RuntimeGrid,
    system: TilemapSystem,
    e: RuntimeEntity,
    touched: Set<CellKey> | null,
  ): void {
    const origin = mapOrigin(grid, e);
    if (!origin) return;
    const t: MapTiles = {
      entity: e,
      origin,
      chunks: new Map(),
      walls: new Set(),
      costs: new Map(),
    };
    maps.set(e.id, t);
    pending.delete(e.id);
    readChunks(system, t, null, touched);
  }

  function readPending(touched: Set<CellKey>): void {
    for (const [id, keys] of pending) {
      const t = maps.get(id);
      const system = t && ctx.system(t.entity.type);
      if (t && isTilemapSystem(system)) readChunks(system, t, [...keys], touched);
    }
    pending.clear();
  }

  /** Reads every map afresh, then moves the occupancy's walls from the old tile walls to the new. */
  function readAll(grid: RuntimeGrid, scene: ExpandedScene | null): void {
    maps = new Map();
    pending.clear();
    for (const e of scene?.entities ?? []) {
      const system = ctx.system(e.type);
      if (isTilemapSystem(system)) readMap(grid, system, e, null);
    }
    const all = [...maps.values()];
    const walls = all.length === 1 ? new Set(all[0]!.walls) : new Set<CellKey>();
    if (all.length > 1) for (const t of all) for (const k of t.walls) walls.add(k);
    const costs = new Map<CellKey, number>();
    for (const t of all)
      for (const [k, c] of t.costs) if (!walls.has(k) && c > (costs.get(k) ?? 0)) costs.set(k, c);
    const before = tileWalls;
    tileWalls = walls;
    tileCosts = costs;
    for (const k of before) if (!walls.has(k) && !covers.has(k)) walled?.setWallKey(k, false);
    for (const k of walls) if (!before.has(k) && !covers.has(k)) walled?.setWallKey(k, true);
  }

  /** Follows the scene's tilemap entities: a new or moved map is read whole, an edited one by its rebuilt chunks. */
  function syncMaps(grid: RuntimeGrid, scene: ExpandedScene): void {
    const touched = new Set<CellKey>();
    const seen = new Set<string>();
    for (const e of scene.entities) {
      const known = maps.get(e.id);
      if (known?.entity === e) {
        seen.add(e.id);
        continue;
      }
      const system = ctx.system(e.type);
      if (!isTilemapSystem(system)) continue;
      seen.add(e.id);
      const origin = mapOrigin(grid, e);
      if (known && origin && known.origin[0] === origin[0] && known.origin[1] === origin[1]) {
        known.entity = e;
        continue;
      }
      if (known) dropMap(known, touched);
      readMap(grid, system, e, touched);
    }
    for (const t of [...maps.values()]) if (!seen.has(t.entity.id)) dropMap(t, touched);
    readPending(touched);
    settle(touched);
  }

  function syncWalls(grid: RuntimeGrid, scene: ExpandedScene): void {
    const next = new Map<string, { entity: RuntimeEntity; keys: readonly CellKey[] }>();
    const nextCovers = new Map<CellKey, number>();
    for (const e of scene.entities) {
      if (!wallTypes.has(e.type)) continue;
      const kept = rasterised.get(e.id);
      const keys =
        kept && kept.entity === e
          ? kept.keys
          : worldShapes(registry, e).flatMap((s) => grid.geometry.cellsIn(s).map(cellKey));
      next.set(e.id, { entity: e, keys });
      for (const k of keys) nextCovers.set(k, (nextCovers.get(k) ?? 0) + 1);
    }
    const before = covers;
    rasterised = next;
    covers = nextCovers;
    const was = (k: CellKey) => before.has(k) || tileWalls.has(k);
    setWalls(was, before.keys());
    setWalls(was, nextCovers.keys());
  }

  function clear(): void {
    current?.occupancy.clear();
    current = null;
    walled = null;
    own = null;
    rasterised = new Map();
    covers = new Map();
    maps = new Map();
    pending.clear();
    tileWalls = new Set();
    tileCosts = new Map();
  }

  return {
    get current() {
      return current;
    },
    load(scene) {
      clear();
      const settings = scene.settings.grid;
      if (!settings) return;
      const geometry = gridGeometry(settings);
      const occupancy = createKeyedOccupancy();
      walled = occupancy;
      own = geometry.rect(scene.bounds);
      const grid: RuntimeGrid = {
        geometry,
        occupancy,
        bounds: own,
        passable: (c) =>
          inCellBounds(grid.bounds, c) && !occupancy.wall(c) && !occupancy.blocked(c),
        cost: (_from, to) => tileCosts.get(cellKey(to)) ?? 0,
      };
      current = grid;
      syncWalls(grid, scene);
      ctx.behavior<OccupantSystem>(OCCUPANT.name)?.resync();
    },
    sync(scene) {
      if (!current) return;
      if (!scene) {
        clear();
        return;
      }
      syncWalls(current, scene);
      syncMaps(current, scene);
    },
    tileChunksChanged(id, chunks) {
      if (!current) return;
      let keys = pending.get(id);
      if (!keys) pending.set(id, (keys = new Set()));
      for (const k of chunks) keys.add(k);
    },
    tilesChanged() {
      if (!current) return;
      const touched = new Set<CellKey>();
      readPending(touched);
      settle(touched);
    },
    tilesLoaded(scene) {
      if (current) readAll(current, scene);
    },
    clear,
    extend(rects) {
      if (!current || !own) return;
      let { c0, r0, c1, r1 } = own;
      for (const rect of rects) {
        const b = current.geometry.rect(rect);
        c0 = Math.min(c0, b.c0);
        r0 = Math.min(r0, b.r0);
        c1 = Math.max(c1, b.c1);
        r1 = Math.max(r1, b.r1);
      }
      current.bounds = { c0, r0, c1, r1 };
    },
  };
}

/** No runtime, so no behavior systems: nothing occupies a cell, and walls are the only blocks. */
const NO_RUNTIME = { behavior: () => undefined } as unknown as EngineContext;

/**
 * The scene's grid outside a runtime, rasterised as a load does: walls from
 * `wallTypes` (default `gridWallTypes(registry)`), no occupants.
 */
export function sceneGrid(
  scene: ExpandedScene,
  registry: Registry,
  wallTypes?: readonly string[],
): RuntimeGrid | null {
  const state = createGridState(
    NO_RUNTIME,
    registry,
    wallTypes === undefined ? undefined : new Set(wallTypes),
  );
  state.load(scene);
  return state.current;
}

/** The `grid-invalid` issue for a scene with no grid; `what` ends the message: "to draw", "for check x to find paths on". */
export function gridMissingIssue(sceneName: string, what: string): SceneIssue {
  return makeIssue("grid-invalid", {
    message: `scene "${sceneName}" has no settings.grid ${what}`,
    path: "/settings/grid",
    hint: 'Give the scene a grid, e.g. `settings.grid: { "kind": "square", "cell": [0.32, 0.32] }`.',
  });
}

/** A cell, or an entity's cell: the one its spawn pose falls in. */
export type GridPlace = { label: string; cell: Cell; ref?: string; at: Pt };

const fmtCell = ([c, r]: Cell) => `[${c}, ${r}]`;
const isCell = (p: Cell | RuntimeEntity): p is Cell => Array.isArray(p);

export function gridPlace(
  grid: RuntimeGrid,
  registry: Registry,
  place: Cell | RuntimeEntity,
): GridPlace {
  if (isCell(place)) return { label: fmtCell(place), cell: place, at: grid.geometry.center(place) };
  const { x, y } = spawnPose(place, registry);
  const cell = grid.geometry.cellAt([x, y]);
  return { label: `${place.id} ${fmtCell(cell)}`, cell, ref: place.id, at: [x, y] };
}

/** A path over the grid's passable cells within its bounds, or null; none from a blocked start. */
export function gridRoute(
  grid: RuntimeGrid,
  from: Cell,
  to: Cell,
  diagonals: boolean,
): GridPath | null {
  if (!grid.passable(from)) return null;
  const { c0, r0, c1, r1 } = grid.bounds;
  return findPath(grid.geometry, from, to, {
    passable: (c) => grid.passable(c),
    cost: (f, t) => grid.cost?.(f, t) ?? 0,
    diagonals,
    bounds: grid.bounds,
    maxExpanded: Math.max(1, (c1 - c0 + 1) * (r1 - r0 + 1)),
  });
}
