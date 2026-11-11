import { OCCUPANT } from "../game/behaviors/occupant";
import type { EngineContext, Registry } from "../game/types";
import {
  cellKey,
  cellOf,
  gridGeometry,
  inCellBounds,
  type Cell,
  type CellBounds,
  type CellKey,
  type GridGeometry,
} from "../grid/geometry";
import { createOccupancy, type Occupancy } from "../grid/occupancy";
import { findPath, type GridPath } from "../grid/path";
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
};

/** The runtime's grid across loads: built at load, kept in step with edits, gone at unload. */
export type GridState = {
  readonly current: RuntimeGrid | null;
  /** At a load, before anything spawns: walls come from the scene's entities. */
  load(scene: ExpandedScene): void;
  /** After each batch of adds, updates and removes. */
  sync(scene: ExpandedScene | null): void;
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

/**
 * The grid state for a runtime: the geometry from the scene's resolved
 * `settings.grid`, walls on the cells whose centre a wall type's shape
 * holds (`wallTypes`, default `gridWallTypes(registry)`), and the
 * scene bounds in cells. Walls follow the scene's entities after each
 * reconcile batch; walls game code set itself stay unless an entity's wall
 * on that cell goes.
 */
export function createGridState(
  ctx: EngineContext,
  registry: Registry,
  wallTypes: ReadonlySet<EntityTypeName> = gridWallTypes(registry),
): GridState {
  let current: RuntimeGrid | null = null;
  /** The loaded scene's bounds in cells, before any `extend`. */
  let own: CellBounds | null = null;
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
    own = null;
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
      own = geometry.rect(scene.bounds);
      const grid: RuntimeGrid = {
        geometry,
        occupancy,
        bounds: own,
        passable: (c) =>
          inCellBounds(grid.bounds, c) && !occupancy.wall(c) && !occupancy.blocked(c),
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
    diagonals,
    bounds: grid.bounds,
    maxExpanded: Math.max(1, (c1 - c0 + 1) * (r1 - r0 + 1)),
  });
}
