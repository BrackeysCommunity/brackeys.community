import type { Registry } from "../../game/types";
import { aabb } from "../../scene/shape-geometry";
import type { Aabb, Pt, Ref, SceneDefinition, ShapeObj } from "../../scene/types";
import { geometryOfRef } from "../spatial-index";

/** One selected entity as the gizmos edit it, read from the document. */
export type GizmoTarget = {
  ref: Ref;
  type: string;
  bulk: boolean;
  /** The shape in world metres; on a path, placed at the path's first point. */
  shape?: ShapeObj;
  /** The shape as the document holds it: local to the path's first point when there is a path. */
  local?: ShapeObj;
  shapeField?: string;
  /** A point entity's position, when it has no shape. */
  at?: Pt;
  pointField?: string;
  /** The path the shape rides, waypoints in world metres. */
  path?: { field: string; pts: Pt[]; loop: boolean };
};

/** `ref`'s editable geometry in `def`; `undefined` when it isn't there or has no shape or point. */
export function gizmoTarget(
  def: SceneDefinition,
  registry: Registry,
  ref: Ref,
): GizmoTarget | undefined {
  const g = geometryOfRef(def, registry, ref);
  if (!g) return undefined;
  const base = { ref, type: g.type, bulk: g.bulk };
  if (g.shape && g.local && g.shapeField) {
    return {
      ...base,
      shape: g.shape,
      local: g.local,
      shapeField: g.shapeField,
      ...(g.pathField && g.pts
        ? { path: { field: g.pathField, pts: g.pts, loop: g.loop === true } }
        : {}),
    };
  }
  if (g.at && g.pointField) return { ...base, at: g.at, pointField: g.pointField };
  return undefined;
}

/** A target's world box: its shape's, or its point's. */
export function targetBox(t: GizmoTarget): Aabb {
  if (t.shape) return aabb(t.shape);
  const [x, y] = t.at!;
  return { minX: x, minY: y, maxX: x, maxY: y };
}
