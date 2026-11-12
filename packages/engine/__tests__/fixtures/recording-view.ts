import type { SceneView, SpriteVisual, ViewLayer, ViewLayerHandle } from "../../context";
import type { Style } from "../../game/types";
import type { ShapeObj } from "../../scene/types";

export type ViewCall =
  | { op: "draw"; id: string; shape: ShapeObj; style: Style; layer: ViewLayer }
  | { op: "pose"; id: string; x: number; y: number; rot: number; snap?: boolean }
  | { op: "remove"; id: string }
  | { op: "sprite"; id: string; visual: SpriteVisual; layer: ViewLayer }
  | { op: "depth"; id: string; z: number };

export type LiveVisual = {
  shape: ShapeObj;
  style: Style;
  layer: ViewLayer;
  pose: { x: number; y: number; rot: number };
  /** Set when drawn through `sprite`. */
  sprite?: SpriteVisual;
  depth?: number;
};

export type RecordingViewOptions = {
  /** Give the view `sprite` and `depth`; without, sprites reach it as their fallback boxes. */
  sprites?: boolean;
};

/** A `SceneView` that records every call and keeps what is drawn now. */
export function recordingView(opts: RecordingViewOptions = {}): {
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
    pose(id, x, y, rot = 0, snap) {
      calls.push(
        opts.sprites && snap !== undefined
          ? { op: "pose", id, x, y, rot, snap }
          : { op: "pose", id, x, y, rot },
      );
      const visual = live.get(id);
      if (visual) visual.pose = { x, y, rot };
    },
    remove(id) {
      calls.push({ op: "remove", id });
      live.delete(id);
    },
    layer: () => ({ __viewLayer: true }) as ViewLayerHandle,
  };
  if (opts.sprites) {
    view.sprite = (id, visual, layer) => {
      calls.push({ op: "sprite", id, visual, layer });
      const prior = live.get(id);
      live.set(id, {
        shape: visual.fallback.shape,
        style: visual.fallback.style,
        layer,
        pose: prior?.pose ?? { x: 0, y: 0, rot: 0 },
        sprite: visual,
        ...(prior?.depth !== undefined ? { depth: prior.depth } : {}),
      });
    };
    view.depth = (id, z) => {
      calls.push({ op: "depth", id, z });
      const visual = live.get(id);
      if (visual) visual.depth = z;
    };
  }
  const callsFor = (id: string, op?: ViewCall["op"]) =>
    calls.filter((c) => c.id === id && (op === undefined || c.op === op));
  return { view, calls, live, callsFor };
}
