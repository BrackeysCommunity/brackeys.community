import { CHILD_SEPARATOR, parseChildRef, sceneFrames } from "../../scene/resolve";
import type { PrefabLibrary, Ref, SceneDefinition } from "../../scene/types";

/**
 * The document behind a resolved view, where instances and the tree are read
 * from: the view inlines instances and drops their ids, and loses which
 * instances sit under a parent.
 */
export type EditSource = { doc: SceneDefinition; prefabs?: PrefabLibrary };

/** The tree as a resolved view's refs see it. */
export type EditTree = {
  /** Whether `ref` names an instance of the document (top level), which the view has no entity for. */
  isInstance(ref: Ref): boolean;
  /** The document's instance ids, in document order. */
  instances(): readonly Ref[];
  /**
   * The view's entities below each of `refs`, `refs` left out: children by
   * `parent`, an instance's children, and what sits under those. Instance
   * ids, which the view holds no entity for, are walked through, never
   * returned.
   */
  below(refs: Iterable<Ref>): Ref[];
};

/**
 * The instances a prefab child sits in, outermost first: `["room-1",
 * "room-1/door-1"]` for `room-1/door-1/panel`; none for a ref of the
 * document itself.
 */
export function enclosingInstances(ref: Ref): Ref[] {
  if (!parseChildRef(ref)) return [];
  const parts = ref.split(CHILD_SEPARATOR);
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join(CHILD_SEPARATOR));
}

/**
 * The tree of `view`, a resolved view. With `source`, parents are read from
 * the document as the resolver settles them (a missing parent or the last
 * link of a cycle is a root) and instances under a parent are found;
 * without it, from the view's own `parent` fields and child refs.
 */
export function editTree(view: SceneDefinition, source?: EditSource): EditTree {
  const entities = view.entities ?? [];
  const docInstances = source?.doc.instances;
  const instanceIds = docInstances
    ? docInstances.map((i) => i.id)
    : [...new Set(entities.flatMap((e) => parseChildRef(e.id)?.instance ?? []))];
  const instances = new Set(instanceIds);
  const frames = source ? sceneFrames(source.doc) : undefined;
  const docEntities = new Set((source?.doc.entities ?? []).map((e) => e.id));

  /** Children by `parent`, and an instance's (or nested instance's) children by their ref. */
  const children = new Map<Ref, Ref[]>();
  const link = (parent: Ref, child: Ref) => {
    const list = children.get(parent);
    if (list) list.push(child);
    else children.set(parent, [child]);
  };
  const order = new Map<Ref, number>();
  for (const e of entities) {
    if (!order.has(e.id)) order.set(e.id, order.size);
    const parent = frames && docEntities.has(e.id) ? frames.parentOf(e.id) : e.parent;
    if (parent !== undefined) link(parent, e.id);
    for (const level of enclosingInstances(e.id)) link(level, e.id);
  }
  for (const inst of docInstances ?? []) {
    const parent = frames?.parentOf(inst.id);
    if (parent !== undefined) link(parent, inst.id);
  }

  return {
    isInstance: (ref) => instances.has(ref),
    instances: () => instanceIds,
    below(refs) {
      const start = new Set(refs);
      const seen = new Set<Ref>(start);
      const queue = [...start];
      const out: Ref[] = [];
      for (let r = queue.pop(); r !== undefined; r = queue.pop())
        for (const c of children.get(r) ?? []) {
          if (seen.has(c)) continue;
          seen.add(c);
          queue.push(c);
          if (order.has(c)) out.push(c);
        }
      return out.sort((a, b) => order.get(a)! - order.get(b)!);
    },
  };
}
