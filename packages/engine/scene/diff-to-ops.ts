import type { Registry } from "../game/types";
import { bulkOffset, lcsPairs, pairBulk } from "./diff";
import { bulkEntries, bulkId, bulkKeysOf } from "./expand";
import { sortedAssets } from "./format";
import { parentsFirst } from "./fragment";
import { sceneHash } from "./hash";
import { usesBulkRefs } from "./ops-schema";
import { parseChildRef } from "./resolve";
import type {
  BulkEntry,
  BulkKey,
  EntityDef,
  EntityInput,
  InstanceDef,
  InstanceInput,
  OpBatch,
  Prefab,
  Pt,
  Ref,
  SceneDefinition,
  SceneOp,
  ShapeTuple,
} from "./types";

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Order-insensitive equality for JSON values, the way `formatScene` compares them. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => same(v, b[i]));
  }
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  if (ka.length !== kb.length) return false;
  return ka.every((k) =>
    same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

/**
 * Positions (into `xs`) of a longest strictly increasing subsequence. Used
 * to keep as many surviving entities in place as their new order allows.
 */
function longestIncreasing(xs: readonly number[]): Set<number> {
  const tails: number[] = [];
  const prev: number[] = Array.from({ length: xs.length }, () => -1);
  xs.forEach((x, i) => {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (xs[tails[mid]!]! < x) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1]!;
    tails[lo] = i;
  });
  const out = new Set<number>();
  for (let i = tails.length > 0 ? tails[tails.length - 1]! : -1; i >= 0; i = prev[i]!) out.add(i);
  return out;
}

/** Ascending indices split into runs of consecutive ones. */
function runs(xs: readonly number[]): number[][] {
  const out: number[][] = [];
  for (const x of xs) {
    const last = out[out.length - 1];
    if (last && last[last.length - 1] === x - 1) last.push(x);
    else out.push([x]);
  }
  return out;
}

/**
 * An order-keeping alignment of two bulk arrays: entries equal on both
 * sides stay (LCS), then within each gap between them the entries that
 * moved or were resized pair up (a second LCS), and what's left pairs by
 * position. `pairs` are the entries that change in place; the rest of `a`
 * is removed and the rest of `b` added.
 */
function alignBucket(va: readonly BulkEntry[], vb: readonly BulkEntry[]) {
  const ka = va.map((v) => JSON.stringify(v));
  const kb = vb.map((v) => JSON.stringify(v));
  const kept = lcsPairs(va.length, vb.length, (i, j) => ka[i] === kb[j]);
  const pairs: [number, number][] = [];
  const removed: number[] = [];
  const added: number[] = [];

  const byPosition = (i0: number, i1: number, j0: number, j1: number) => {
    const n = Math.min(i1 - i0, j1 - j0);
    for (let k = 0; k < n; k++) pairs.push([i0 + k, j0 + k]);
    for (let i = i0 + n; i < i1; i++) removed.push(i);
    for (let j = j0 + n; j < j1; j++) added.push(j);
  };
  const gap = (i0: number, i1: number, j0: number, j1: number) => {
    if (i0 === i1 || j0 === j1) return byPosition(i0, i1, j0, j1);
    const near = lcsPairs(i1 - i0, j1 - j0, (i, j) => pairBulk(va[i0 + i]!, vb[j0 + j]!) !== null);
    let i = i0;
    let j = j0;
    for (const [di, dj] of near) {
      byPosition(i, i0 + di, j, j0 + dj);
      pairs.push([i0 + di, j0 + dj]);
      i = i0 + di + 1;
      j = j0 + dj + 1;
    }
    byPosition(i, i1, j, j1);
  };

  let i = 0;
  let j = 0;
  for (const [ki, kj] of kept) {
    gap(i, ki, j, kj);
    i = ki + 1;
    j = kj + 1;
  }
  gap(i, va.length, j, vb.length);
  return { pairs, removed, added };
}

const HEADER_FIXED = ["$schema", "v", "game"] as const;

/**
 * A `setZ` when `b` is `a` with only its `z` changed (and not to an explicit
 * 0, which `setZ` writes as absent), else the `update` that turns `a` into `b`.
 */
function namedUpdate(a: EntityDef, b: EntityDef): SceneOp | null {
  const update = entityUpdate(a, b);
  if (update?.op !== "update" || b.z === 0) return update;
  const keys = [...Object.keys(update.set ?? {}), ...(update.unset ?? [])];
  return keys.length === 1 && keys[0] === "z" ? { op: "setZ", refs: [a.id], z: b.z ?? 0 } : update;
}

function entityUpdate(a: EntityDef, b: EntityDef): SceneOp | null {
  const set: Record<string, unknown> = {};
  const unset: string[] = [];
  for (const k of Object.keys(a))
    if (k !== "id" && a[k] !== undefined && b[k] === undefined) unset.push(k);
  for (const [k, v] of Object.entries(b)) {
    if (k === "id" || v === undefined || same(a[k], v)) continue;
    set[k] = clone(v);
  }
  if (Object.keys(set).length === 0 && unset.length === 0) return null;
  return {
    op: "update",
    ref: a.id,
    ...(Object.keys(set).length > 0 ? { set } : {}),
    ...(unset.length > 0 ? { unset } : {}),
  };
}

function bulkForm(
  key: BulkKey,
  values: readonly BulkEntry[],
  registry?: Registry,
): "shape" | "point" {
  return registry?.bulkKey(key)?.form ?? (typeof values[0]?.[0] === "string" ? "shape" : "point");
}

/**
 * The ops that turn instance `a` into `b`: a `setParam` per param that
 * changed, then the rest as `namedUpdate` writes it. A null param, which
 * `setParam` reads as a clear, stays in the `update`.
 */
function instanceChange(a: InstanceDef, b: InstanceDef): SceneOp[] {
  const pa = a.params ?? {};
  const pb = b.params ?? {};
  if (Object.values(pb).some((v) => v === null)) {
    const update = namedUpdate(a as unknown as EntityDef, b as unknown as EntityDef);
    return update ? [update] : [];
  }
  const { params: _a, ...restA } = a;
  const { params: _b, ...restB } = b;
  const update = namedUpdate(restA as unknown as EntityDef, restB as unknown as EntityDef);
  const ops: SceneOp[] = update ? [update] : [];
  for (const name of [...new Set([...Object.keys(pa), ...Object.keys(pb)])].sort())
    if (!same(pa[name], pb[name]))
      ops.push({ op: "setParam", ref: a.id, name, value: name in pb ? clone(pb[name]) : null });
  return ops;
}

/**
 * Aligns two lists of things with ids (entities, instances): one on both
 * sides that `matches` stays and gets an `update` of its top-level fields,
 * survivors that changed places get `reorder`s, and the rest is removed or
 * added. `adds` are the rest of `bs` with their places in it; `insertAt`
 * gives the index each takes when they are added, in any order, after the
 * reorders.
 */
function alignNamed<T extends { id: string }>(
  as: readonly T[],
  bs: readonly T[],
  matches: (a: T, b: T) => boolean,
  change: (a: T, b: T) => SceneOp[],
) {
  const inA = new Map<string, T>();
  for (const x of as) if (!inA.has(x.id)) inA.set(x.id, x);
  const kept = new Set<string>();
  for (const y of bs) {
    const x = inA.get(y.id);
    if (x && !kept.has(y.id) && matches(x, y)) kept.add(y.id);
  }
  const removeRefs = as.filter((x) => !kept.has(x.id) || inA.get(x.id) !== x).map((x) => x.id);
  const updates = new Map<string, SceneOp[]>();
  for (const y of bs) if (kept.has(y.id)) updates.set(y.id, change(inA.get(y.id)!, y));
  const list = as.filter((x) => kept.has(x.id) && inA.get(x.id) === x).map((x) => x.id);
  const target = bs.filter((y) => kept.has(y.id)).map((y) => y.id);
  const reorders: SceneOp[] = [];
  const inOrder = longestIncreasing(target.map((id) => list.indexOf(id)));
  target.forEach((id, k) => {
    if (inOrder.has(k)) return;
    const from = list.indexOf(id);
    list.splice(from, 1);
    const before = target.slice(0, k).filter((t) => list.includes(t));
    const index = before.length === 0 ? 0 : list.indexOf(before[before.length - 1]!) + 1;
    list.splice(index, 0, id);
    reorders.push({ op: "reorder", refs: [id], index });
  });
  const adds = bs.flatMap((item, j) => (kept.has(item.id) ? [] : [{ item, j }]));
  const present = bs.map((y) => kept.has(y.id));
  let length = list.length;
  /** The index `bs[j]` is added at, counting what is in place by then; none at the end. */
  const insertAt = (j: number): { index?: number } => {
    let index = 0;
    for (let k = 0; k < j; k++) if (present[k]) index++;
    present[j] = true;
    length++;
    return index === length - 1 ? {} : { index };
  };
  return { kept, removeRefs, updates, reorders, adds, insertAt };
}

/** An entity or instance without its `parent`, which only `reparent` changes. */
function unparented<T extends { parent?: Ref }>(x: T): T {
  if (x.parent === undefined) return x;
  const { parent: _parent, ...rest } = x;
  return rest as T;
}

/** Base fields that hold no geometry, so a `reparent` leaves them as they are. */
const PLACE_FREE_FIELDS: readonly string[] = ["name", "layer", "z", "off"];

/**
 * The `update` that puts `b`'s stored fields on an entity that was `a`
 * before a `reparent` re-expressed its geometry: every field but its
 * identity, since the re-expressed values aren't known here, and an unset
 * of what `b` lacks, a node's `rot` and `flip` included (a turned frame
 * gives a node one).
 */
function restoreEntity(a: EntityDef, b: EntityDef): SceneOp | null {
  const set: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(b)) {
    if (k === "id" || k === "type" || k === "parent" || v === undefined) continue;
    if (PLACE_FREE_FIELDS.includes(k) && same(a[k], v)) continue;
    set[k] = clone(v);
  }
  const unset = Object.keys(a).filter(
    (k) => k !== "id" && k !== "type" && k !== "parent" && a[k] !== undefined && b[k] === undefined,
  );
  for (const k of ["rot", "flip"])
    if (b.type === "node" && b[k] === undefined && !unset.includes(k)) unset.push(k);
  if (Object.keys(set).length === 0 && unset.length === 0) return null;
  return {
    op: "update",
    ref: a.id,
    ...(Object.keys(set).length > 0 ? { set } : {}),
    ...(unset.length > 0 ? { unset } : {}),
  };
}

/**
 * `restoreEntity` for an instance: its `at`, turn and flip always, which
 * are all a `reparent` changes, and its other fields and params as
 * `instanceChange` writes them.
 */
function restoreInstance(a: InstanceDef, b: InstanceDef): SceneOp[] {
  const ops = instanceChange(unparented(a), unparented(b));
  const own = ops.findIndex((op) => op.op === "update" || op.op === "setZ");
  const was = ops[own];
  const set: Record<string, unknown> = {
    ...(was?.op === "update" ? was.set : was?.op === "setZ" ? { z: b.z } : {}),
    at: clone(b.at),
    rot: b.rot ?? 0,
    flip: b.flip === true,
  };
  const unset = (was?.op === "update" ? (was.unset ?? []) : []).filter(
    (k) => k !== "rot" && k !== "flip",
  );
  const update: SceneOp = { op: "update", ref: a.id, set, ...(unset.length > 0 ? { unset } : {}) };
  if (own < 0) return [update, ...ops];
  ops[own] = update;
  return ops;
}

const ownerOf = (ref: Ref) => parseChildRef(ref)?.instance ?? ref;

/**
 * How the parents change from `a` to `b` for the entities and instances
 * that stay (`kept`, by id), given what is `removed`:
 *
 * - `restored`: those whose `parent` changes, those directly under
 *   something removed, since `remove` takes a subtree with it, and
 *   everything below either, added ones included, whose stored geometry a
 *   `reparent` may rewrite to keep it in place;
 * - `restoreOrder`: what gets restored sorted parents first;
 * - `detach`: the ones directly under something removed, which go to the
 *   root before the `remove` with what sits under them;
 * - `removeOrder`: removals sorted children first;
 * - `attach()`: the `reparent`s, after the adds, that put each moving one
 *   under its parent in `b`, in an order that never makes a cycle on the
 *   way (one that can't go yet goes to the root first). Throws when `b`'s
 *   own parents form a cycle, since no op makes one.
 */
function parentMoves(
  a: SceneDefinition,
  b: SceneDefinition,
  removed: ReadonlySet<string>,
  kept: readonly string[],
) {
  const parents = (def: SceneDefinition) => {
    const out = new Map<string, Ref | undefined>();
    for (const x of [...(def.entities ?? []), ...(def.instances ?? [])])
      if (!out.has(x.id)) out.set(x.id, x.parent);
    return out;
  };
  const before = parents(a);
  const after = parents(b);
  /** The owners above `id` in `map`, nearest first, stopping at a cycle. */
  const chain = (map: ReadonlyMap<string, Ref | undefined>, id: string): string[] => {
    const out: string[] = [];
    for (let p = map.get(id); p !== undefined; p = map.get(ownerOf(p))) {
      const owner = ownerOf(p);
      if (owner === id || out.includes(owner)) break;
      out.push(owner);
    }
    return out;
  };
  const detach = kept.filter((id) => {
    const p = before.get(id);
    return p !== undefined && removed.has(ownerOf(p));
  });
  const moving = new Set([...kept.filter((id) => before.get(id) !== after.get(id)), ...detach]);
  // A reparent rewrites what sits under an entity whose frame comes from its geometry, so all of it is restored.
  const restored = new Set([
    ...moving,
    ...[...after.keys()].filter((id) =>
      [...chain(before, id), ...chain(after, id)].some((o) => moving.has(o)),
    ),
  ]);
  /** `items` sorted parents first by their places in `b`. */
  const restoreOrder = <T extends { id: string }>(items: readonly T[]) =>
    items
      .map((x, k) => ({ x, k, d: chain(after, x.id).length }))
      .sort((p, q) => p.d - q.d || p.k - q.k)
      .map(({ x }) => x);
  const depth = new Map([...before.keys()].map((id) => [id, chain(before, id).length]));
  const removeOrder = (refs: readonly Ref[]) =>
    refs
      .map((ref, k) => ({ ref, k, d: depth.get(ref) ?? 0 }))
      .sort((x, y) => y.d - x.d || x.k - y.k)
      .map((x) => x.ref);

  const attach = (): SceneOp[] => {
    const now = new Map(after);
    for (const id of kept) now.set(id, detach.includes(id) ? undefined : before.get(id));
    const pending = kept.filter((id) => moving.has(id) && now.get(id) !== after.get(id));
    const out: { refs: Ref[]; parent: Ref | null }[] = [];
    const emit = (id: string, parent: Ref | undefined) => {
      now.set(id, parent);
      const last = out[out.length - 1];
      if (last && last.parent === (parent ?? null)) last.refs.push(id);
      else out.push({ refs: [id], parent: parent ?? null });
    };
    while (pending.length > 0) {
      const k = pending.findIndex((id) => {
        const p = after.get(id);
        return p === undefined || (ownerOf(p) !== id && !chain(now, ownerOf(p)).includes(id));
      });
      if (k >= 0) {
        const id = pending.splice(k, 1)[0]!;
        emit(id, after.get(id));
        continue;
      }
      const stuck = pending.find((id) => now.get(id) !== undefined);
      if (stuck === undefined)
        throw new Error("diffToOps: the target scene's parents form a cycle, which no op makes.");
      emit(stuck, undefined);
    }
    return out.map(({ refs, parent }) => ({ op: "reparent", refs, parent }));
  };
  return { restored, detach, removeOrder, restoreOrder, attach };
}

/**
 * A batch that turns scene `a` into scene `b`: `applyOps(a, diffToOps(a, b))`
 * formats exactly as `b`.
 *
 * Named entities match by id. One present on both sides with the same type
 * becomes an `update` (set and unset of the top-level fields that differ), so
 * a live doc keeps its key, and a survivor whose place in the order moved a
 * `reorder`; a type change is removed and added again. New entities are
 * added at their index. Bulk arrays keep the entries they share in order (LCS); an entry
 * that only moved becomes a `move` (one per offset), one resized or
 * otherwise changed in place an `update` of its shape or point, and the
 * rest is removed or added. The header goes through `setScene`, settings
 * through `setSettings`, the `assets` header through `useAssets`. Instances match by id
 * like named entities, their `rot`, `flip` and `overrides` through
 * `update`, each changed param through `setParam`; a change of only `z` is a `setZ`, and one placing
 * another prefab is removed and instantiated again. A grid field that
 * changed is one `update` of the whole field.
 *
 * A `parent` never goes through `update`. One that changes is a `reparent`
 * after the adds, followed by an `update` that puts the stored geometry
 * back exactly, on it and on everything below it; something under a removed entity or instance goes to the
 * root first, since `remove` takes a subtree. Removals list children
 * before their parents, and adds put a parent before what sits under it.
 *
 * `registry` tells point-form bulk keys from shape-form ones; without it the
 * values decide. Throws when `$schema`, `v` or `game` differ, when `b` has
 * no `name`, or when `b`'s parents form a cycle, since no op makes those.
 */
export function diffToOps(a: SceneDefinition, b: SceneDefinition, registry?: Registry): OpBatch {
  for (const k of HEADER_FIXED) {
    if (!same(a[k], b[k]))
      throw new Error(`diffToOps: the scenes differ in "${k}", which no op can change.`);
  }

  const ops: SceneOp[] = [];

  const header: { name?: string; bounds?: SceneDefinition["bounds"] } = {};
  if (a.name !== b.name) {
    if (typeof b.name !== "string") throw new Error("diffToOps: the target scene has no name.");
    header.name = b.name;
  }
  if (!same(a.bounds, b.bounds)) header.bounds = clone(b.bounds);
  if (Object.keys(header).length > 0) ops.push({ op: "setScene", set: header });

  const sa = (a.settings ?? {}) as Record<string, unknown>;
  const sb = (b.settings ?? {}) as Record<string, unknown>;
  const settingsSet: Record<string, unknown> = {};
  const settingsUnset = Object.keys(sa).filter((k) => sa[k] !== undefined && sb[k] === undefined);
  for (const [k, v] of Object.entries(sb))
    if (v !== undefined && !same(sa[k], v)) settingsSet[k] = clone(v);
  if (Object.keys(settingsSet).length > 0 || settingsUnset.length > 0) {
    ops.push({
      op: "setSettings",
      ...(Object.keys(settingsSet).length > 0 ? { set: settingsSet } : {}),
      ...(settingsUnset.length > 0 ? { unset: settingsUnset } : {}),
    });
  }

  const assetsA = new Set(a.assets ?? []);
  const assetsB = new Set(b.assets ?? []);
  const assetAdds = sortedAssets([...assetsB].filter((id) => !assetsA.has(id)));
  const assetRemoves = sortedAssets([...assetsA].filter((id) => !assetsB.has(id)));
  if (assetAdds.length > 0 || assetRemoves.length > 0) {
    ops.push({
      op: "useAssets",
      ...(assetAdds.length > 0 ? { add: assetAdds } : {}),
      ...(assetRemoves.length > 0 ? { remove: assetRemoves } : {}),
    });
  }

  // ─── Named entities and instances ─────────────────────
  const named = alignNamed(
    a.entities ?? [],
    b.entities ?? [],
    (x, y) => x.type === y.type,
    (x, y) => {
      const update = namedUpdate(unparented(x), unparented(y));
      return update ? [update] : [];
    },
  );
  const instances = alignNamed(
    a.instances ?? [],
    b.instances ?? [],
    (x, y) => x.prefab === y.prefab,
    (x, y) => instanceChange(unparented(x), unparented(y)),
  );
  const tree = parentMoves(a, b, new Set([...named.removeRefs, ...instances.removeRefs]), [
    ...named.kept,
    ...instances.kept,
  ]);
  const removeRefs: Ref[] = tree.removeOrder([...named.removeRefs, ...instances.removeRefs]);
  const updates: SceneOp[] = [];
  const restoring: { id: string; ops: SceneOp[] }[] = [];
  const aEntities = new Map((a.entities ?? []).map((e) => [e.id, e]));
  const aInstances = new Map((a.instances ?? []).map((i) => [i.id, i]));
  const added = new Set([...named.adds, ...instances.adds].map(({ item }) => item.id));
  for (const e of b.entities ?? []) {
    if (!tree.restored.has(e.id)) {
      if (named.kept.has(e.id)) updates.push(...named.updates.get(e.id)!);
      continue;
    }
    const restore = restoreEntity(added.has(e.id) ? e : aEntities.get(e.id)!, e);
    if (restore) restoring.push({ id: e.id, ops: [restore] });
  }
  for (const i of b.instances ?? []) {
    if (!tree.restored.has(i.id)) {
      if (instances.kept.has(i.id)) updates.push(...instances.updates.get(i.id)!);
      continue;
    }
    const was = added.has(i.id) ? i : aInstances.get(i.id)!;
    restoring.push({ id: i.id, ops: restoreInstance(was, i) });
  }
  const restores = tree.restoreOrder(restoring).flatMap((r) => r.ops);
  const reorders = [...named.reorders, ...instances.reorders];

  // ─── Bulk arrays ───────────────────────────────────────
  const moves = new Map<string, { by: Pt; refs: Ref[] }>();
  const bulkUpdates: SceneOp[] = [];
  const bulkAdds: SceneOp[] = [];
  const keys = [...new Set([...bulkKeysOf(a), ...bulkKeysOf(b)])].sort();
  for (const key of keys) {
    const va = bulkEntries(a, key);
    const vb = bulkEntries(b, key);
    if (same(va, vb)) continue;
    const form = bulkForm(key, va.length > 0 ? va : vb, registry);
    const field = form === "shape" ? "shape" : "at";
    const step = alignBucket(va, vb);
    for (const [i, j] of step.pairs) {
      const ref = bulkId(key, i);
      const by = bulkOffset(va[i]!, vb[j]!);
      if (by && Number.isFinite(by[0]) && Number.isFinite(by[1])) {
        const id = `${by[0]},${by[1]}`;
        const move = moves.get(id);
        if (move) move.refs.push(ref);
        else moves.set(id, { by, refs: [ref] });
      } else {
        bulkUpdates.push({ op: "update", ref, set: { [field]: clone(vb[j]!) } });
      }
    }
    for (const i of step.removed) removeRefs.push(bulkId(key, i));
    let length = va.length - step.removed.length;
    for (const run of runs(step.added)) {
      const values = clone(run.map((j) => vb[j]!));
      const index = run[0]!;
      const atEnd = index === length;
      length += run.length;
      bulkAdds.push(
        form === "point"
          ? { op: "addBulk", key, points: values as Pt[], ...(atEnd ? {} : { index }) }
          : { op: "addBulk", key, shapes: values as ShapeTuple[], ...(atEnd ? {} : { index }) },
      );
    }
  }

  if (tree.detach.length > 0) ops.push({ op: "reparent", refs: tree.detach, parent: null });
  if (removeRefs.length > 0) ops.push({ op: "remove", refs: removeRefs });
  for (const { by, refs } of moves.values()) ops.push({ op: "move", refs, by });
  ops.push(...updates, ...bulkUpdates, ...reorders);
  // Something added under a parent that is added too comes after it.
  const adding = [
    ...named.adds.map((x) => ({ ...x, entity: true })),
    ...instances.adds.map((x) => ({ ...x, entity: false })),
  ];
  let bulkPlaced = false;
  const order = parentsFirst(
    adding,
    (x) => x.item.id,
    (x) => (x.item.parent === undefined ? undefined : ownerOf(x.item.parent)),
  );
  for (const { item, j, entity } of order) {
    if (!entity && !bulkPlaced) {
      ops.push(...bulkAdds);
      bulkPlaced = true;
    }
    if (entity) ops.push({ op: "add", entity: clone(item) as EntityInput, ...named.insertAt(j) });
    else {
      ops.push({
        op: "instantiate",
        instance: clone(item) as InstanceInput,
        ...instances.insertAt(j),
      });
    }
  }
  if (!bulkPlaced) ops.push(...bulkAdds);
  ops.push(...tree.attach(), ...restores);

  const batch: OpBatch = { ops };
  if (usesBulkRefs(batch)) batch.base = sceneHash(a);
  return batch;
}

/**
 * A batch that turns a prefab doc's view (`readDoc` of a prefab doc: a
 * scene named after the prefab, its bounds synthesised) into `next`'s
 * children, nested instances and `assets`, as `diffToOps` writes them; the
 * view's name and bounds stay. Given `header`, the prefab's base and params
 * as they are now (`readDoc`'s `prefab`), a changed base is a
 * `setPrefabBase` and each changed param an `exposeParam`, for `applyOps`
 * with `{ prefab }`. Its id, variant overrides and contract are left to the
 * caller.
 */
export function diffPrefabToOps(
  view: SceneDefinition,
  next: Prefab,
  registry?: Registry,
  header?: Pick<Prefab, "base" | "params">,
): OpBatch {
  const target: Record<string, unknown> = {};
  for (const k of [...HEADER_FIXED, "name", "bounds", "settings"] as const)
    if (view[k] !== undefined) target[k] = clone(view[k]);
  for (const [key, entries] of Object.entries(next.bulk ?? {}))
    if (entries.length > 0) target[key] = clone(entries);
  if (next.instances && next.instances.length > 0) target.instances = clone(next.instances);
  if (next.assets && next.assets.length > 0) target.assets = [...next.assets];
  target.entities = clone(next.entities);
  const batch = diffToOps(view, target as SceneDefinition, registry);
  if (header) batch.ops.unshift(...headerOps(header, next));
  return batch;
}

function headerOps(
  from: Pick<Prefab, "base" | "params">,
  to: Pick<Prefab, "base" | "params">,
): SceneOp[] {
  const ops: SceneOp[] = [];
  if (from.base !== to.base) ops.push({ op: "setPrefabBase", base: to.base ?? null });
  const a = from.params ?? {};
  const b = to.params ?? {};
  for (const name of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    const param = b[name];
    if (!same(a[name], param))
      ops.push({ op: "exposeParam", name, param: param ? clone(param) : null });
  }
  return ops;
}
