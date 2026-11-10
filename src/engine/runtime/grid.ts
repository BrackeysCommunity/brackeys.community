import { OCCUPANT } from "../game/behaviors/occupant";
import type { EngineContext, Registry } from "../game/types";
import {
  cellKey,
  cellOf,
  gridGeometry,
  type Cell,
  type CellBounds,
  type CellKey,
  type GridGeometry,
} from "../grid/geometry";
import { createOccupancy, type Occupancy } from "../grid/occupancy";
import { geometryFields } from "../scene/schema";
import { translateShape } from "../scene/shape-geometry";
import type { ExpandedScene, PathDef, RuntimeEntity, ShapeObj } from "../scene/types";
import type { OccupantSystem } from "./behaviors/occupant";

/** The loaded scene's grid: present when its resolved settings have one. */
export type RuntimeGrid = {
  geometry: GridGeometry;
  occupancy: Occupancy;
  /** The scene bounds in cells. */
  bounds: CellBounds;
  /** In bounds, not a wall, not blocked. */
  passable(c: Cell): boolean;
};

/** The runtime's grid across loads: built at load, kept in step with edits, gone at unload. */
export type GridState = {
  readonly current: RuntimeGrid | null;
  /** At the end of a load. */
  load(scene: ExpandedScene): void;
  /** After each batch of adds, updates and removes. */
  sync(scene: ExpandedScene | null): void;
  /** At unload. */
  clear(): void;
};

const DEFAULT_GRID_WALLS = ["solid"] as const;

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

/**
 * The grid state for a runtime: the geometry from the scene's resolved
 * `settings.grid`, walls on the cells whose centre a wall type's shape
 * holds (`GameDefinition.world.gridWalls`, default `["solid"]`), and the
 * scene bounds in cells. Walls follow the scene's entities after each
 * reconcile batch; walls game code set itself stay unless an entity's wall
 * on that cell goes.
 */
export function createGridState(ctx: EngineContext, registry: Registry): GridState {
  const wallTypes: ReadonlySet<string> = new Set(
    registry.game?.world?.gridWalls ?? DEFAULT_GRID_WALLS,
  );
  let current: RuntimeGrid | null = null;
  /** Per wall entity, the entity as last rasterised and the wall cells it gave. */
  let rasterised = new Map<string, { entity: RuntimeEntity; keys: readonly CellKey[] }>();
  /** How many wall entities cover each wall cell. */
  let covers = new Map<CellKey, number>();

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
    for (const k of covers.keys()) if (!nextCovers.has(k)) grid.occupancy.setWall(cellOf(k), false);
    for (const k of nextCovers.keys()) if (!covers.has(k)) grid.occupancy.setWall(cellOf(k), true);
    rasterised = next;
    covers = nextCovers;
  }

  function clear(): void {
    current?.occupancy.clear();
    current = null;
    rasterised = new Map();
    covers = new Map();
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
      const occupancy = createOccupancy();
      const bounds = geometry.rect(scene.bounds);
      const grid: RuntimeGrid = {
        geometry,
        occupancy,
        bounds,
        passable: (c) =>
          c[0] >= bounds.c0 &&
          c[0] <= bounds.c1 &&
          c[1] >= bounds.r0 &&
          c[1] <= bounds.r1 &&
          !occupancy.wall(c) &&
          !occupancy.blocked(c),
      };
      current = grid;
      syncWalls(grid, scene);
      ctx.behavior<OccupantSystem>(OCCUPANT.name)?.resync();
    },
    sync(scene) {
      if (!current) return;
      if (!scene) clear();
      else syncWalls(current, scene);
    },
    clear,
  };
}

/** No runtime, so no behavior systems: nothing occupies a cell, and walls are the only blocks. */
const NO_RUNTIME = { behavior: () => undefined } as unknown as EngineContext;

/**
 * The scene's grid outside a runtime, rasterised as a load does: walls from
 * `wallTypes` (default the game's `world.gridWalls`, else `["solid"]`), no occupants.
 */
export function sceneGrid(
  scene: ExpandedScene,
  registry: Registry,
  wallTypes?: readonly string[],
): RuntimeGrid | null {
  const walls =
    wallTypes === undefined
      ? registry
      : (Object.create(registry, {
          game: {
            value: { ...registry.game, world: { ...registry.game?.world, gridWalls: wallTypes } },
          },
        }) as Registry);
  const state = createGridState(NO_RUNTIME, walls);
  state.load(scene);
  return state.current;
}
