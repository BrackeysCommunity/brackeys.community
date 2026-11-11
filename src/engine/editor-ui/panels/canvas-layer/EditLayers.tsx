import { Store } from "@tanstack/store";
import { useCallback, type CSSProperties } from "react";

import type { GridOverlayPlan, GridSegment } from "../../../debug/grid-overlay";
import type { EditorSession } from "../../../editor/index";
import { gridWallTypes, sceneGrid, type RuntimeGrid } from "../../../runtime/grid";
import { navPolygonsOf } from "../../../runtime/nav";
import { expandScene } from "../../../scene/expand";
import type { ExpandedScene } from "../../../scene/types";
import { STORAGE_PREFIX } from "../../host";
import { useKit } from "../../kit/index";
import { readStored, writeStored } from "../../session/stored";
import { useEditorDoc, useEditorPrefabs } from "../../session/use-editor-store";
import { useStoreValue } from "../../session/use-store-value";
import {
  gridLayerPlan,
  gridTooDense,
  navMeshLayer,
  NO_EDIT_LAYERS,
  parseEditLayers,
  unavailableLayers,
  wallCells,
  type EditLayer,
  type EditLayers as EditLayerFlags,
  type NavLayer,
  type WallCells,
} from "./edit-layers";
import { polylinePath, worldNum, type View } from "./view";

export const EDIT_LAYERS_KEY = `${STORAGE_PREFIX}view-layers`;

const layerStores = new WeakMap<EditorSession, Store<EditLayerFlags>>();

/**
 * The View menu's layer flags for `session`, shared by the toolbar and the
 * canvas layer, and remembered per viewer; every layer starts off.
 */
export function useEditLayers(
  session: EditorSession,
): [EditLayerFlags, (layer: EditLayer, on: boolean) => void] {
  const { storage } = useKit();
  let store = layerStores.get(session);
  if (!store) {
    store = new Store(readStored(storage, EDIT_LAYERS_KEY, NO_EDIT_LAYERS, parseEditLayers));
    layerStores.set(session, store);
  }
  const flags = useStoreValue(store, (s) => s);
  const target = store;
  const set = useCallback(
    (layer: EditLayer, on: boolean) => {
      target.setState((s) => ({ ...s, [layer]: on }));
      writeStored(storage, EDIT_LAYERS_KEY, target.state);
    },
    [target, storage],
  );
  return [flags, set];
}

type ExpandedEntry = {
  def: ReturnType<EditorSession["getDoc"]>;
  prefabs: ReturnType<EditorSession["getPrefabs"]>;
  scene: ExpandedScene | null;
};

const expandedScenes = new WeakMap<EditorSession, ExpandedEntry>();

/** `def` expanded over `prefabs`, once per document and library for every caller of the session. */
function expandedSceneOf(
  session: EditorSession,
  def: ExpandedEntry["def"],
  prefabs: ExpandedEntry["prefabs"],
): ExpandedScene | null {
  const hit = expandedScenes.get(session);
  if (hit && hit.def === def && hit.prefabs === prefabs) return hit.scene;
  let scene: ExpandedScene | null = null;
  try {
    scene = expandScene(def, session.registry, { prefabs });
  } catch {
    scene = null;
  }
  expandedScenes.set(session, { def, prefabs, scene });
  return scene;
}

/** The session's document as the runtime would load it; null while it doesn't expand. */
export function useExpandedScene(session: EditorSession): ExpandedScene | null {
  const def = useEditorDoc(session);
  const prefabs = useEditorPrefabs(session);
  return expandedSceneOf(session, def, prefabs);
}

/** One derived value per session, rebuilt only when its key changes. */
function keyedCache<T>() {
  const cache = new WeakMap<EditorSession, { key: string; value: T }>();
  return (session: EditorSession, key: string, build: () => T): T => {
    const hit = cache.get(session);
    if (hit?.key === key) return hit.value;
    const value = build();
    cache.set(session, { key, value });
    return value;
  };
}

const gridCache = keyedCache<RuntimeGrid | null>();
const navCache = keyedCache<NavLayer>();

/** The scene grid with its walls, rasterised again only when the grid, the bounds or a wall changes. */
function occupancyGrid(session: EditorSession, scene: ExpandedScene): RuntimeGrid | null {
  if (!scene.settings.grid) return null;
  const walls = gridWallTypes(session.registry);
  const key = JSON.stringify([
    scene.settings.grid,
    scene.bounds,
    scene.entities.filter((e) => walls.has(e.type)),
  ]);
  return gridCache(session, key, () => sceneGrid(scene, session.registry));
}

/** The nav layer, triangulated again only when an area or hole changes. */
function navOf(session: EditorSession, scene: ExpandedScene): NavLayer {
  const { areas, holes } = navPolygonsOf(scene.entities, session.registry);
  return navCache(session, JSON.stringify([areas, holes]), () => navMeshLayer(areas, holes));
}

/** What the View menu's layers draw for one view, and the notes on what they leave out. */
export type EditLayerDrawing = {
  grid: GridOverlayPlan | null;
  walls: WallCells | null;
  nav: NavLayer | null;
  notes: string[];
};

/**
 * The layers turned on for `session`, drawn from `scene` over `view`; null
 * while every layer is off. Without a scene grid, the grid is the snapping
 * `step`'s.
 */
export function useEditLayerDrawing(
  session: EditorSession,
  scene: ExpandedScene | null,
  view: View,
  step: number | null,
): EditLayerDrawing | null {
  const [layers] = useEditLayers(session);
  if (!layers.grid && !layers.occupancy && !layers.nav) return null;
  const missing = unavailableLayers(scene, session.registry);
  const notes: string[] = [];
  let grid: GridOverlayPlan | null = null;
  let walls: WallCells | null = null;
  let nav: NavLayer | null = null;
  if (layers.grid) {
    grid = gridLayerPlan(scene, view, step);
    if (grid && gridTooDense(grid)) notes.push("Grid: zoom in to see every cell");
  }
  if (layers.occupancy) {
    if (missing.occupancy) notes.push(`Occupancy: ${missing.occupancy}`);
    else if (scene) {
      walls = wallCells(occupancyGrid(session, scene), view);
      if (walls.truncated) notes.push("Occupancy: zoom in to see every wall");
    }
  }
  if (layers.nav) {
    if (missing.nav) notes.push(`Nav: ${missing.nav}`);
    else if (scene) nav = navOf(session, scene);
  }
  return { grid, walls, nav, notes };
}

const segmentsPath = (segments: readonly GridSegment[]) =>
  segments
    .map(([x1, y1, x2, y2]) => `M${worldNum(x1)} ${worldNum(y1)} L${worldNum(x2)} ${worldNum(y2)}`)
    .join(" ");

const outlinesPath = (outlines: readonly (readonly (readonly [number, number])[])[]) =>
  outlines.map((pts) => polylinePath(pts, true)).join(" ");

function GridLines({ plan }: { plan: GridOverlayPlan }) {
  const axes = [plan.axisX, plan.axisY].filter((a) => a !== null);
  return (
    <g data-edit-layer="grid" fill="none" style={{ stroke: "var(--je-panel-fg)" }}>
      {plan.minor.length > 0 || plan.cells.length > 0 ? (
        <path
          data-grid-minor=""
          d={`${segmentsPath(plan.minor)} ${outlinesPath(plan.cells)}`.trim()}
          strokeWidth={1}
          strokeOpacity={0.12}
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      {plan.major.length > 0 ? (
        <path
          data-grid-major=""
          d={segmentsPath(plan.major)}
          strokeWidth={1}
          strokeOpacity={0.28}
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      {axes.length > 0 ? (
        <path
          data-grid-axes=""
          d={segmentsPath(axes)}
          strokeWidth={1.5}
          strokeOpacity={0.4}
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
    </g>
  );
}

function OccupancyCells({ walls: { cells, truncated } }: { walls: WallCells }) {
  if (cells.length === 0) return null;
  return (
    <g data-edit-layer="occupancy" data-truncated={truncated ? "" : undefined}>
      <path
        data-occupancy-walls=""
        d={outlinesPath(cells)}
        style={{ fill: "var(--je-danger)", stroke: "var(--je-danger)" }}
        fillOpacity={0.22}
        strokeOpacity={0.5}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
    </g>
  );
}

function NavMesh({ nav }: { nav: NavLayer }) {
  if (nav.areas.length === 0 && nav.holes.length === 0) return null;
  return (
    <g data-edit-layer="nav" style={{ stroke: "var(--je-success)" }}>
      <path
        data-nav-mesh=""
        d={outlinesPath(nav.triangles)}
        style={{ fill: "var(--je-success)" }}
        fillOpacity={0.12}
        strokeOpacity={0.35}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
      <path
        data-nav-areas=""
        d={outlinesPath(nav.areas)}
        fill="none"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />
      {nav.holes.length > 0 ? (
        <path
          data-nav-holes=""
          d={outlinesPath(nav.holes)}
          fill="none"
          strokeWidth={2}
          strokeDasharray="6 4"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
    </g>
  );
}

/**
 * The layers the View menu turns on, under the tools' marks: the scene
 * grid's cells, the wall cells the game's grid holds, and the nav walk
 * areas with their mesh. Drawn from the committed document.
 */
export function EditLayers({
  drawing,
  transform,
}: {
  drawing: EditLayerDrawing | null;
  /** The world group's transform. */
  transform: string;
}) {
  if (!drawing) return null;
  return (
    <g data-edit-layers="" transform={transform}>
      {drawing.walls ? <OccupancyCells walls={drawing.walls} /> : null}
      {drawing.nav ? <NavMesh nav={drawing.nav} /> : null}
      {drawing.grid ? <GridLines plan={drawing.grid} /> : null}
    </g>
  );
}

const NOTES_STYLE: CSSProperties = {
  position: "absolute",
  top: 12,
  left: "50%",
  transform: "translateX(-50%)",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 4,
  pointerEvents: "none",
};

/** What the shown layers leave out, along the canvas's top edge. */
export function EditLayerNotes({ drawing }: { drawing: EditLayerDrawing | null }) {
  if (!drawing || drawing.notes.length === 0) return null;
  return (
    <div data-edit-layer-notes="" style={NOTES_STYLE}>
      {drawing.notes.map((note) => (
        <span
          key={note}
          className="je-canvas-tag"
          data-tone="readout"
          style={{ position: "static" }}
        >
          {note}
        </span>
      ))}
    </div>
  );
}
