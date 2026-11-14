import { NODE_TYPE } from "../game/primitives";
import type { Registry } from "../game/types";
import { pxPerMetreOf } from "../game/units";
import { parseBulkId } from "../scene/expand";
import { plural } from "../scene/plural";
import {
  CHILD_SEPARATOR,
  documentTree,
  headOfRef,
  instanceLevels as levelsOf,
  ownChildId,
  resolveScene,
  sceneFrames,
} from "../scene/resolve";
import type {
  Aabb,
  OpBatch,
  PrefabLibrary,
  Pt,
  Ref,
  SceneDefinition,
  SceneOp,
} from "../scene/types";
import { snapToPixel } from "../scene/units";
import { canBeChild, parentTargets } from "../scene/validate";
import { moveBatch } from "./gizmos/batch";
import { rotateTargetsBatch, selectionBox } from "./gizmos/multi";
import { gizmoTarget, targetPivot, type GizmoTarget } from "./gizmos/target";
import type { EditSource } from "./gizmos/tree";
import { buildOutline } from "./outline";
import { outlineBounds, outlineLook } from "./outline-bounds";
import type { PickLayers } from "./picking";
import { docRefs } from "./refs";
import type { SpatialIndex } from "./tools";

/** World px a coarse (Shift) nudge moves. */
export const COARSE_NUDGE_STEPS = 10;

const DIRECTIONS: Record<string, Pt> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

/**
 * The offset, in metres, a `nudge-<dir>[-coarse|-fine]` command moves by:
 * one world px at `pxPerMetre` (also with `-fine`), ten with `-coarse`.
 * `null` for any other command.
 */
export function nudgeDelta(command: string, pxPerMetre: number): Pt | null {
  const m = /^nudge-(up|down|left|right)(?:-(coarse|fine))?$/.exec(command);
  if (!m) return null;
  const [dx, dy] = DIRECTIONS[m[1]!]!;
  const by = snapToPixel((m[2] === "coarse" ? COARSE_NUDGE_STEPS : 1) / pxPerMetre, pxPerMetre);
  return [dx * by + 0, dy * by + 0];
}

/** The selection's editable targets, in selection order; refs without geometry are left out. */
export function targetsOf(
  def: SceneDefinition,
  registry: Registry,
  refs: readonly Ref[],
  source?: EditSource,
): GizmoTarget[] {
  return refs
    .map((r) => gizmoTarget(def, registry, r, source))
    .filter((t): t is GizmoTarget => t !== undefined);
}

/**
 * What a selection turns about: one target's own pivot (a node's or an
 * instance's origin, a shape's pivot), else the centre of the box around all of it.
 */
export function rotationPivot(targets: readonly GizmoTarget[]): Pt | null {
  if (targets.length === 0) return null;
  if (targets.length === 1) return targetPivot(targets[0]!);
  const b = selectionBox(targets);
  return [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
}

/** One batch moving `refs` by `delta`, on whole world px; `null` when nothing moves. */
export function nudgeBatch(refs: readonly Ref[], delta: Pt, pxPerMetre: number): OpBatch | null {
  const label = `Nudge ${refs.length === 1 ? refs[0] : `${refs.length} entities`}`;
  return moveBatch(refs, delta, pxPerMetre, label);
}

/**
 * One batch turning the selection `deg` degrees (clockwise on screen) about
 * its pivot. `def` is the document: selected instances and nodes turn by
 * one `transform`, everything else by its fields in the resolved view; what
 * sits under something else selected turns with it. One instance or node
 * on its own turns about its own origin.
 */
export function rotateSelectionBatch(
  def: SceneDefinition,
  registry: Registry,
  refs: readonly Ref[],
  deg: number,
  prefabs?: PrefabLibrary,
): OpBatch | null {
  const roots = selectionRoots(def, refs);
  const framed = roots.filter((r) => isFrameRef(def, r));
  const rest = roots.filter((r) => !framed.includes(r));
  const view = resolveScene(def, registry, prefabs);
  const targets = targetsOf(view, registry, rest);
  let about: Pt | null;
  if (framed.length === 0) about = rotationPivot(targets);
  else {
    const box = selectionBounds(view, registry, roots);
    about = box ? [(box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2] : null;
  }
  if (framed.length === 0) {
    return about ? rotateTargetsBatch(targets, about, deg, pxPerMetreOf(registry)) : null;
  }
  const label = `Rotate ${roots.length === 1 ? roots[0] : `${roots.length} entities`}`;
  const alone = framed.length === 1 && targets.length === 0;
  const ops: SceneOp[] = [
    { op: "transform", refs: framed, rotate: deg, ...(alone || !about ? {} : { about }) },
  ];
  if (about && targets.length > 0) {
    ops.push(...(rotateTargetsBatch(targets, about, deg, pxPerMetreOf(registry))?.ops ?? []));
  }
  return { label, ops };
}

/**
 * The box around what the selection outlines (`outlineBounds` with the
 * registry's look), an instance by its children: the box the selection's
 * outline, its gizmo and a tool's offer sit on. `null` when nothing in it
 * draws. Framing goes by `frameBounds`, which also takes in the paths movers
 * travel.
 */
export function selectionBounds(
  def: SceneDefinition,
  registry: Registry,
  refs: readonly Ref[],
): Aabb | null {
  return outlineBounds(def, refs, outlineLook(registry));
}

/** Every ref in the document, in file order, except those on a hidden or locked layer. */
export function selectAllRefs(
  def: SceneDefinition,
  index: SpatialIndex,
  layers?: PickLayers,
): Ref[] {
  return docRefs(def).filter((r) => {
    const layer = index.get(r)?.layer;
    return !layers || !layer || (!layers.hidden.has(layer) && !layers.locked.has(layer));
  });
}

/**
 * One batch removing `refs`; `null` for an empty selection. With `def`
 * (the document), the label also counts what goes with them: everything
 * below them in the tree.
 */
export function deleteBatch(refs: readonly Ref[], def?: SceneDefinition): OpBatch | null {
  if (refs.length === 0) return null;
  const unique = [...new Set(refs)];
  const what = unique.length === 1 ? unique[0]! : `${unique.length} entities`;
  const below = def ? documentTree(def).below(unique).size : 0;
  return {
    label:
      below > 0 ? `Delete ${what} and ${plural(below, "child", "children")}` : `Delete ${what}`,
    ops: [{ op: "remove", refs: unique }],
  };
}

/**
 * One batch raising (`by` 1, bring forward) or lowering (`by` -1, send
 * backward) the `z` of the selected entities and instances. Bulk entries,
 * including an instance's bulk children, carry no `z` and are left out;
 * `null` when nothing is left.
 */
export function zOrderBatch(refs: readonly Ref[], by: 1 | -1): OpBatch | null {
  const placed = [...new Set(refs)].filter((r) => !parseBulkId(ownChildId(r)));
  if (placed.length === 0) return null;
  const n = placed.length === 1 ? placed[0]! : `${placed.length} entities`;
  return {
    label: by > 0 ? `Bring ${n} forward` : `Send ${n} backward`,
    ops: [{ op: "setZ", refs: placed, by }],
  };
}

export type QuarterTurnTargets = {
  /** Selected instances (by id, or through a child), in selection order. */
  instances: string[];
  /** What isn't an instance: plain entities and bulk entries. */
  rest: Ref[];
};

/**
 * What a turn or flip of `refs` acts on in `def` (the document, not the
 * resolved view): instances, which turn and flip exactly.
 */
export function quarterTurnTargets(def: SceneDefinition, refs: readonly Ref[]): QuarterTurnTargets {
  const known = new Set((def.instances ?? []).map((i) => i.id));
  const instanceOf = (r: Ref) => {
    const id = headOfRef(r);
    return known.has(id) ? id : undefined;
  };
  const out: QuarterTurnTargets = { instances: [], rest: [] };
  for (const r of new Set(refs)) {
    const inst = instanceOf(r);
    if (inst === undefined) out.rest.push(r);
    else if (!out.instances.includes(inst)) out.instances.push(inst);
  }
  return out;
}

function transformBatch(
  def: SceneDefinition,
  refs: readonly Ref[],
  label: (what: string) => string,
  change: { turn: 1 | -1 } | { flip: "x" | "y" },
): OpBatch | null {
  const { instances } = quarterTurnTargets(def, refs);
  if (instances.length === 0) return null;
  const what = instances.length === 1 ? instances[0]! : `${instances.length} items`;
  return { label: label(what), ops: [{ op: "transform", refs: instances, ...change }] };
}

/**
 * One batch turning the selected instances a quarter turn (`turn` 1
 * clockwise on screen, -1 counterclockwise), each about its own `at`.
 * Plain entities in the selection are left out; `null` when nothing is
 * left.
 */
export function turnBatch(
  def: SceneDefinition,
  refs: readonly Ref[],
  turn: 1 | -1,
): OpBatch | null {
  const dir = turn > 0 ? "clockwise" : "counterclockwise";
  return transformBatch(def, refs, (w) => `Turn ${w} 90° ${dir}`, { turn });
}

/**
 * One batch mirroring the selected instances across the world axis: `x`
 * flips left and right, `y` up and down, each about its own `at`. `null`
 * when the selection holds none.
 */
export function flipBatch(
  def: SceneDefinition,
  refs: readonly Ref[],
  axis: "x" | "y",
): OpBatch | null {
  const dir = axis === "x" ? "horizontally" : "vertically";
  return transformBatch(def, refs, (w) => `Flip ${w} ${dir}`, { flip: axis });
}

/** Whether `ref` is a document instance or `node`, which turn by `transform`. */
const isFrameRef = (def: SceneDefinition, ref: Ref): boolean =>
  (def.instances ?? []).some((i) => i.id === ref) ||
  (def.entities ?? []).some((e) => e.id === ref && e.type === NODE_TYPE);

/**
 * The levels a click walks from the outermost instance holding `ref` down to
 * `ref` itself: `["room-1", "room-1/door-1", "room-1/door-1/panel"]`; just
 * `[ref]` for anything that isn't an instance's child.
 */
export function instanceLevels(ref: Ref): Ref[] {
  return levelsOf(ref);
}

/**
 * The selected refs nothing else selected sits over, in selection order:
 * what a move or turn of the selection writes, since the rest follows.
 */
export function selectionRoots(def: SceneDefinition, refs: readonly Ref[]): Ref[] {
  return documentTree(def).roots(refs);
}

/** A batch with what the editor selects once it applies. */
export type SelectingBatch = { batch: OpBatch; select: Ref[] };

/**
 * Grouping the selection (`def` is the document): one batch that adds a
 * `node` at the centre of the selection's bounds, under the selection's
 * common parent, and puts the selection's roots under it, so nothing moves
 * in the world. Bulk entries, instances' children and types that can't be in
 * the tree are left out; `null` when nothing is left or the game has no
 * `node`. Selects the node.
 */
export function groupBatch(
  def: SceneDefinition,
  registry: Registry,
  refs: readonly Ref[],
  prefabs?: PrefabLibrary,
): SelectingBatch | null {
  if (!registry.types.has(NODE_TYPE)) return null;
  const frames = sceneFrames(def, registry, prefabs);
  const tree = documentTree(def, frames);
  const target = parentTargets(def, registry, frames);
  const roots = tree.roots(refs).filter((r) => canBeChild(target(r)));
  if (roots.length === 0) return null;
  const entities = new Set((def.entities ?? []).map((e) => e.id));
  const instances = new Set((def.instances ?? []).map((i) => i.id));
  const lines = roots.map((r) => [...tree.ancestors(r), undefined]);
  const parent = lines[0]!.find((a) => lines.every((line) => line.includes(a)));
  const box = selectionBounds(resolveScene(def, registry, prefabs), registry, roots);
  const ppm = pxPerMetreOf(registry);
  const centre = box ? [(box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2] : [0, 0];
  const at: Pt = [snapToPixel(centre[0]!, ppm) + 0, snapToPixel(centre[1]!, ppm) + 0];
  const taken = new Set([...entities, ...instances]);
  let n = 1;
  while (taken.has(`${NODE_TYPE}-${n}`)) n++;
  const id = `${NODE_TYPE}-${n}`;
  const first = (def.entities ?? []).findIndex((e) => roots.includes(e.id));
  const ops: SceneOp[] = [
    { op: "add", entity: { id, type: NODE_TYPE, at }, ...(first >= 0 ? { index: first } : {}) },
  ];
  if (parent !== undefined) ops.push({ op: "reparent", refs: [id], parent });
  ops.push({ op: "reparent", refs: roots, parent: id });
  const what = roots.length === 1 ? roots[0]! : `${roots.length} entities`;
  return { batch: { label: `Group ${what}`, ops }, select: [id] };
}

/**
 * Ungrouping the selected nodes (`def` is the document): one batch that puts
 * each node's children under the node's parent, keeping them where they
 * are in the world, and removes the node. A node under another selected
 * node hands its children on to the nearest one that stays. `null` when the
 * selection holds no node. Selects the children it moved.
 */
export function ungroupBatch(def: SceneDefinition, refs: readonly Ref[]): SelectingBatch | null {
  const picked = new Set(refs);
  const nodes = (def.entities ?? [])
    .filter((e) => e.type === NODE_TYPE && picked.has(e.id))
    .map((e) => e.id);
  if (nodes.length === 0) return null;
  const tree = documentTree(def);
  const parentOf = (ref: Ref) => tree.parentOf(ref);
  const gone = new Set(nodes);
  const keeper = (id: string) => tree.ancestors(id).find((a) => !gone.has(a)) ?? null;
  const moves = new Map<Ref | null, Ref[]>();
  const moved: Ref[] = [];
  for (const item of [...(def.entities ?? []), ...(def.instances ?? [])]) {
    const p = parentOf(item.id);
    if (p === undefined || !gone.has(p) || gone.has(item.id)) continue;
    const to = keeper(p);
    moves.set(to, [...(moves.get(to) ?? []), item.id]);
    moved.push(item.id);
  }
  const ops: SceneOp[] = [...moves].map(([parent, ids]) => ({ op: "reparent", refs: ids, parent }));
  ops.push({ op: "remove", refs: nodes });
  const what = nodes.length === 1 ? nodes[0]! : `${nodes.length} nodes`;
  return { batch: { label: `Ungroup ${what}`, ops }, select: moved };
}

const sameSet = (a: readonly Ref[], b: readonly Ref[]) =>
  a.length === b.length && new Set([...a, ...b]).size === a.length;

/**
 * `[`: what the selection sits under in `def` (the document): each selected
 * ref's parent, a prefab's child's being its instance. A bulk entry at the
 * root climbs to its whole bucket. `null` when nothing climbs.
 */
export function hierarchyUp(def: SceneDefinition, sel: readonly Ref[]): Ref[] | null {
  const tree = documentTree(def);
  const up: Ref[] = [];
  for (const r of sel) {
    const p = tree.parentOf(r);
    if (p !== undefined && !up.includes(p)) up.push(p);
  }
  if (up.length > 0) return up;
  const bulk = sel[0] === undefined ? null : parseBulkId(sel[0]);
  if (!bulk) return null;
  const bucket = docRefs(def).filter((r) => parseBulkId(r)?.key === bulk.key);
  return sameSet(bucket, sel) ? null : bucket;
}

/**
 * `]`: one ref's first child in `def` (the document): an instance's first
 * level of children (a nested instance before what it holds), then what sits
 * under it by `parent`, entities before instances. From a selection of
 * several, its first ref in outline order. `null` when there's nothing below.
 */
export function hierarchyDown(
  def: SceneDefinition,
  registry: Registry,
  sel: readonly Ref[],
  prefabs?: PrefabLibrary,
): Ref[] | null {
  if (sel.length >= 2) {
    const has = new Set(sel);
    const first = buildOutline(def, registry).find((r) => r.ref !== undefined && has.has(r.ref));
    return [first?.ref ?? sel[0]!];
  }
  const ref = sel[0];
  if (ref === undefined) return null;
  const inst = (def.instances ?? []).find((i) => i.id === headOfRef(ref));
  if (inst) {
    const prefix = `${ref}${CHILD_SEPARATOR}`;
    const child = sceneFrames(def, registry, prefabs)
      .placed(inst)
      ?.find((c) => c.def.id.startsWith(prefix));
    if (child) {
      const next = child.def.id.slice(prefix.length).split(CHILD_SEPARATOR)[0]!;
      return [`${prefix}${next}`];
    }
  }
  const tree = documentTree(def);
  const below = [...(def.entities ?? []), ...(def.instances ?? [])].find(
    (item) => tree.parentOf(item.id) === ref,
  );
  return below ? [below.id] : null;
}
