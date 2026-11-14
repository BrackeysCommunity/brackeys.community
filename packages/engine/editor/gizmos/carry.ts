import type { Registry } from "../../game/types";
import { entityUpdate } from "../../scene/diff-to-ops";
import { applyOps, transformOpMatrix } from "../../scene/ops";
import { entityFrame, reexpressEntity } from "../../scene/resolve";
import {
  compose,
  frame,
  invert,
  isIdentity,
  translation,
  type Frame,
  type Transform2D,
} from "../../scene/transform";
import type { EntityDef, OpBatch, Ref, SceneDefinition, SceneOp } from "../../scene/types";
import type { EditTree } from "./tree";

export type CarryContext = {
  view: SceneDefinition;
  registry: Registry;
  tree: EditTree;
  /** A node's or instance's frame in the world, where a `transform` without `about` turns it. */
  frameOf(ref: Ref): Frame | undefined;
};

/**
 * `batch`, a gizmo edit written for the document, as the resolved view
 * previews it: what sits under each thing it moves or turns is carried with
 * it, since the document stores children in their parent's frame and the
 * view places them in the world. A `move` takes the subtree along; a
 * `transform` turns a node and its subtree by updates (the view's nodes
 * already sit in the world, so the op itself would turn them twice); an
 * `update` that moves its entity's frame carries the subtree by the same
 * change. An instance has no entity in the view, so only its subtree shows.
 * `null` when the batch is its own preview.
 */
export function carryPreview(cx: CarryContext, batch: OpBatch): OpBatch | null {
  const { view, registry, tree } = cx;
  const byId = new Map<Ref, EntityDef>();
  for (const e of view.entities ?? []) if (!byId.has(e.id)) byId.set(e.id, e);
  const moved = new Map<Ref, Transform2D>();
  const ops: SceneOp[] = [];
  let changed = false;

  const updates = batch.ops.filter(
    (op): op is Extract<SceneOp, { op: "update" }> => op.op === "update" && byId.has(op.ref),
  );
  const after =
    updates.length > 0 ? applyOps(view, { ops: updates }, registry, { validate: "none" }) : null;
  const afterOf = (ref: Ref) =>
    after?.ok ? after.def.entities?.find((e) => e.id === ref) : undefined;

  for (const op of batch.ops) {
    if (op.op === "move") {
      const refs: Ref[] = [];
      for (const r of op.refs) {
        moved.set(r, translation(op.by));
        if (tree.isInstance(r)) changed = true;
        else refs.push(r);
      }
      const below = tree.below(op.refs).filter((r) => !refs.includes(r));
      if (below.length > 0) changed = true;
      refs.push(...below);
      if (refs.length > 0) ops.push({ ...op, refs });
    } else if (op.op === "transform") {
      changed = true;
      for (const r of op.refs) {
        const at = op.about ?? cx.frameOf(r)?.at;
        if (!at) continue;
        const t = transformOpMatrix(op, at);
        moved.set(r, t);
        const own = byId.get(r);
        const update = own && entityUpdate(own, reexpressEntity(registry, view.settings, own, t));
        if (update) ops.push(update);
      }
    } else {
      ops.push(op);
      if (op.op !== "update" || !byId.has(op.ref)) continue;
      const before = byId.get(op.ref)!;
      const next = afterOf(op.ref);
      if (!next) continue;
      const t = compose(
        frame(entityFrame(registry, next)),
        invert(frame(entityFrame(registry, before))),
      );
      if (!isIdentity(t)) moved.set(op.ref, t);
    }
  }

  const done = new Set<Ref>(moved.keys());
  for (const op of ops) if (op.op === "move") for (const r of op.refs) done.add(r);
  for (const [root, t] of moved) {
    for (const r of tree.below([root])) {
      if (done.has(r)) continue;
      done.add(r);
      const def = byId.get(r);
      const update = def && entityUpdate(def, reexpressEntity(registry, view.settings, def, t));
      if (update) {
        ops.push(update);
        changed = true;
      }
    }
  }
  return changed ? { ...batch, ops } : null;
}
