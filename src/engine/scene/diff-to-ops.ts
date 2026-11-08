import type { Registry } from "../game/types";
import { bulkOffset, lcsPairs, pairBulk } from "./diff";
import { bulkEntries, bulkId, bulkKeysOf } from "./expand";
import { sortedAssets } from "./format";
import { sceneHash } from "./hash";
import { usesBulkRefs } from "./ops-schema";
import type {
  BulkEntry,
  BulkKey,
  EntityDef,
  EntityInput,
  GroupDef,
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

/** The `setGroup` fields that make a group `to` from `from`; rot and flip only when either turns. */
export function setGroupFields(
  to: GroupDef,
  from: GroupDef | undefined,
): Omit<Extract<SceneOp, { op: "setGroup" }>, "op" | "id"> {
  const turns = to.rot !== undefined || to.flip || from?.rot !== undefined || from?.flip;
  return {
    at: clone(to.at),
    ...(turns ? { rot: to.rot ?? 0, flip: to.flip === true } : {}),
    name: to.name ?? null,
  };
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
 * added at its index.
 */
function alignNamed<T extends { id: string }>(
  as: readonly T[],
  bs: readonly T[],
  matches: (a: T, b: T) => boolean,
  add: (item: T, index: { index?: number }) => SceneOp,
  change: (a: T, b: T) => SceneOp[] = (a, b) => {
    const update = namedUpdate(a as unknown as EntityDef, b as unknown as EntityDef);
    return update ? [update] : [];
  },
) {
  const inA = new Map<string, T>();
  for (const x of as) if (!inA.has(x.id)) inA.set(x.id, x);
  const kept = new Set<string>();
  for (const y of bs) {
    const x = inA.get(y.id);
    if (x && !kept.has(y.id) && matches(x, y)) kept.add(y.id);
  }
  const removeRefs = as.filter((x) => !kept.has(x.id) || inA.get(x.id) !== x).map((x) => x.id);
  const updates: SceneOp[] = [];
  for (const y of bs) {
    if (!kept.has(y.id)) continue;
    updates.push(...change(inA.get(y.id)!, y));
  }
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
  const adds: SceneOp[] = [];
  let length = list.length;
  bs.forEach((y, j) => {
    if (kept.has(y.id)) return;
    adds.push(add(y, j === length ? {} : { index: j }));
    length++;
  });
  return { removeRefs, updates, reorders, adds };
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
 * through `setSettings`, the `assets` header through `useAssets`, groups
 * through `setGroup` (its turn and flip included). Instances match by id
 * like named entities, their `rot`, `flip` and `overrides` through
 * `update`, each changed param through `setParam`; a change of only `z` is a `setZ`, and one placing
 * another prefab is removed and instantiated again. A grid field that
 * changed is one `update` of the whole field.
 *
 * `registry` tells point-form bulk keys from shape-form ones; without it the
 * values decide. Throws when `$schema`, `v` or `game` differ, or when `b` has
 * no `name`, since no op changes those.
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

  // ─── Groups ────────────────────────────────────────────
  const ga = a.groups ?? {};
  const gb = b.groups ?? {};
  const groupRemovals: SceneOp[] = [];
  for (const id of Object.keys(gb).sort()) {
    const g = gb[id]!;
    if (same(ga[id], g)) continue;
    ops.push({ op: "setGroup", id, ...setGroupFields(g, ga[id]) });
  }
  for (const id of Object.keys(ga).sort())
    if (!(id in gb)) groupRemovals.push({ op: "setGroup", id, remove: true });

  // ─── Named entities and instances ─────────────────────
  const removeRefs: Ref[] = [];
  const updates: SceneOp[] = [];
  const reorders: SceneOp[] = [];
  const named = alignNamed(
    a.entities ?? [],
    b.entities ?? [],
    (x, y) => x.type === y.type,
    (e, index) => ({ op: "add", entity: clone(e) as EntityInput, ...index }),
  );
  const instances = alignNamed(
    a.instances ?? [],
    b.instances ?? [],
    (x, y) => x.prefab === y.prefab,
    (x, index) => ({ op: "instantiate", instance: clone(x) as InstanceInput, ...index }),
    instanceChange,
  );
  for (const n of [named, instances]) {
    removeRefs.push(...n.removeRefs);
    updates.push(...n.updates);
    reorders.push(...n.reorders);
  }
  const adds = named.adds;
  const instAdds = instances.adds;

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
      if (by && Number.isInteger(by[0]) && Number.isInteger(by[1])) {
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

  if (removeRefs.length > 0) ops.push({ op: "remove", refs: removeRefs });
  for (const { by, refs } of moves.values()) ops.push({ op: "move", refs, by });
  ops.push(...updates, ...bulkUpdates, ...reorders, ...adds, ...bulkAdds, ...instAdds);
  ops.push(...groupRemovals);

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
  for (const k of [...HEADER_FIXED, "name", "bounds", "settings", "groups"] as const)
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
