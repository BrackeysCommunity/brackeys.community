import type { Registry } from "../game/types";
import { bulkId, parseBulkId } from "./bulk-ref";
import { makeIssue } from "./issues";
import {
  addPt,
  isZeroPt,
  subPt,
  translateBulkEntry,
  translateEntityDef,
  translateFieldValue,
} from "./translate";
import type {
  BulkEntry,
  EntityDef,
  InstanceDef,
  OpBatch,
  OverridePath,
  Prefab,
  PrefabLibrary,
  Pt,
  Ref,
  SceneDefinition,
  SceneIssue,
  SceneOp,
} from "./types";

/**
 * The resolved view: one scene with every instance inlined and every group
 * offset applied, in the shape of a scene without groups or instances. Every
 * consumer of world geometry (the runtime, picking, gizmos, renders,
 * physical checks) reads this, never the raw document; an edit made on it
 * maps back through `toSourceBatch`.
 */

/** Separates an instance's id from its child's in a resolved ref: `gate-3/door`. */
export const CHILD_SEPARATOR = "/";

/** The resolved ref of an instance's child: `gate-3/door`, `gate-3/~solid:0`. */
export const childRef = (instance: string, child: Ref): Ref =>
  `${instance}${CHILD_SEPARATOR}${child}`;

/** Splits a resolved child ref; `null` for a ref of the document itself. */
export function parseChildRef(ref: Ref): { instance: string; child: Ref } | null {
  const i = ref.indexOf(CHILD_SEPARATOR);
  if (i <= 0 || ref.startsWith("~")) return null;
  return { instance: ref.slice(0, i), child: ref.slice(i + 1) };
}

/** Splits an override key into the child it names and the field path in it. */
export function splitOverridePath(path: OverridePath): { child: Ref; field: string } | null {
  const dot = path.indexOf(".");
  if (dot <= 0 || dot === path.length - 1) return null;
  return { child: path.slice(0, dot), field: path.slice(dot + 1) };
}

const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

/** A group's origin; `[0, 0]` for no group or one that isn't declared. */
export function groupOrigin(def: SceneDefinition, group: string | undefined): Pt {
  const at = group === undefined ? undefined : def.groups?.[group]?.at;
  return at ? [at[0], at[1]] : [0, 0];
}

/** Where an instance's prefab origin lands in the world. */
export function instanceOrigin(def: SceneDefinition, inst: InstanceDef): Pt {
  return addPt(inst.at, groupOrigin(def, inst.group));
}

/** Writes `value` at a dot path, creating objects on the way; false when the path runs into a value. */
function setAtPath(root: Record<string, unknown>, field: string, value: unknown): boolean {
  const segs = field.split(".");
  let cur: unknown = root;
  for (const seg of segs.slice(0, -1)) {
    if (cur === null || typeof cur !== "object") return false;
    const obj = cur as Record<string, unknown>;
    if (obj[seg] === undefined) obj[seg] = {};
    cur = obj[seg];
  }
  if (cur === null || typeof cur !== "object") return false;
  const last = segs[segs.length - 1]!;
  if (Array.isArray(cur)) {
    if (!/^\d+$/.test(last) || Number(last) > cur.length) return false;
    cur[Number(last)] = clone(value);
  } else (cur as Record<string, unknown>)[last] = clone(value);
  return true;
}

/** The value at a dot path, or undefined. */
export function valueAtPath(root: unknown, field: string): unknown {
  let cur = root;
  for (const seg of field.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/** An instance's child in the prefab's own frame, its overrides applied. */
export type LocalChild =
  | { kind: "entity"; child: Ref; def: EntityDef }
  | { kind: "bulk"; child: Ref; key: string; index: number; value: BulkEntry };

/** The bulk entry a child ref names in a prefab, or its entity. */
function prefabChild(prefab: Prefab, child: Ref): LocalChild | null {
  const bulk = parseBulkId(child);
  if (bulk) {
    const value = prefab.bulk?.[bulk.key]?.[bulk.index];
    return value === undefined
      ? null
      : { kind: "bulk", child, key: bulk.key, index: bulk.index, value: clone(value) };
  }
  const def = prefab.entities.find((e) => e.id === child);
  return def ? { kind: "entity", child, def: clone(def) } : null;
}

/** Overrides grouped by the child they name. */
function overridesByChild(inst: InstanceDef): Map<Ref, [string, unknown][]> {
  const out = new Map<Ref, [string, unknown][]>();
  for (const [path, value] of Object.entries(inst.overrides ?? {})) {
    const split = splitOverridePath(path);
    if (!split) continue;
    const list = out.get(split.child) ?? [];
    list.push([split.field, value]);
    out.set(split.child, list);
  }
  return out;
}

/**
 * One child of an instance in the prefab's frame with the instance's
 * overrides applied; `null` when the prefab has no such child. A bulk
 * child's override names its bulk field (`~solid:0.shape`).
 */
export function localChild(
  prefab: Prefab,
  inst: InstanceDef,
  child: Ref,
  registry: Registry,
): LocalChild | null {
  const base = prefabChild(prefab, child);
  if (!base) return null;
  const overrides = overridesByChild(inst).get(child) ?? [];
  if (base.kind === "entity") {
    for (const [field, value] of overrides) setAtPath(base.def, field, value);
    return base;
  }
  const info = registry.bulkKey(base.key);
  for (const [field, value] of overrides)
    if (info && field === info.field) base.value = clone(value) as BulkEntry;
  return base;
}

/** Every child of an instance, in prefab order: entities, then bulk entries by key. */
export function localChildren(prefab: Prefab, inst: InstanceDef, registry: Registry): LocalChild[] {
  const refs: Ref[] = prefab.entities.map((e) => e.id);
  for (const [key, entries] of Object.entries(prefab.bulk ?? {}))
    entries.forEach((_, i) => refs.push(bulkId(key, i)));
  return refs.flatMap((r) => {
    const c = localChild(prefab, inst, r, registry);
    return c ? [c] : [];
  });
}

/** A local child as the entity it loads as: its resolved id and fields, still in the prefab's frame. */
export function childEntity(c: LocalChild, registry: Registry): EntityDef | null {
  if (c.kind === "entity") return c.def;
  const info = registry.bulkKey(c.key);
  if (!info) return null;
  const def: EntityDef = { id: c.child, type: info.type, [info.field]: c.value };
  if (info.material !== undefined) def.material = info.material;
  return def;
}

/** Rewrites a child's reference fields that name a sibling to the sibling's resolved ref. */
function remapChildRefs(
  def: EntityDef,
  instance: string,
  siblings: ReadonlySet<string>,
  registry: Registry,
): void {
  for (const { field } of registry.types.get(def.type)?.refs ?? []) {
    const value = valueAtPath(def, field);
    const map = (v: unknown) =>
      typeof v === "string" && siblings.has(v) ? childRef(instance, v) : v;
    if (Array.isArray(value)) setAtPath(def, field, value.map(map));
    else if (value !== undefined) setAtPath(def, field, map(value));
  }
}

/** Where a resolved entity came from. */
export type ResolvedOrigin =
  | { kind: "entity"; index: number }
  | { kind: "child"; instance: number; child: Ref };

export type ResolvedScene = {
  def: SceneDefinition;
  /** For each of `def.entities`, the document entity or instance child it is. */
  origins: ResolvedOrigin[];
};

/**
 * The resolved view and where each of its entities came from. A document
 * entity keeps its index, so pointers into `/entities/<i>` stay put; the
 * instances' children follow, instance by instance. An instance whose
 * prefab is missing contributes nothing (validation reports it); an `off`
 * instance's children are all `off`.
 */
export function resolveSceneDetailed(
  def: SceneDefinition,
  registry: Registry,
  prefabs?: PrefabLibrary,
): ResolvedScene {
  const own = def.entities ?? [];
  const origins: ResolvedOrigin[] = own.map((_, index) => ({ kind: "entity", index }));
  const hasGroups = def.groups !== undefined && Object.keys(def.groups).length > 0;
  if (!hasGroups && (def.instances ?? []).length === 0) return { def, origins };

  const entities: EntityDef[] = own.map((e) => {
    const at = groupOrigin(def, e.group);
    return isZeroPt(at) ? e : (translateEntityDef(registry, e, at) ?? e);
  });
  (def.instances ?? []).forEach((inst, i) => {
    const prefab = prefabs?.get(inst.prefab);
    if (!prefab) return;
    const at = instanceOrigin(def, inst);
    const children = localChildren(prefab, inst, registry);
    const siblings = new Set(children.map((c) => c.child));
    for (const c of children) {
      const local = childEntity(c, registry);
      if (!local) continue;
      const moved = translateEntityDef(registry, local, at) ?? local;
      const out: EntityDef = { ...moved, id: childRef(inst.id, c.child) };
      delete out.group;
      if (inst.group !== undefined) out.group = inst.group;
      if (out.layer === undefined && inst.layer !== undefined) out.layer = inst.layer;
      if (inst.off) out.off = true;
      remapChildRefs(out, inst.id, siblings, registry);
      entities.push(out);
      origins.push({ kind: "child", instance: i, child: c.child });
    }
  });
  const out: SceneDefinition = { ...def, entities };
  delete out.groups;
  delete out.instances;
  if (entities.length === 0) delete out.entities;
  return { def: out, origins };
}

/** The resolved view of a scene (see `resolveSceneDetailed`). Returns `def` itself when it has no groups or instances. */
export function resolveScene(
  def: SceneDefinition,
  registry: Registry,
  prefabs?: PrefabLibrary,
): SceneDefinition {
  return resolveSceneDetailed(def, registry, prefabs).def;
}

// ─── Edits on the resolved view ──────────────────────────

export type SourceBatchResult = { ok: true; batch: OpBatch } | { ok: false; issue: SceneIssue };

class MapFailure extends Error {
  constructor(readonly issue: SceneIssue) {
    super(issue.message);
  }
}

const refuse = (message: string, ref: Ref): never => {
  throw new MapFailure(makeIssue("op-invalid", { message, entityIds: [ref], got: ref }));
};

/**
 * Maps a batch written against the resolved view (world coordinates,
 * instance children by `gate-3/door`) back onto the document:
 *
 * - an edit to an instance child becomes an `override` of the fields it
 *   changes, in the prefab's frame (a field moved back to the prefab's own
 *   value drops its override instead);
 * - a group member's geometry, and an instance's `at`, lose the group's
 *   origin;
 * - removing or renaming a child is refused, since a child only exists
 *   through its instance.
 *
 * Every other op passes through as written. `apply` runs one op on a
 * scratch scene holding a single child (`toSourceBatch` in `ops.ts` passes
 * the op engine's).
 */
export function mapResolvedBatch(
  def: SceneDefinition,
  batch: OpBatch,
  registry: Registry,
  prefabs: PrefabLibrary | undefined,
  apply: ChildApply,
): SourceBatchResult {
  try {
    const ops = batch.ops.flatMap((op) => mapOp(def, op, registry, prefabs, apply));
    return { ok: true, batch: { ...batch, ops } };
  } catch (err) {
    if (err instanceof MapFailure) return { ok: false, issue: err.issue };
    throw err;
  }
}

/**
 * Runs one op on a scratch scene holding just a child (the entity under its
 * own id, a bulk entry as `~key:0`), as `applyOps` would, and returns the
 * child after it.
 */
export type ChildApply = (child: LocalChild, op: SceneOp) => LocalChild;

/** A `ChildApply` that refuses every child edit, for callers with no op engine at hand. */
export const NO_CHILD_EDITS: ChildApply = (child) =>
  refuse(`${child.child} is an instance child; edit it through an override.`, child.child);

function entityOf(def: SceneDefinition, id: string): EntityDef | undefined {
  return def.entities?.find((e) => e.id === id);
}

function instanceOf(def: SceneDefinition, id: string): InstanceDef | undefined {
  return def.instances?.find((i) => i.id === id);
}

function childTarget(
  def: SceneDefinition,
  ref: Ref,
  registry: Registry,
  prefabs: PrefabLibrary | undefined,
) {
  const split = parseChildRef(ref);
  if (!split) return null;
  const inst = instanceOf(def, split.instance);
  if (!inst) return refuse(`No instance has the id "${split.instance}".`, ref);
  const prefab = prefabs?.get(inst.prefab);
  if (!prefab) return refuse(`${split.instance}'s prefab "${inst.prefab}" isn't loaded.`, ref);
  const child = localChild(prefab, inst, split.child, registry);
  if (!child) return refuse(`Prefab "${inst.prefab}" has no child "${split.child}".`, ref);
  const base = prefabChild(prefab, split.child)!;
  return { inst, child, base, at: instanceOrigin(def, inst) };
}

/** The top-level fields of a child that `after` changed, as override set and revert paths. */
function overrideOps(
  inst: InstanceDef,
  base: LocalChild,
  before: LocalChild,
  after: LocalChild,
  registry: Registry,
): SceneOp[] {
  const fieldsOf = (c: LocalChild): Record<string, unknown> => {
    if (c.kind === "entity") return c.def;
    const info = registry.bulkKey(c.key);
    return info ? { [info.field]: c.value } : {};
  };
  const b = fieldsOf(before);
  const a = fieldsOf(after);
  const o = fieldsOf(base);
  const set: Record<string, unknown> = {};
  const revert: string[] = [];
  const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
  for (const field of new Set([...Object.keys(b), ...Object.keys(a)])) {
    if (field === "id" || field === "type" || same(a[field], b[field])) continue;
    const path = `${before.child}.${field}`;
    if (same(a[field], o[field])) {
      const keys = Object.keys(inst.overrides ?? {});
      revert.push(...keys.filter((p) => p === path || p.startsWith(`${path}.`)));
    } else if (a[field] === undefined) {
      refuse(
        `Can't remove ${before.child}'s ${field} from one instance; edit the prefab.`,
        inst.id,
      );
    } else set[path] = clone(a[field]);
  }
  const ops: SceneOp[] = [];
  if (revert.length > 0) ops.push({ op: "revertOverride", ref: inst.id, paths: revert });
  if (Object.keys(set).length > 0) ops.push({ op: "override", ref: inst.id, set });
  return ops;
}

function mapOp(
  def: SceneDefinition,
  op: SceneOp,
  registry: Registry,
  prefabs: PrefabLibrary | undefined,
  apply: ChildApply,
): SceneOp[] {
  const onChild = (ref: Ref, local: (at: Pt) => SceneOp): SceneOp[] | null => {
    const t = childTarget(def, ref, registry, prefabs);
    if (!t) return null;
    const after = apply(t.child, local(t.at));
    return overrideOps(t.inst, t.base, t.child, after, registry);
  };
  const scratchRef = (t: LocalChild) => (t.kind === "entity" ? t.child : bulkId(t.key, 0));

  switch (op.op) {
    case "update": {
      const child = onChild(op.ref, (at) => {
        const t = childTarget(def, op.ref, registry, prefabs)!;
        const set: Record<string, unknown> = {};
        const local = t.child.kind === "entity" ? t.child.def : undefined;
        for (const [path, value] of Object.entries(op.set ?? {}))
          set[path] = local
            ? translateFieldValue(registry, local, path, value, [-at[0], -at[1]])
            : translateBulkValue(value, [-at[0], -at[1]]);
        return {
          op: "update",
          ref: scratchRef(t.child),
          ...(op.set ? { set } : {}),
          ...(op.unset ? { unset: op.unset } : {}),
        };
      });
      if (child) return child;
      const e = entityOf(def, op.ref);
      if (e && op.set) {
        const at = groupOrigin(def, e.group);
        if (isZeroPt(at)) return [op];
        const set: Record<string, unknown> = {};
        for (const [path, value] of Object.entries(op.set))
          set[path] = translateFieldValue(registry, e, path, value, [-at[0], -at[1]]);
        return [{ ...op, set }];
      }
      const inst = instanceOf(def, op.ref);
      if (inst && op.set && Array.isArray(op.set.at)) {
        const at = groupOrigin(def, inst.group);
        return [{ ...op, set: { ...op.set, at: subPt(op.set.at as Pt, at) } }];
      }
      return [op];
    }
    case "move": {
      const children = op.refs.filter((r) => parseChildRef(r));
      if (children.length === 0) return [op];
      const rest = op.refs.filter((r) => !parseChildRef(r));
      const out: SceneOp[] = rest.length > 0 ? [{ ...op, refs: rest }] : [];
      for (const r of children)
        out.push(
          ...onChild(r, () => {
            const t = childTarget(def, r, registry, prefabs)!;
            return { op: "move", refs: [scratchRef(t.child)], by: op.by };
          })!,
        );
      return out;
    }
    case "place": {
      const child = onChild(op.ref, (at) => {
        const t = childTarget(def, op.ref, registry, prefabs)!;
        return { ...op, ref: scratchRef(t.child), at: subPt(op.at, at) };
      });
      if (child) return child;
      const e = entityOf(def, op.ref) ?? instanceOf(def, op.ref);
      const at = groupOrigin(def, e?.group);
      return isZeroPt(at) ? [op] : [{ ...op, at: subPt(op.at, at) }];
    }
    case "remove": {
      for (const r of op.refs)
        if (parseChildRef(r))
          refuse(`${r} belongs to an instance; remove the instance, or unpack it first.`, r);
      return [op];
    }
    case "add": {
      const at = groupOrigin(def, op.entity.group);
      if (isZeroPt(at)) return [op];
      const entity = translateEntityDef(registry, op.entity as EntityDef, [-at[0], -at[1]]);
      return [{ ...op, entity: (entity ?? op.entity) as typeof op.entity }];
    }
    case "instantiate": {
      const at = groupOrigin(def, op.instance.group);
      return isZeroPt(at)
        ? [op]
        : [{ ...op, instance: { ...op.instance, at: subPt(op.instance.at, at) } }];
    }
    case "rename":
      if (parseChildRef(op.from))
        refuse(`${op.from} belongs to an instance; its id comes from the prefab.`, op.from);
      return [op];
    default:
      return [op];
  }
}

function translateBulkValue(value: unknown, by: Pt): unknown {
  return Array.isArray(value) && value.length > 0
    ? translateBulkEntry(value as BulkEntry, by)
    : value;
}

/**
 * Maps an issue found on the resolved view back onto the document: a
 * pointer into an instance child points at the instance, and a fix goes
 * through `mapBatch` (one it can't map is dropped). The identity when the
 * document has no groups or instances.
 */
export function issueOnSource(
  source: SceneDefinition,
  origins: readonly ResolvedOrigin[],
  mapBatch: (batch: OpBatch) => SourceBatchResult,
): (issue: SceneIssue) => SceneIssue {
  const plain =
    (source.instances ?? []).length === 0 &&
    (source.groups === undefined || Object.keys(source.groups).length === 0);
  if (plain) return (issue) => issue;
  return (issue) => {
    let out = issue;
    const m = issue.path === undefined ? null : /^\/entities\/(\d+)/.exec(issue.path);
    const origin = m ? origins[Number(m[1])] : undefined;
    if (origin?.kind === "child") out = { ...out, path: `/instances/${origin.instance}` };
    if (out.fix) {
      const mapped = mapBatch(out.fix);
      const { fix: _fix, ...rest } = out;
      out = mapped.ok ? { ...rest, fix: mapped.batch } : rest;
    }
    return out;
  };
}
