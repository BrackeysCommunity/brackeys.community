import type { Viewport } from "../../../camera";
import { gridOverlayPlan, type GridOverlayPlan } from "../../../debug/grid-overlay";
import type { Registry } from "../../../game/types";
import { gridGeometry } from "../../../grid/geometry";
import { buildNavMesh } from "../../../nav/navmesh";
import type { RuntimeGrid } from "../../../runtime/grid";
import { SCENE_GRID_MAX_CELLS } from "../../../scene/render-geometry";
import type { Bounds, ExpandedScene, Pt, ShapeObj } from "../../../scene/types";
import type { View } from "./view";

/** The edit overlay's optional layers, each toggled from the toolbar's View menu. */
export type EditLayer = "grid" | "occupancy" | "nav";

export type EditLayers = Readonly<Record<EditLayer, boolean>>;

export const EDIT_LAYERS: readonly { id: EditLayer; label: string; description: string }[] = [
  { id: "grid", label: "Grid", description: "The scene grid's cells, else a line every metre" },
  { id: "occupancy", label: "Occupancy", description: "The grid cells the game's walls fill" },
  { id: "nav", label: "Nav", description: "The walk areas, their holes and the nav mesh" },
];

/** Every layer off: the overlay's default. */
export const NO_EDIT_LAYERS: EditLayers = { grid: false, occupancy: false, nav: false };

/** Stored layer flags over the defaults; null when `v` holds none of them. */
export function parseEditLayers(v: unknown): EditLayers | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const stored = v as Record<string, unknown>;
  const out = { ...NO_EDIT_LAYERS };
  let any = false;
  for (const { id } of EDIT_LAYERS) {
    const flag = stored[id];
    if (typeof flag !== "boolean") continue;
    out[id] = flag;
    any = true;
  }
  return any ? out : null;
}

/** The world rectangle the view shows, metres. */
export function viewViewport(view: View): Viewport {
  const scale = view.scale || 1;
  return {
    x: -view.tx / scale + 0,
    y: -view.ty / scale + 0,
    width: view.width / scale,
    height: view.height / scale,
  };
}

const boundsOf = ({ x, y, width, height }: Viewport): Bounds => [x, y, x + width, y + height];

/**
 * The scene grid's cell lines (or hex outlines) over the view, by the debug
 * overlay's rule: without a scene grid, a line every metre and a major one
 * every ten. The region stops at the major lines just past the view, and a
 * hex grid outlines at most `SCENE_GRID_MAX_CELLS` cells.
 */
export function gridLayerPlan(scene: ExpandedScene | null, view: View): GridOverlayPlan | null {
  if (!(view.scale > 0) || !Number.isFinite(view.scale)) return null;
  const settings = scene?.settings.grid ?? null;
  return gridOverlayPlan(viewViewport(view), view.scale, settings ? gridGeometry(settings) : null, {
    margin: 0,
    maxCells: SCENE_GRID_MAX_CELLS,
  });
}

/** The wall cells over the view, as outlines; `truncated` when the cap left some out. */
export type WallCells = { cells: Pt[][]; truncated: boolean };

/** Cells looked at past which a view is too dense to scan: the walls drawn come from the part scanned. */
const MAX_SCANNED = 65_536;

/**
 * The wall cells of `grid` (`sceneGrid`: walls from the game's
 * `world.gridWalls`, rasterised as a load does it) inside the view and the
 * scene bounds, row by row, at most `max`.
 */
export function wallCells(
  grid: RuntimeGrid | null,
  view: View,
  max = SCENE_GRID_MAX_CELLS,
): WallCells {
  const out: WallCells = { cells: [], truncated: false };
  if (!grid || !(view.scale > 0)) return out;
  const shown = grid.geometry.rect(boundsOf(viewViewport(view)));
  const c0 = Math.max(shown.c0, grid.bounds.c0);
  const r0 = Math.max(shown.r0, grid.bounds.r0);
  const c1 = Math.min(shown.c1, grid.bounds.c1);
  const r1 = Math.min(shown.r1, grid.bounds.r1);
  let scanned = 0;
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      if (++scanned > MAX_SCANNED) {
        out.truncated = true;
        return out;
      }
      if (!grid.occupancy.wall([c, r])) continue;
      if (out.cells.length >= max) {
        out.truncated = true;
        return out;
      }
      out.cells.push(grid.geometry.corners([c, r]));
    }
  }
  return out;
}

/** The scene's walk areas, the holes cut from them, and the mesh the runtime's `ctx.nav` walks. */
export type NavLayer = {
  areas: (readonly Pt[])[];
  holes: (readonly Pt[])[];
  triangles: readonly (readonly [Pt, Pt, Pt])[];
};

/** Whether entities of `type` are nav polygons: the `nav` primitive, or a type based on it. */
const isNavType = (registry: Registry, name: string) => {
  const type = registry.types.get(name);
  return type !== undefined && (type.base ?? type.type) === "nav";
};

/** The nav entities' polygons, and the mesh over them as the runtime builds it. */
export function navLayer(scene: ExpandedScene, registry: Registry): NavLayer {
  const areas: { id: string; pts: readonly Pt[] }[] = [];
  const holes: { id: string; pts: readonly Pt[] }[] = [];
  for (const e of scene.entities) {
    if (!isNavType(registry, e.type)) continue;
    const shape = e.shape as ShapeObj | undefined;
    if (shape?.type !== "poly") continue;
    (e.mode === "block" ? holes : areas).push({ id: e.id, pts: shape.pts });
  }
  const triangles = areas.length > 0 ? buildNavMesh(areas, holes).mesh.triangles : [];
  return { areas: areas.map((a) => a.pts), holes: holes.map((h) => h.pts), triangles };
}
