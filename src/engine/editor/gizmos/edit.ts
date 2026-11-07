import { isConvex } from "../../scene/shape-geometry";
import type { OpBatch, Pt, ShapeObj } from "../../scene/types";
import { snapMove, type SnapGuide } from "../snap";
import type { SnapSettings, SpatialIndex, ToolModifiers } from "../tools";
import { roundShape, shapeBatch } from "./batch";
import { readShapeSize } from "./readout";
import type { GizmoTarget } from "./target";

export type DragOptions = {
  /** Shift keeps aspect or rotates freely, Alt works from the centre, mod (Ctrl/Cmd) bypasses snapping. */
  mods: ToolModifiers;
  snap: SnapSettings;
  /** Screen px per world px. */
  scale: number;
  /** Other entities, for geometry snapping of moves, vertices and waypoints. */
  index?: SpatialIndex;
};

/** What one gizmo gesture does so far: preview it while dragging, commit `batch` at pointer-up. */
export type GizmoEdit = {
  /** The whole gesture as one batch, rounded to whole px; `null` when it changes nothing. */
  batch: OpBatch | null;
  /** The drag readout: `Δ 64, 0`, `W 160 H 16`, `37°`. */
  readout: string;
  /** The shape as the batch commits it, world px. */
  shape?: ShapeObj;
  /** A point entity's position as the batch commits it. */
  at?: Pt;
  /** A path's waypoints as the batch commits them. */
  pts?: Pt[];
  /**
   * The edit leaves a poly non-convex. It still commits; afterwards offer
   * **Convert to chain** (`convertToChainFix`).
   */
  concave?: boolean;
  guides?: SnapGuide[];
};

/** A gesture that gives `t` the world shape `world`, rounded as it will commit. */
export function shapeEdit(
  t: GizmoTarget,
  world: ShapeObj,
  label: string,
  readout = readShapeSize(roundShape(world)),
): GizmoEdit {
  const shape = roundShape(world);
  return {
    batch: shapeBatch(t, world, label),
    readout,
    shape,
    ...(shape.type === "poly" && !isConvex(shape.pts) ? { concave: true } : {}),
  };
}

/**
 * Where a dragged point lands: `start` plus the pointer's offset, snapped
 * like a move (grid, then other entities' geometry) unless mod bypasses it.
 */
export function snapDraggedPoint(
  t: GizmoTarget,
  start: Pt,
  from: Pt,
  to: Pt,
  opts: DragOptions,
): { at: Pt; guides: SnapGuide[] } {
  const r = snapMove({
    aabb: { minX: start[0], minY: start[1], maxX: start[0], maxY: start[1] },
    grab: start,
    delta: [to[0] - from[0], to[1] - from[1]],
    settings: opts.snap,
    index: opts.index,
    exclude: [t.ref],
    scale: opts.scale,
    bypass: opts.mods.mod,
  });
  return { at: [start[0] + r.delta[0], start[1] + r.delta[1]], guides: r.guides };
}
