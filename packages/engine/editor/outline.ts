import { placeableTypes } from "../game/define";
import type { Registry } from "../game/types";
import { pxPerMetreOf } from "../game/units";
import { bulkEntries, bulkId, bulkKeysOf, bulkKeyType, parseBulkId } from "../scene/expand";
import { nextFreeId, takenIds } from "../scene/fragment";
import { sceneHash } from "../scene/hash";
import { applyOps } from "../scene/ops";
import {
  CHILD_SEPARATOR,
  childRef,
  documentTree,
  headOfRef,
  localChildren,
  sceneFrames,
  treeItems,
  type LocalChild,
  type SceneFrames,
} from "../scene/resolve";
import { applyPt, composeSteps } from "../scene/transform";
import {
  PREFAB_MAX_DEPTH,
  type BulkEntry,
  type BulkKey,
  type EntityDef,
  type EntityTypeName,
  type InstanceDef,
  type OpBatch,
  type Prefab,
  type PrefabLibrary,
  type Pt,
  type Ref,
  type SceneDefinition,
  type SceneIssue,
  type SceneOp,
} from "../scene/types";
import { lengthDecimals } from "../scene/units";
import { canBeInTree, itemsLabel, reparentLabel } from "../scene/validate";
import { prefabInstances } from "./prefab-commands";

export type OutlineRow = {
  /** Unique within one outline; stable across edits that keep the row. */
  key: string;
  depth: number;
  kind: "type" | "bucket" | "entity";
  label: string;
  /** Secondary text, such as `box · ice`. */
  detail?: string;
  ref?: Ref;
  type?: EntityTypeName;
  count?: number;
  /** On an instance's row, a nested one's too: the prefab it places. */
  prefab?: string;
  /** On an instance's row, how many overrides it holds (a nested one's: the scene's keys on it and below); on a child's, whether any of its fields is overridden. */
  overrides?: number;
};

/** The type row instances sit under. */
export const INSTANCES_ROW = "instances";

const describeEntry = (v: unknown): string | undefined =>
  Array.isArray(v) ? (typeof v[0] === "string" ? v[0] : `${v[0]}, ${v[1]}`) : undefined;

/** How a parented entity's point is shown: in world coordinates to the inspector's decimals. */
type WorldView = { frames: SceneFrames; decimals: number };

/** An entity's row; `kind` leads its detail where no type row says it. */
function entityRow(e: EntityDef, depth = 1, kind?: string, world?: WorldView): OutlineRow {
  const at = world && e.shape === undefined && e.parent !== undefined ? worldAt(e, world) : e.at;
  const detail = [kind, describeEntry(e.shape ?? at), e.material, e.off ? "off" : undefined]
    .filter((s) => typeof s === "string")
    .join(" · ");
  return {
    key: `ref:${e.id}`,
    depth,
    kind: "entity",
    label: e.name ?? e.id,
    ...(detail ? { detail } : {}),
    ref: e.id,
    type: e.type,
  };
}

function worldAt(e: EntityDef, { frames, decimals }: WorldView): unknown {
  if (!Array.isArray(e.at) || typeof e.at[0] !== "number") return e.at;
  const [x, y] = applyPt(composeSteps(frames.stepsFor(e)), e.at as Pt);
  return [Number(x.toFixed(decimals)) + 0, Number(y.toFixed(decimals)) + 0];
}

function bucketRows(key: BulkKey, values: BulkEntry[], depth = 1): OutlineRow[] {
  const type = bulkKeyType(key);
  return [
    { key: `bucket:${key}`, depth, kind: "bucket", label: key, type, count: values.length },
    ...values.map((v, i): OutlineRow => {
      const ref = bulkId(key, i);
      return {
        key: `ref:${ref}`,
        depth: depth + 1,
        kind: "entity",
        label: ref,
        detail: describeEntry(v),
        ref,
        type,
      };
    }),
  ];
}

const parentOf = (rel: Ref): string => {
  const i = rel.lastIndexOf(CHILD_SEPARATOR);
  return i < 0 ? "" : rel.slice(0, i);
};

/** Rows a caller lists under a resolved ref: the scene's own entities parented to an instance's child. */
type RowsUnder = (ref: Ref, depth: number) => OutlineRow[];

/**
 * An instance's row and, under it, a row per child of its prefab with its
 * resolved ref and whether it is overridden, then a row per instance nested
 * in that prefab (`room-1/door-1`) holding its own children
 * (`room-1/door-1/panel`) the same way, at every level. A child whose
 * `parent` names a sibling sits under that sibling's row. `under` adds rows
 * below each child's and nested instance's row.
 */
function instanceRows(
  inst: InstanceDef,
  prefabs: PrefabLibrary | undefined,
  registry: Registry,
  depth = 1,
  under?: RowsUnder,
): OutlineRow[] {
  const keys = Object.keys(inst.overrides ?? {});
  const covering = (rel: string) =>
    keys.filter((k) => k.startsWith(`${rel}.`) || k.startsWith(`${rel}${CHILD_SEPARATOR}`)).length;
  const prefab = prefabs?.get(inst.prefab);
  const head: OutlineRow = {
    key: `ref:${inst.id}`,
    depth,
    kind: "entity",
    label: inst.name ?? inst.id,
    detail: [prefab ? inst.prefab : `${inst.prefab} (missing)`, inst.off ? "off" : undefined]
      .filter((s) => s !== undefined)
      .join(" · "),
    ref: inst.id,
    prefab: inst.prefab,
    overrides: keys.length,
  };
  if (!prefab || !prefabs) return [head];

  const byParent = new Map<string, LocalChild[]>();
  for (const c of localChildren(prefab, inst, registry, prefabs)) {
    const parent = parentOf(c.child);
    byParent.set(parent, [...(byParent.get(parent) ?? []), c]);
  }
  const rows: OutlineRow[] = [head];
  const walk = (holder: Prefab, path: string, base: number, stack: ReadonlySet<string>) => {
    const rel = (id: string) => (path ? `${path}${CHILD_SEPARATOR}${id}` : id);
    const level = byParent.get(path) ?? [];
    const nested = prefabInstances(holder, prefabs).map((n) => ({ n, rel: rel(n.id) }));
    const ids = new Set([...level.map((c) => c.child), ...nested.map((x) => x.rel)]);
    const sibling = (p: string | undefined, self: string) =>
      p !== undefined && p !== self && ids.has(p) ? p : undefined;
    const childAbove = (c: LocalChild) =>
      sibling(c.kind === "entity" ? c.def.parent : undefined, c.child);
    const nestedAbove = (x: (typeof nested)[number]) =>
      sibling(x.n.parent === undefined ? undefined : rel(x.n.parent), x.rel);
    const done = new Set<string>();
    const child = (c: LocalChild, d: number) => {
      done.add(c.child);
      const ref = childRef(inst.id, c.child);
      const type = c.kind === "entity" ? c.def.type : bulkKeyType(c.key);
      const own = c.child.slice(path ? path.length + 1 : 0);
      rows.push({
        key: `ref:${ref}`,
        depth: d,
        kind: "entity",
        label: c.kind === "entity" ? (c.def.name ?? own) : own,
        detail: describeEntry(c.kind === "entity" ? (c.def.shape ?? c.def.at) : c.value) ?? type,
        ref,
        type,
        overrides: keys.filter((k) => k.startsWith(`${c.child}.`)).length,
      });
      emit(c.child, d + 1);
      if (under) rows.push(...under(ref, d + 1));
    };
    const instance = ({ n, rel: at }: (typeof nested)[number], d: number) => {
      done.add(at);
      const ref = childRef(inst.id, at);
      const inner = prefabs.get(n.prefab);
      const loops = stack.has(n.prefab) || stack.size >= PREFAB_MAX_DEPTH;
      rows.push({
        key: `ref:${ref}`,
        depth: d,
        kind: "entity",
        label: n.name ?? n.id,
        detail: [inner ? n.prefab : `${n.prefab} (missing)`, n.off ? "off" : undefined]
          .filter((s) => s !== undefined)
          .join(" · "),
        ref,
        prefab: n.prefab,
        overrides: covering(at),
      });
      if (inner && !loops) walk(inner, at, d + 1, new Set([...stack, n.prefab]));
      emit(at, d + 1);
      if (under) rows.push(...under(ref, d + 1));
    };
    const emit = (above: string | undefined, d: number) => {
      for (const c of level) if (!done.has(c.child) && childAbove(c) === above) child(c, d);
      for (const x of nested) if (!done.has(x.rel) && nestedAbove(x) === above) instance(x, d);
    };
    emit(undefined, base);
    // Children whose parents loop among themselves sit at the instance's level.
    for (const c of level) if (!done.has(c.child)) child(c, base);
    for (const x of nested) if (!done.has(x.rel)) instance(x, base);
  };
  walk(prefab, "", depth + 1, new Set([prefab.id]));
  return rows;
}

/**
 * The outliner's rows, flattened depth-first: one row per registered type the
 * scene uses, in registration order, holding its bulk keys (each with a child
 * row per entry) and then its entities in file order. Types the scene can't
 * place (unknown or spawn-only) come last, under their own names. Instances follow under one
 * `instances` row, each with a row per child of its prefab and per
 * instance nested in it, a level deeper each time.
 */
export function buildOutline(
  def: SceneDefinition,
  registry: Registry,
  prefabs?: PrefabLibrary,
): OutlineRow[] {
  const groups = new Map<EntityTypeName, OutlineRow[]>(
    placeableTypes(registry).map((t) => [t, []]),
  );
  const counts = new Map<EntityTypeName, number>();
  const add = (type: EntityTypeName, rows: OutlineRow[], n: number) => {
    if (!groups.has(type)) groups.set(type, []);
    groups.get(type)!.push(...rows);
    counts.set(type, (counts.get(type) ?? 0) + n);
  };

  for (const key of bulkKeysOf(def)) {
    const values = bulkEntries(def, key);
    if (values.length > 0) add(bulkKeyType(key), bucketRows(key, values), values.length);
  }
  for (const e of def.entities ?? []) add(e.type, [entityRow(e)], 1);

  const rows: OutlineRow[] = [];
  for (const [type, children] of groups) {
    const count = counts.get(type);
    if (!count) continue;
    const label = registry.types.get(type)?.inspector?.label ?? type;
    rows.push({ key: `type:${type}`, depth: 0, kind: "type", label, type, count }, ...children);
  }
  const instances = def.instances ?? [];
  if (instances.length > 0) {
    rows.push({
      key: `type:${INSTANCES_ROW}`,
      depth: 0,
      kind: "type",
      label: "Prefab instances",
      count: instances.length,
    });
    for (const inst of instances) rows.push(...instanceRows(inst, prefabs, registry));
  }
  return rows;
}

/**
 * The outliner's rows as the scene's tree: each root entity and instance
 * with its children below it a level deeper each, a parent's entities in
 * `entities` order and then its instances in `instances` order. An
 * instance's prefab children come first under it, each with the scene's
 * entities parented to it, then the scene's own children of the instance.
 * A parent that doesn't resolve, or closes a loop, leaves its child at the
 * root, as the scene loads it. Bulk buckets follow as root rows.
 */
export function buildTreeOutline(
  def: SceneDefinition,
  registry: Registry,
  prefabs?: PrefabLibrary,
): OutlineRow[] {
  const frames = sceneFrames(def, registry, prefabs);
  const world: WorldView = { frames, decimals: lengthDecimals(pxPerMetreOf(registry)) };
  type Item = { kind: "entity"; def: EntityDef } | { kind: "instance"; def: InstanceDef };
  const items: Item[] = [
    ...(def.entities ?? []).map((e): Item => ({ kind: "entity", def: e })),
    ...(def.instances ?? []).map((i): Item => ({ kind: "instance", def: i })),
  ];
  const byParent = new Map<Ref, Item[]>();
  for (const item of items) {
    const parent = frames.parentOf(item.def.id) ?? "";
    byParent.set(parent, [...(byParent.get(parent) ?? []), item]);
  }
  const done = new Set<Item>();
  const typeLabel = (type: EntityTypeName) => registry.types.get(type)?.inspector?.label ?? type;
  const under: RowsUnder = (parent, depth) =>
    (byParent.get(parent) ?? []).flatMap((item) => emit(item, depth));
  const emit = (item: Item, depth: number): OutlineRow[] => {
    if (done.has(item)) return [];
    done.add(item);
    const head =
      item.kind === "entity"
        ? [entityRow(item.def, depth, typeLabel(item.def.type), world)]
        : instanceRows(item.def, prefabs, registry, depth, under);
    return [...head, ...under(item.def.id, depth + 1)];
  };
  const rows = under("", 0);
  // A parent naming an instance child the prefab doesn't have.
  for (const item of items) rows.push(...emit(item, 0));
  for (const key of bulkKeysOf(def)) {
    const values = bulkEntries(def, key);
    if (values.length > 0) rows.push(...bucketRows(key, values, 0));
  }
  return rows;
}

/**
 * Where a row dropped in the tree goes: under a parent (null: the root;
 * the parent it already has puts it last among its siblings), or just
 * before or just after a sibling.
 */
export type TreeDrop =
  | { kind: "reparent"; parent: Ref | null }
  | { kind: "reorder"; before: Ref }
  | { kind: "reorder"; after: Ref };

/**
 * The `promote` each drawn shape among `refs` needs before it can be named
 * in the tree, since a bulk entry has no id: a fresh `<type>-<n>` for each,
 * and `refs` with those ids in place. With `registry`, entries of a type the
 * tree doesn't take stay as they are.
 */
export function promoteOps(
  def: SceneDefinition,
  refs: readonly Ref[],
  registry?: Registry,
): { ops: SceneOp[]; refs: Ref[] } {
  const taken = takenIds(def);
  const ops: SceneOp[] = [];
  const out = [...new Set(refs)].map((ref) => {
    const bulk = parseBulkId(ref);
    if (!bulk || bulkEntries(def, bulk.key)[bulk.index] === undefined) return ref;
    const type = bulkKeyType(bulk.key);
    if (registry && !canBeInTree(registry.types.get(type))) return ref;
    const id = nextFreeId(`${type}-1`, taken);
    taken.add(id);
    ops.push({ op: "promote", ref, id });
    return id;
  });
  return { ops, refs: out };
}

/** `promoteOps` and the document after them, which the ops that follow in the batch are written against. */
export type TreeLift = { ops: SceneOp[]; refs: Ref[]; def: SceneDefinition };

export function liftIntoTree(
  def: SceneDefinition,
  registry: Registry,
  refs: readonly Ref[],
  prefabs?: PrefabLibrary,
): TreeLift {
  const lift = promoteOps(def, refs, registry);
  if (lift.ops.length === 0) return { ...lift, def };
  const result = applyOps(def, { base: sceneHash(def), ops: lift.ops }, registry, {
    validate: "none",
    ...(prefabs ? { prefabs } : {}),
  });
  return result.ok ? { ...lift, def: result.def } : { ops: [], refs: [...refs], def };
}

/** `ops` after `lift`'s promotes, with the `base` hash their bulk refs need. */
export function liftedBatch(
  def: SceneDefinition,
  lift: Pick<TreeLift, "ops">,
  label: string,
  ops: readonly SceneOp[],
): OpBatch {
  return lift.ops.length > 0
    ? { label, base: sceneHash(def), ops: [...lift.ops, ...ops] }
    : { label, ops: [...ops] };
}

/**
 * Where `refs` are once `batch`'s promotes apply: a promoted drawn shape
 * under the id it took, and a drawn shape after one in its bucket a place
 * earlier.
 */
export function promotedRefs(batch: OpBatch, refs: readonly Ref[]): Ref[] {
  const to = new Map<Ref, string>();
  for (const op of batch.ops) if (op.op === "promote") to.set(op.ref, op.id);
  const gone = [...to.keys()].flatMap((r) => parseBulkId(r) ?? []);
  return refs.map((r) => {
    const id = to.get(r);
    if (id !== undefined) return id;
    const bulk = parseBulkId(r);
    if (!bulk) return r;
    const before = gone.filter((g) => g.key === bulk.key && g.index < bulk.index).length;
    return before > 0 ? bulkId(bulk.key, bulk.index - before) : r;
  });
}

/**
 * Why `ref` can't be put under a parent, in a designer's words; null when it
 * can. `type` is a document entity's type; a drawn shape's is its bucket's.
 */
export function outOfTreeReason(registry: Registry, ref: Ref, type?: string): string | null {
  if (headOfRef(ref) !== ref) return `In ${headOfRef(ref)}; unpack the instance to move it.`;
  const bulk = parseBulkId(ref);
  const t = type ?? (bulk ? bulkKeyType(bulk.key) : undefined);
  return t !== undefined && !canBeInTree(registry.types.get(t))
    ? `A ${t} can't be in the tree, so it stays at the root.`
    : null;
}

/**
 * What dragging `refs` moves in the tree: the scene's own entities,
 * instances and drawn shapes among them (no instance children), without any
 * that sit under another of them, since those come along.
 */
export function treeDragRoots(
  def: SceneDefinition,
  registry: Registry,
  prefabs: PrefabLibrary | undefined,
  refs: readonly Ref[],
): Ref[] {
  const ids = takenIds(def);
  const movable = [...new Set(refs)].filter((r) => ids.has(r) || parseBulkId(r) !== null);
  if (movable.length < 2) return movable;
  return documentTree(def, sceneFrames(def, registry, prefabs)).roots(movable);
}

/**
 * One batch for dropping `refs` in the tree: a `promote` for each drawn
 * shape, a `reparent` for those whose parent changes and, beside a sibling
 * or onto the parent they all already have, a `reorder` per list (entities,
 * instances) that changes. Nothing moves in the world. Null when nothing
 * changes.
 */
export function treeDropBatch(
  given: SceneDefinition,
  registry: Registry,
  prefabs: PrefabLibrary | undefined,
  refs: readonly Ref[],
  drop: TreeDrop,
): OpBatch | null {
  const lift = liftIntoTree(given, registry, refs, prefabs);
  const def = lift.def;
  const entities = def.entities ?? [];
  const instances = def.instances ?? [];
  const declared = new Map<string, Ref | undefined>(treeItems(def).map((d) => [d.id, d.parent]));
  const moving = lift.refs.filter((r) => declared.has(r));
  if (moving.length === 0) return null;
  const sibling =
    drop.kind === "reparent"
      ? undefined
      : "before" in drop
        ? { at: drop.before, after: false }
        : { at: drop.after, after: true };
  if (sibling && moving.includes(sibling.at)) return null;
  const frames = sceneFrames(def, registry, prefabs);
  const settled = (id: string) => frames.parentOf(id) ?? null;
  const parent = drop.kind === "reparent" ? drop.parent : settled(sibling!.at);
  const ops: SceneOp[] = [];
  const reparenting = moving.filter((r) => (declared.get(r) ?? null) !== parent);
  if (reparenting.length > 0) ops.push({ op: "reparent", refs: reparenting, parent });
  // Onto the parent every moving ref already has: last among its siblings.
  const last = drop.kind === "reparent" && reparenting.length === 0;
  if (sibling || last) {
    for (const list of [entities, instances]) {
      const mine = list.filter((d) => moving.includes(d.id));
      if (mine.length === 0) continue;
      const rest = list.filter((d) => !moving.includes(d.id));
      const siblings = rest.flatMap((d, i) => (settled(d.id) === parent ? [i] : []));
      const at = sibling ? rest.findIndex((d) => d.id === sibling.at) : -1;
      let index = at < 0 ? -1 : sibling!.after ? at + 1 : at;
      // Last, or beside a sibling in the other list: entities go after their last sibling entity, instances before their first sibling instance.
      if (index < 0)
        index =
          list === entities || last
            ? (siblings.at(-1) ?? rest.length - 1) + 1
            : (siblings[0] ?? rest.length);
      const next = [...rest.slice(0, index), ...mine, ...rest.slice(index)];
      const isSibling = (d: EntityDef | InstanceDef) =>
        mine.includes(d) || settled(d.id) === parent;
      const was = list.filter(isSibling);
      if (next.filter(isSibling).every((d, i) => d === was[i])) continue;
      ops.push({ op: "reorder", refs: mine.map((d) => d.id), index });
    }
  }
  if (ops.length === 0) return null;
  const what = itemsLabel(moving);
  let label: string;
  if (sibling) label = `Move ${what} ${sibling.after ? "after" : "before"} ${sibling.at}`;
  else if (last)
    label = parent === null ? `Move ${what} last at the root` : `Move ${what} last under ${parent}`;
  else label = reparentLabel(moving, parent);
  return liftedBatch(given, lift, label, ops);
}

/** Why `batch` would be refused against `def`, as dispatching it would judge it; null when it applies. */
export function treeDropRefusal(
  def: SceneDefinition,
  registry: Registry,
  prefabs: PrefabLibrary | undefined,
  batch: OpBatch,
): SceneIssue | null {
  const result = applyOps(def, { base: sceneHash(def), ...batch }, registry, {
    validate: "none",
    ...(prefabs ? { prefabs } : {}),
  });
  return result.ok ? null : result.issue;
}

/** The selectable refs in outline order, for range selection. */
export function outlineOrder(rows: readonly OutlineRow[]): Ref[] {
  return rows.flatMap((r) => (r.ref ? [r.ref] : []));
}
