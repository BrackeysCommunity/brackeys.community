import { isPolygonField } from "../../game/fields";
import type { Registry } from "../../game/types";
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
  /** Screen px per metre. */
  scale: number;
  /** The game's px per metre: every edit lands on whole world px. */
  pxPerMetre: number;
  /** Other entities, for geometry snapping of moves, vertices and waypoints. */
  index?: SpatialIndex;
};

/** What one gizmo gesture does so far: preview it while dragging, commit `batch` at pointer-up. */
export type GizmoEdit = {
  /** The whole gesture as one batch, on whole world px; `null` when it changes nothing. */
  batch: OpBatch | null;
  /**
   * What the resolved view previews while dragging, when it isn't `batch`:
   * a parent's subtree carried with it, an instance's children for an
   * instance (`GizmoTarget.preview`). Commit `batch` all the same.
   */
  preview?: OpBatch;
  /** The drag readout: `Δ 0.64, 0 m`, `W 1.6 H 0.16 m`, `37°`. */
  readout: string;
  /** The shape as the batch commits it, world metres. */
  shape?: ShapeObj;
  /** A point entity's position as the batch commits it. */
  at?: Pt;
  /** A path's waypoints as the batch commits them. */
  pts?: Pt[];
  /**
   * The edit leaves a poly non-convex. It still commits; afterwards offer
   * **Convert to chain** (`convertToChainFix`). `judgeConcave` clears it for
   * a field that takes concave polygons.
   */
  concave?: boolean;
  guides?: SnapGuide[];
};

/** `edit` with the preview `targets` give its batch, when one does. */
export function withPreview<E extends GizmoEdit | null>(
  edit: E,
  targets: readonly GizmoTarget[],
): E {
  if (!edit?.batch) return edit;
  const preview = targets.find((t) => t.preview)?.preview?.(edit.batch);
  return preview ? { ...edit, preview } : edit;
}

/** A gesture that gives `t` the world shape `world`, rounded as it will commit. */
export function shapeEdit(
  t: GizmoTarget,
  world: ShapeObj,
  pxPerMetre: number,
  label: string,
  readout = readShapeSize(roundShape(world, pxPerMetre), pxPerMetre),
): GizmoEdit {
  const shape = roundShape(world, pxPerMetre);
  return {
    batch: shapeBatch(t, world, pxPerMetre, label),
    readout,
    shape,
    ...(shape.type === "poly" && !isConvex(shape.pts) ? { concave: true } : {}),
  };
}

/** Whether `t`'s shape field takes concave polygons, so a concave edit of it is no fault. */
export function takesConcave(registry: Registry, t: GizmoTarget): boolean {
  const schema = t.shapeField ? registry.types.get(t.type)?.shape[t.shapeField] : undefined;
  return schema !== undefined && isPolygonField(schema);
}

/** `edit` without its `concave` flag when `t`'s field allows concave polygons. */
export function judgeConcave(
  edit: GizmoEdit | null,
  registry: Registry,
  t: GizmoTarget | undefined,
): GizmoEdit | null {
  if (!edit?.concave || !t || !takesConcave(registry, t)) return edit;
  const { concave: _, ...rest } = edit;
  return rest;
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
    pxPerMetre: opts.pxPerMetre,
    bypass: opts.mods.mod,
  });
  return { at: [start[0] + r.delta[0], start[1] + r.delta[1]], guides: r.guides };
}
