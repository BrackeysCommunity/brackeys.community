import { bulkId } from "./expand";
import {
  BULK_KEYS,
  type Behavior,
  type BulkKey,
  type EntityDef,
  type Pt,
  type SceneChange,
  type SceneDefinition,
  type ShapeTuple,
} from "./types";

type Json = Record<string, unknown>;
type BulkValue = ShapeTuple | Pt;

const key = (v: unknown) => JSON.stringify(v);
const isObj = (v: unknown): v is Json => v !== null && typeof v === "object" && !Array.isArray(v);
const isStructured = (v: unknown) => v !== null && typeof v === "object";

/** What changed from `a` to `b`: scene fields, entities by id, then bulk entries per bucket. */
export function diffScenes(a: SceneDefinition, b: SceneDefinition): SceneChange[] {
  const out: SceneChange[] = [];
  for (const field of ["v", "name", "bounds", "spawn"] as const) {
    if (key(a[field]) !== key(b[field]))
      out.push({ kind: "scene", field, from: a[field], to: b[field] });
  }
  diffEntities(a.entities ?? [], b.entities ?? [], out);
  for (const k of BULK_KEYS) diffBucket(k, bucket(a, k), bucket(b, k), out);
  return out;
}

function bucket(def: SceneDefinition, k: BulkKey): BulkValue[] {
  return ((def as Json)[k] as BulkValue[] | undefined) ?? [];
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
    if (!renamedTo.has(r.id)) out.push({ kind: "removed", ref: r.id, behavior: r.b });
  for (const x of added)
    if (!claimed.has(x.id)) out.push({ kind: "added", ref: x.id, behavior: x.b });
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

/** Matched index pairs of a longest common subsequence of `a` and `b`. */
function lcsPairs(a: string[], b: string[]): [number, number][] {
  let lo = 0;
  while (lo < a.length && lo < b.length && a[lo] === b[lo]) lo++;
  let hiA = a.length;
  let hiB = b.length;
  while (hiA > lo && hiB > lo && a[hiA - 1] === b[hiB - 1]) {
    hiA--;
    hiB--;
  }
  const pairs: [number, number][] = [];
  for (let i = 0; i < lo; i++) pairs.push([i, i]);

  const n = hiA - lo;
  const m = hiB - lo;
  if (n > 0 && m > 0) {
    const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        table[i]![j] =
          a[lo + i] === b[lo + j]
            ? table[i + 1]![j + 1]! + 1
            : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a[lo + i] === b[lo + j]) {
        pairs.push([lo + i, lo + j]);
        i++;
        j++;
      } else if (table[i + 1]![j]! >= table[i]![j + 1]!) i++;
      else j++;
    }
  }

  for (let i = 0; i < a.length - hiA; i++) pairs.push([hiA + i, hiB + i]);
  return pairs;
}

/** The offset from `a` to `b` when they differ only by position. */
function translation(k: BulkKey, a: BulkValue, b: BulkValue): Pt | null {
  if (k === "anchor")
    return [(b[0] as number) - (a[0] as number), (b[1] as number) - (a[1] as number)];
  if (a[0] !== b[0] || a.length !== b.length) return null;
  const dx = (b[1] as number) - (a[1] as number);
  const dy = (b[2] as number) - (a[2] as number);
  if (a[0] === "poly" || a[0] === "chain") {
    for (let i = 1; i + 1 < a.length; i += 2) {
      if (
        (b[i] as number) - (a[i] as number) !== dx ||
        (b[i + 1] as number) - (a[i + 1] as number) !== dy
      )
        return null;
    }
    return [dx, dy];
  }
  for (let i = 3; i < a.length; i++) if (a[i] !== b[i]) return null;
  return [dx, dy];
}

function diffBucket(k: BulkKey, a: BulkValue[], b: BulkValue[], out: SceneChange[]): void {
  if (a.length === 0 && b.length === 0) return;
  const behavior = k.split(":")[0] as Behavior;
  const pairs = lcsPairs(a.map(key), b.map(key));
  const matchedA = new Set(pairs.map(([i]) => i));
  const matchedB = new Set(pairs.map(([, j]) => j));
  const removed = a.map((_, i) => i).filter((i) => !matchedA.has(i));
  const added = b.map((_, j) => j).filter((j) => !matchedB.has(j));

  const paired = new Set<number>();
  const stillRemoved: number[] = [];
  for (const i of removed) {
    let found = false;
    for (const j of added) {
      if (paired.has(j)) continue;
      const by = translation(k, a[i]!, b[j]!);
      if (by) {
        paired.add(j);
        out.push({ kind: "moved", ref: bulkId(k, j), by });
        found = true;
        break;
      }
    }
    if (!found) stillRemoved.push(i);
  }
  for (const i of stillRemoved) out.push({ kind: "removed", ref: bulkId(k, i), behavior });
  for (const j of added)
    if (!paired.has(j)) out.push({ kind: "added", ref: bulkId(k, j), behavior });
}

function show(v: unknown): string {
  return v === undefined ? "(unset)" : JSON.stringify(v);
}

/** One line per change, e.g. `lift.path.speed: 100 -> 140`. */
export function describeChange(c: SceneChange): string {
  switch (c.kind) {
    case "added":
      return `added ${c.ref} (${c.behavior})`;
    case "removed":
      return `removed ${c.ref} (${c.behavior})`;
    case "renamed":
      return `renamed ${c.from} -> ${c.to}`;
    case "modified":
      return `${c.ref}.${c.field}: ${show(c.from)} -> ${show(c.to)}`;
    case "moved":
      return `moved ${c.ref} by [${c.by[0]}, ${c.by[1]}]`;
    case "scene":
      return `scene.${c.field}: ${show(c.from)} -> ${show(c.to)}`;
  }
}
