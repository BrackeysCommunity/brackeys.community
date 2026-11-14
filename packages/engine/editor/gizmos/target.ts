import { NODE_TYPE } from "../../game/primitives";
import type { Registry } from "../../game/types";
import { instanceTransform } from "../../scene/resolve";
import { aabb, aabbUnion } from "../../scene/shape-geometry";
import { asFrame, type Frame } from "../../scene/transform";
import type { Aabb, OpBatch, Pt, Ref, SceneDefinition, ShapeObj } from "../../scene/types";
import { geometryOfRef } from "../spatial-index";
import { behaviorGizmo, type BehaviorGizmo } from "./behavior-target";
import { carryPreview } from "./carry";
import { shapePivot } from "./handles";
import { editTree, type EditSource, type EditTree } from "./tree";

/** One selected entity or instance as the gizmos edit it, read from the resolved view. */
export type GizmoTarget = {
  ref: Ref;
  /** The entity's type; `node` for an instance, which the runtime places as one. */
  type: string;
  bulk: boolean;
  /** The shape in world metres; on a path, placed at the path's first point. */
  shape?: ShapeObj;
  /** The shape as the document holds it: local to the path's first point when there is a path. */
  local?: ShapeObj;
  shapeField?: string;
  /** A point entity's position, when it has no shape; a node's or an instance's origin. */
  at?: Pt;
  /** Where `at` is written; an instance has none, since a `move` places it. */
  pointField?: string;
  /** The path the shape rides, waypoints in world metres. */
  path?: { field: string; pts: Pt[]; loop: boolean };
  /** Its collider, joint, force area and spawner, when it carries any. */
  behaviors?: BehaviorGizmo;
  /** An instance's prefab. */
  prefab?: string;
  /**
   * A node's or an instance's frame in the world: its origin, angle and
   * flip. Its rotate handle turns it about the origin with a `transform`.
   */
  frame?: Frame;
  /** The view's entities under it, which move and turn with it; absent when none is. */
  subtree?: Ref[];
  /** The box over it and its subtree, when it has one: what snapping and a selection's box go by. */
  box?: Aabb;
  /**
   * The batch the resolved view previews for `batch`, an edit of this target
   * or of a selection holding it, when that isn't `batch` itself: what sits
   * under a moved or turned parent carried along (`carryPreview`). Absent
   * when nothing is under it.
   */
  preview?: (batch: OpBatch) => OpBatch | null;
};

const pointBox = ([x, y]: Pt): Aabb => ({ minX: x, minY: y, maxX: x, maxY: y });

/** The box over `refs`' own geometry in `view`; null when none has any. */
function subtreeBox(view: SceneDefinition, registry: Registry, refs: readonly Ref[]): Aabb | null {
  let box: Aabb | null = null;
  for (const r of refs) {
    const g = geometryOfRef(view, registry, r);
    const own = g?.shape ? aabb(g.shape) : g?.at ? pointBox(g.at) : null;
    if (own) box = box ? aabbUnion(box, own) : own;
  }
  return box;
}

/** The world frame of a document instance, or of a node in `view`. */
function frameOfRef(
  view: SceneDefinition,
  registry: Registry,
  ref: Ref,
  source: EditSource | undefined,
): Frame | undefined {
  const inst = source?.doc.instances?.find((i) => i.id === ref);
  if (inst) return asFrame(instanceTransform(source!.doc, inst, registry, source!.prefabs));
  const e = (view.entities ?? []).find((x) => x.id === ref);
  if (e?.type !== NODE_TYPE) return undefined;
  const at = Array.isArray(e.at) ? (e.at as Pt) : ([0, 0] as Pt);
  return {
    at: [at[0], at[1]],
    rot: typeof e.rot === "number" ? e.rot : 0,
    flip: e.flip === true,
  };
}

/** What a target adds for what sits under it: its subtree, the box over both, and the preview carrying it. */
function withSubtree(
  t: GizmoTarget,
  view: SceneDefinition,
  registry: Registry,
  tree: EditTree,
  source: EditSource | undefined,
): GizmoTarget {
  const subtree = t.bulk ? [] : tree.below([t.ref]);
  if (subtree.length === 0 && !tree.isInstance(t.ref)) return t;
  const below = subtreeBox(view, registry, subtree);
  const own = targetBox(t);
  return {
    ...t,
    ...(subtree.length > 0 ? { subtree } : {}),
    box: below ? aabbUnion(own, below) : own,
    preview: (batch) =>
      carryPreview(
        { view, registry, tree, frameOf: (r) => frameOfRef(view, registry, r, source) },
        batch,
      ),
  };
}

/**
 * `ref`'s editable geometry in `def`, the resolved view; `undefined` when it
 * isn't there or has no shape or point. A node is a point target with its
 * frame. With `source`, the document behind the view, an instance's id is a
 * point target too, at its origin with its frame, and the subtree under an
 * instance's parent is found.
 */
export function gizmoTarget(
  def: SceneDefinition,
  registry: Registry,
  ref: Ref,
  source?: EditSource,
): GizmoTarget | undefined {
  const base = ownTarget(def, registry, ref, source);
  if (!base) return undefined;
  return withSubtree(base, def, registry, editTree(def, source), source);
}

function ownTarget(
  def: SceneDefinition,
  registry: Registry,
  ref: Ref,
  source: EditSource | undefined,
): GizmoTarget | undefined {
  const g = geometryOfRef(def, registry, ref);
  if (!g) {
    const inst = source?.doc.instances?.find((i) => i.id === ref);
    const f = inst && frameOfRef(def, registry, ref, source);
    return inst && f
      ? { ref, type: NODE_TYPE, bulk: false, prefab: inst.prefab, at: f.at, frame: f }
      : undefined;
  }
  const behaviors = g.bulk ? undefined : behaviorGizmo(def, registry, ref, g);
  const base = { ref, type: g.type, bulk: g.bulk, ...(behaviors ? { behaviors } : {}) };
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
  if (g.at && g.pointField) {
    const f = g.type === NODE_TYPE ? frameOfRef(def, registry, ref, source) : undefined;
    return { ...base, at: g.at, pointField: g.pointField, ...(f ? { frame: f } : {}) };
  }
  return undefined;
}

/** A target's own world box: its shape's, or its point's. */
export function targetBox(t: GizmoTarget): Aabb {
  if (t.shape) return aabb(t.shape);
  return pointBox(t.at!);
}

/** The box over a target and what sits under it. */
export const treeBox = (t: GizmoTarget): Aabb => t.box ?? targetBox(t);

/** What a target turns about: a node's or an instance's origin, a shape's pivot, else its point. */
export function targetPivot(t: GizmoTarget): Pt {
  if (t.frame) return t.frame.at;
  if (t.shape) return shapePivot(t.shape);
  return t.at!;
}
