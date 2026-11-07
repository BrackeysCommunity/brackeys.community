import type { SceneView, ViewLayer, ViewLayerHandle } from "../../context";
import type { Style } from "../../game/types";
import type { ShapeObj } from "../../scene/types";

export type ViewCall =
  | { op: "draw"; id: string; shape: ShapeObj; style: Style; layer: ViewLayer }
  | { op: "pose"; id: string; x: number; y: number; rot: number }
  | { op: "remove"; id: string };

export type LiveVisual = {
  shape: ShapeObj;
  style: Style;
  layer: ViewLayer;
  pose: { x: number; y: number; rot: number };
};

/** A `SceneView` that records every call and keeps what is drawn now. */
export function recordingView(): {
  view: SceneView;
  calls: ViewCall[];
  live: Map<string, LiveVisual>;
  callsFor: (id: string, op?: ViewCall["op"]) => ViewCall[];
} {
  const calls: ViewCall[] = [];
  const live = new Map<string, LiveVisual>();
  const view: SceneView = {
    draw(id, shape, style, layer) {
      calls.push({ op: "draw", id, shape, style, layer });
      const pose = live.get(id)?.pose ?? { x: 0, y: 0, rot: 0 };
      live.set(id, { shape, style, layer, pose });
    },
    pose(id, x, y, rot = 0) {
      calls.push({ op: "pose", id, x, y, rot });
      const visual = live.get(id);
      if (visual) visual.pose = { x, y, rot };
    },
    remove(id) {
      calls.push({ op: "remove", id });
      live.delete(id);
    },
    layer: () => ({ __viewLayer: true }) as ViewLayerHandle,
  };
  const callsFor = (id: string, op?: ViewCall["op"]) =>
    calls.filter((c) => c.id === id && (op === undefined || c.op === op));
  return { view, calls, live, callsFor };
}
