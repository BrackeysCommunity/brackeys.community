import { Store } from "@tanstack/store";
import { useCallback, useMemo } from "react";

import type { GridSegment } from "../../../debug/grid-overlay";
import type { EditorSession } from "../../../editor/index";
import { sceneGrid } from "../../../runtime/grid";
import { expandScene } from "../../../scene/expand";
import type { ExpandedScene } from "../../../scene/types";
import { STORAGE_PREFIX } from "../../host";
import { useKit } from "../../kit/index";
import { readStored, writeStored } from "../../session/stored";
import { useEditorDoc, useEditorPrefabs } from "../../session/use-editor-store";
import { useStoreValue } from "../../session/use-store-value";
import {
  gridLayerPlan,
  navLayer,
  NO_EDIT_LAYERS,
  parseEditLayers,
  wallCells,
  type EditLayer,
  type EditLayers as EditLayerFlags,
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

/** The session's document as the runtime would load it; null while it doesn't expand. */
export function useExpandedScene(session: EditorSession): ExpandedScene | null {
  const def = useEditorDoc(session);
  const prefabs = useEditorPrefabs(session);
  return useMemo(() => {
    try {
      return expandScene(def, session.registry, { prefabs });
    } catch {
      return null;
    }
  }, [def, prefabs, session]);
}

const segmentsPath = (segments: readonly GridSegment[]) =>
  segments
    .map(([x1, y1, x2, y2]) => `M${worldNum(x1)} ${worldNum(y1)} L${worldNum(x2)} ${worldNum(y2)}`)
    .join(" ");

const outlinesPath = (outlines: readonly (readonly (readonly [number, number])[])[]) =>
  outlines.map((pts) => polylinePath(pts, true)).join(" ");

function GridLines({ scene, view }: { scene: ExpandedScene | null; view: View }) {
  const plan = gridLayerPlan(scene, view);
  if (!plan) return null;
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

function OccupancyCells({
  session,
  scene,
  view,
}: {
  session: EditorSession;
  scene: ExpandedScene | null;
  view: View;
}) {
  const grid = useMemo(() => (scene ? sceneGrid(scene, session.registry) : null), [scene, session]);
  const { cells, truncated } = wallCells(grid, view);
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

function NavMesh({ session, scene }: { session: EditorSession; scene: ExpandedScene | null }) {
  const nav = useMemo(() => (scene ? navLayer(scene, session.registry) : null), [scene, session]);
  if (!nav || (nav.areas.length === 0 && nav.holes.length === 0)) return null;
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
  session,
  view,
  transform,
}: {
  session: EditorSession;
  view: View;
  /** The world group's transform. */
  transform: string;
}) {
  const [layers] = useEditLayers(session);
  const any = layers.grid || layers.occupancy || layers.nav;
  return any ? (
    <ShownLayers session={session} view={view} transform={transform} layers={layers} />
  ) : null;
}

/** Split out so the scene is expanded only while a layer is on. */
function ShownLayers({
  session,
  view,
  transform,
  layers,
}: {
  session: EditorSession;
  view: View;
  transform: string;
  layers: EditLayerFlags;
}) {
  const scene = useExpandedScene(session);
  return (
    <g data-edit-layers="" transform={transform}>
      {layers.occupancy ? <OccupancyCells session={session} scene={scene} view={view} /> : null}
      {layers.nav ? <NavMesh session={session} scene={scene} /> : null}
      {layers.grid ? <GridLines scene={scene} view={view} /> : null}
    </g>
  );
}
