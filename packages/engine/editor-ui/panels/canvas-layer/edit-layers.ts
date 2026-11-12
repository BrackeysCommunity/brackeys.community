import type { Viewport } from "../../../camera";
import { gridOverlayPlan, type GridOverlayPlan } from "../../../debug/grid-overlay";
import type { Registry } from "../../../game/types";
import { gridGeometry } from "../../../grid/geometry";
import { buildNavMesh } from "../../../nav/navmesh";
import type { RuntimeGrid } from "../../../runtime/grid";
import { navPolygonsOf } from "../../../runtime/nav";
import { SCENE_GRID_MAX_CELLS } from "../../../scene/render-geometry";
import type { Bounds, ExpandedScene, Pt } from "../../../scene/types";
import type { NavPolygon } from "../../../systems/nav";
import type { View } from "./view";

/** The edit overlay's optional layers, each toggled from the toolbar's View menu. */
export type EditLayer = "grid" | "occupancy" | "nav";

export type EditLayers = Readonly<Record<EditLayer, boolean>>;

export const EDIT_LAYERS: readonly { id: EditLayer; label: string; description: string }[] = [
  { id: "grid", label: "Grid", description: "The scene grid's cells, else the snapping step's" },
  { id: "occupancy", label: "Occupancy", description: "The grid cells the game's walls fill" },
  { id: "nav", label: "Nav", description: "The walk areas, their holes and the nav mesh" },
];

/** Why each layer would draw nothing in `scene`; a layer that can draw has no entry. */
export function unavailableLayers(
  scene: ExpandedScene | null,
  registry: Registry,
): Partial<Record<EditLayer, string>> {
  if (!scene) return {};
  const out: Partial<Record<EditLayer, string>> = {};
  if (!scene.settings.grid) out.occupancy = "Needs settings.grid";
  if (navPolygonsOf(scene.entities, registry).areas.length === 0) out.nav = "No nav areas";
  return out;
}

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
 * overlay's rule. Without a scene grid, a line every `step` metres (the
 * snapping step; the overlay's metre without one) and a major one every
 * ten. The region stops at the major lines just past the view, and a hex
 * grid outlines at most `SCENE_GRID_MAX_CELLS` cells.
 */
export function gridLayerPlan(
  scene: ExpandedScene | null,
  view: View,
  step: number | null = null,
): GridOverlayPlan | null {
  if (!(view.scale > 0) || !Number.isFinite(view.scale)) return null;
  const settings =
    scene?.settings.grid ??
    (step !== null && step > 0
      ? { kind: "square" as const, cell: [step, step] as [number, number] }
      : null);
  return gridOverlayPlan(viewViewport(view), view.scale, settings ? gridGeometry(settings) : null, {
    margin: 0,
    maxCells: SCENE_GRID_MAX_CELLS,
  });
}

/** Whether `plan` leaves cells out because the view is too far out to draw them. */
export const gridTooDense = (plan: GridOverlayPlan): boolean =>
  plan.minor.length === 0 && plan.cells.length === 0;

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

/** The mesh the runtime builds over `areas` and `holes`, with their outlines. */
export function navMeshLayer(areas: readonly NavPolygon[], holes: readonly NavPolygon[]): NavLayer {
  const triangles = areas.length > 0 ? buildNavMesh(areas, holes).mesh.triangles : [];
  return { areas: areas.map((a) => a.pts), holes: holes.map((h) => h.pts), triangles };
}

/** The scene's nav polygons, picked and ordered as the runtime's `ctx.nav` reads them, and the mesh over them. */
export function navLayer(scene: ExpandedScene, registry: Registry): NavLayer {
  const { areas, holes } = navPolygonsOf(scene.entities, registry);
  return navMeshLayer(areas, holes);
}
