import { isPlainObject } from "../project/kinds/define";
import { bulkEntries, bulkId, bulkKeysOf, bulkKeyType } from "./expand";
import { sortedAssets } from "./format";
import {
  type BulkEntry,
  type BulkKey,
  type EntityDef,
  type Pt,
  type SceneChange,
  type SceneDefinition,
  type ShapeTuple,
} from "./types";
import { roundLength } from "./units";

type Json = Record<string, unknown>;

const key = (v: unknown) => JSON.stringify(v);
export const isObj = isPlainObject;
/** An object or an array. */
export const isStructured = (v: unknown) => v !== null && typeof v === "object";

/**
 * What changed from `a` to `b`: scene fields, settings by key, the `assets`
 * header as a set, groups by key, entities and then instances by id, then bulk entries per bulk key. Types come from the entities and the
 * bulk keys, so no registry is needed.
 */
export function diffScenes(a: SceneDefinition, b: SceneDefinition): SceneChange[] {
  const out: SceneChange[] = [];
  for (const field of ["v", "game", "name", "bounds"] as const) {
    if (key(a[field]) !== key(b[field]))
      out.push({ kind: "scene", field, from: a[field], to: b[field] });
  }
  const sa = a.settings ?? {};
  const sb = b.settings ?? {};
  for (const k of [...Object.keys(sa), ...Object.keys(sb).filter((k) => !(k in sa))]) {
    if (key(sa[k]) !== key(sb[k]))
      out.push({ kind: "scene", field: `settings.${k}`, from: sa[k], to: sb[k] });
  }
  const assetsA = sortedAssets(a.assets ?? []);
  const assetsB = sortedAssets(b.assets ?? []);
  if (key(assetsA) !== key(assetsB))
    out.push({ kind: "scene", field: "assets", from: a.assets, to: b.assets });
  const ga = a.groups ?? {};
  const gb = b.groups ?? {};
  for (const k of [...new Set([...Object.keys(ga), ...Object.keys(gb)])].sort()) {
    if (key(ga[k]) !== key(gb[k]))
      out.push({ kind: "scene", field: `groups.${k}`, from: ga[k], to: gb[k] });
  }
  diffEntities(a.entities ?? [], b.entities ?? [], out);
  diffEntities(instancesAsEntities(a), instancesAsEntities(b), out);
  const keys = [...new Set([...bulkKeysOf(a), ...bulkKeysOf(b)])].sort();
  for (const k of keys) diffBucket(k, bulkEntries(a, k), bulkEntries(b, k), out);
  return out;
}

/** Instances diff like entities; their type reads `prefab:<id>`. */
function instancesAsEntities(def: SceneDefinition): EntityDef[] {
  return (def.instances ?? []).map((i) => ({ ...i, type: `prefab:${i.prefab}` }) as EntityDef);
}

function withoutId(e: EntityDef): string {
  const { id: _id, ...rest } = e;
  return key(rest);
}

function diffEntities(as: EntityDef[], bs: EntityDef[], out: SceneChange[]): void {
  const aById = new Map(as.map((e) => [e.id, e]));
  const bById = new Map(bs.map((e) => [e.id, e]));
  const removed = as.filter((e) => !bById.has(e.id));
  const added = bs.filter((e) => !aById.has(e.id));

  const renamedTo = new Map<string, string>();
  const claimed = new Set<string>();
  for (const r of removed) {
    const content = withoutId(r);
    const match = added.find((x) => !claimed.has(x.id) && withoutId(x) === content);
    if (match) {
      claimed.add(match.id);
      renamedTo.set(r.id, match.id);
    }
  }

  for (const r of removed)
    if (!renamedTo.has(r.id)) out.push({ kind: "removed", ref: r.id, type: r.type });
  for (const x of added)
    if (!claimed.has(x.id)) out.push({ kind: "added", ref: x.id, type: x.type });
  for (const [from, to] of renamedTo) out.push({ kind: "renamed", from, to });

  for (const e of bs) {
    const before = aById.get(e.id);
    if (before) fieldChanges(e.id, before as unknown as Json, e as unknown as Json, "", out);
  }
}

function fieldChanges(
  ref: string,
  a: unknown,
  b: unknown,
  prefix: string,
  out: SceneChange[],
): void {
  if (key(a) === key(b)) return;
  const join = (k: string | number) => (prefix ? `${prefix}.${k}` : String(k));
  if (isObj(a) && isObj(b)) {
    const keys = [...Object.keys(a), ...Object.keys(b).filter((k) => !(k in a))];
    for (const k of keys) if (prefix || k !== "id") fieldChanges(ref, a[k], b[k], join(k), out);
    return;
  }
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.some(isStructured)) {
    a.forEach((item, i) => fieldChanges(ref, item, b[i], join(i), out));
    return;
  }
  out.push({ kind: "modified", ref, field: prefix, from: a, to: b });
}

/**
 * Matched index pairs of a longest common subsequence of two lists of
 * lengths `n` and `m`, where `eq(i, j)` says whether `a[i]` matches `b[j]`.
 */
export function lcsPairs(
  n: number,
  m: number,
  eq: (i: number, j: number) => boolean,
): [number, number][] {
  let lo = 0;
  while (lo < n && lo < m && eq(lo, lo)) lo++;
  let hiA = n;
  let hiB = m;
  while (hiA > lo && hiB > lo && eq(hiA - 1, hiB - 1)) {
    hiA--;
    hiB--;
  }
  const pairs: [number, number][] = [];
  for (let i = 0; i < lo; i++) pairs.push([i, i]);

  const rows = hiA - lo;
  const cols = hiB - lo;
  if (rows > 0 && cols > 0) {
    const same = Array.from({ length: rows }, (_, i) =>
      Uint8Array.from({ length: cols }, (_, j) => (eq(lo + i, lo + j) ? 1 : 0)),
    );
    const table = Array.from({ length: rows + 1 }, () => new Uint32Array(cols + 1));
    for (let i = rows - 1; i >= 0; i--) {
      for (let j = cols - 1; j >= 0; j--) {
        table[i]![j] = same[i]![j]
          ? table[i + 1]![j + 1]! + 1
          : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
      }
    }
    let i = 0;
    let j = 0;
    while (i < rows && j < cols) {
      if (same[i]![j]) {
        pairs.push([lo + i, lo + j]);
        i++;
        j++;
      } else if (table[i + 1]![j]! >= table[i]![j + 1]!) i++;
      else j++;
    }
  }

  for (let i = 0; i < n - hiA; i++) pairs.push([hiA + i, hiB + i]);
  return pairs;
}

const isPoint = (v: BulkEntry): v is Pt => typeof v[0] === "number";

/** `b - a` at the file's length precision. */
const delta = (a: number, b: number) => roundLength(b - a);

/** The offset from `a` to `b` when the two bulk entries differ only by position. */
export function bulkOffset(a: BulkEntry, b: BulkEntry): Pt | null {
  if (isPoint(a) || isPoint(b)) {
    return isPoint(a) && isPoint(b) ? [delta(a[0], b[0]), delta(a[1], b[1])] : null;
  }
  if (a[0] !== b[0] || a.length !== b.length) return null;
  const dx = delta(a[1] as number, b[1] as number);
  const dy = delta(a[2] as number, b[2] as number);
  if (a[0] === "poly" || a[0] === "chain") {
    for (let i = 1; i + 1 < a.length; i += 2) {
      if (
        delta(a[i] as number, b[i] as number) !== dx ||
        delta(a[i + 1] as number, b[i + 1] as number) !== dy
      )
        return null;
    }
    return [dx, dy];
  }
  for (let i = 3; i < a.length; i++) if (a[i] !== b[i]) return null;
  return [dx, dy];
}

/** The rotation of a box or capsule tuple; 0 when it has none. */
const rotOf = (t: ShapeTuple) => (t[0] === "box" || t[0] === "capsule" ? (t[5] ?? 0) : 0);

/** Whether `b` is `a` with the same tag, centre and rotation and a new size (boxes, circles, capsules). */
export function isBulkResize(a: BulkEntry, b: BulkEntry): boolean {
  if (isPoint(a) || isPoint(b) || a[0] !== b[0]) return false;
  if (a[0] === "poly" || a[0] === "chain") return false;
  if (a[1] !== b[1] || a[2] !== b[2] || rotOf(a) !== rotOf(b)) return false;
  return key(a) !== key(b);
}

/** How a leftover entry of `a` pairs with one of `b`: moved, resized, or not at all. */
export function pairBulk(
  a: BulkEntry,
  b: BulkEntry,
): { kind: "moved"; by: Pt } | { kind: "resized" } | null {
  const by = bulkOffset(a, b);
  if (by) return { kind: "moved", by };
  return isBulkResize(a, b) ? { kind: "resized" } : null;
}

function diffBucket(k: BulkKey, a: BulkEntry[], b: BulkEntry[], out: SceneChange[]): void {
  if (a.length === 0 && b.length === 0) return;
  const type = bulkKeyType(k);
  const ka = a.map(key);
  const kb = b.map(key);
  const pairs = lcsPairs(a.length, b.length, (i, j) => ka[i] === kb[j]);
  const matchedA = new Set(pairs.map(([i]) => i));
  const matchedB = new Set(pairs.map(([, j]) => j));
  const removed = a.map((_, i) => i).filter((i) => !matchedA.has(i));
  const added = b.map((_, j) => j).filter((j) => !matchedB.has(j));

  const paired = new Set<number>();
  const stillRemoved: number[] = [];
  for (const i of removed) {
    const free = added.filter((j) => !paired.has(j));
    const moved = free.find((j) => bulkOffset(a[i]!, b[j]!));
    const j = moved ?? free.find((j) => isBulkResize(a[i]!, b[j]!));
    if (j === undefined) {
      stillRemoved.push(i);
      continue;
    }
    paired.add(j);
    const ref = bulkId(k, j);
    out.push(
      moved === undefined
        ? { kind: "resized", ref, from: a[i]!, to: b[j]! }
        : { kind: "moved", ref, by: bulkOffset(a[i]!, b[j]!)! },
    );
  }
  for (const i of stillRemoved) out.push({ kind: "removed", ref: bulkId(k, i), type });
  for (const j of added) if (!paired.has(j)) out.push({ kind: "added", ref: bulkId(k, j), type });
}

function show(v: unknown): string {
  return v === undefined ? "(unset)" : JSON.stringify(v);
}

/** A bulk entry as `[box 100 0 10 10]`. */
const tuple = (v: BulkEntry) => `[${v.join(" ")}]`;

/** One line per change, e.g. `lift.path.speed: 100 -> 140`. */
export function describeChange(c: SceneChange): string {
  switch (c.kind) {
    case "added":
      return `added ${c.ref} (${c.type})`;
    case "removed":
      return `removed ${c.ref} (${c.type})`;
    case "renamed":
      return `renamed ${c.from} -> ${c.to}`;
    case "modified":
      return `${c.ref}.${c.field}: ${show(c.from)} -> ${show(c.to)}`;
    case "moved":
      return `moved ${c.ref} by [${c.by[0]}, ${c.by[1]}]`;
    case "resized":
      return `resized ${c.ref} ${tuple(c.from)} -> ${tuple(c.to)}`;
    case "scene":
      return `scene.${c.field}: ${show(c.from)} -> ${show(c.to)}`;
  }
}
