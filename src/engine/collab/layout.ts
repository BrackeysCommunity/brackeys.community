import * as Y from "yjs";

import { cloneJson, fieldLayout, sameValue, stableJson } from "../project/canonical";
import type { DocLayout } from "../project/kinds";
import { isPlainObject } from "../project/kinds/define";
import { randomKey, type KeyGen } from "./keys";
import { assignZ, compareZ, initialZ } from "./order";
import { LEGACY_Z_FIELD } from "./types";

/**
 * Declarative kinds' docs: a value laid out by its kind's `DocLayout` under
 * `doc.getMap("content")`.
 *
 * ```
 * atomic   the value itself                        last writer wins
 * text     Y.Text                                  merges by character
 * map      Y.Map, one entry per key                keys merge independently
 * list     Y.Array of items                        inserts merge; an edited item is replaced whole
 * keyed    Y.Map key → Y.Map { @z, item }          items and their fields merge; order is (@z, key)
 * ```
 *
 * A value that doesn't fit its slot's layout (a number where `text` is
 * declared) is held as an atomic value, so every value round-trips and the
 * schema reports it.
 */
export const CONTENT_MAP = "content";
/** A keyed entry's fractional order key; layout 2 named it `z`. */
export const KEYED_Z = "@z";
/** A keyed entry's item, laid out by the collection's `item` layout. */
export const KEYED_ITEM = "item";

type MapLayout = Extract<DocLayout, { as: "map" }>;
type KeyedLayout = Extract<DocLayout, { as: "keyed" }>;

export const contentMap = (doc: Y.Doc) => doc.getMap<unknown>(CONTENT_MAP);

export type LayoutWriteOptions = {
  /** Keys for new `keyed` items; default `randomKey`. */
  key?: KeyGen;
};

/** Above this many item comparisons a list's changed middle is replaced instead of diffed. */
const LIST_DIFF_LIMIT = 4_000_000;

function setOwn(obj: Record<string, unknown>, key: string, value: unknown): void {
  if (key === "__proto__")
    Object.defineProperty(obj, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  else obj[key] = value;
}

export { fieldLayout };

/** Whether `value` is held as one atomic value in a slot laid out by `layout`. */
function heldAtomically(layout: DocLayout, value: unknown): boolean {
  switch (layout.as) {
    case "atomic":
      return true;
    case "text":
      return typeof value !== "string";
    case "map":
      return !isPlainObject(value);
    case "list":
    case "keyed":
      return !Array.isArray(value);
  }
}

// ─── Encode ──────────────────────────────────────────────

function encode(layout: DocLayout, value: unknown, key: KeyGen): unknown {
  if (heldAtomically(layout, value)) return cloneJson(value);
  switch (layout.as) {
    case "text":
      return new Y.Text(value as string);
    case "map": {
      const map = new Y.Map<unknown>();
      fillMap(map, layout, value as Record<string, unknown>, key);
      return map;
    }
    case "list": {
      const arr = new Y.Array<unknown>();
      arr.push((value as unknown[]).map((v) => encode(layout.item, v ?? null, key)));
      return arr;
    }
    case "keyed": {
      const map = new Y.Map<unknown>();
      const items = value as unknown[];
      const zs = initialZ(items.length);
      const taken = new Set<string>();
      items.forEach((v, i) => {
        // The new map isn't in a doc yet, so only the keys taken here can clash.
        const k = freshKey(null, key, taken);
        taken.add(k);
        map.set(k, entryMap(layout, v ?? null, zs[i]!, key));
      });
      return map;
    }
    default:
      return cloneJson(value);
  }
}

function fillMap(
  map: Y.Map<unknown>,
  layout: MapLayout,
  value: Record<string, unknown>,
  key: KeyGen,
): void {
  for (const [k, v] of Object.entries(value))
    if (v !== undefined) map.set(k, encode(fieldLayout(layout, k), v, key));
}

function entryMap(layout: KeyedLayout, item: unknown, z: string, key: KeyGen): Y.Map<unknown> {
  const entry = new Y.Map<unknown>();
  entry.set(KEYED_Z, z);
  entry.set(KEYED_ITEM, encode(layout.item, item, key));
  return entry;
}

function freshKey(map: Y.Map<unknown> | null, key: KeyGen, taken?: ReadonlySet<string>): string {
  let k = key();
  while (map?.has(k) || taken?.has(k)) k = key();
  return k;
}

// ─── Decode ──────────────────────────────────────────────

type KeyedEntry = { key: string; z: string; entry: Y.Map<unknown> };

/** A keyed collection's live entries in doc order, `(z, key)`. */
function keyedEntries(map: Y.Map<unknown>): KeyedEntry[] {
  const out: KeyedEntry[] = [];
  for (const [key, entry] of map.entries()) {
    if (!(entry instanceof Y.Map) || !entry.has(KEYED_ITEM)) continue;
    const z = entry.get(KEYED_Z);
    out.push({ key, z: typeof z === "string" ? z : "", entry: entry as Y.Map<unknown> });
  }
  return out.sort(compareZ);
}

function decode(layout: DocLayout, held: unknown): unknown {
  if (held instanceof Y.Text) return held.toJSON();
  if (held instanceof Y.Map) {
    if (layout.as === "map") return decodeMap(layout, held as Y.Map<unknown>);
    if (layout.as === "keyed")
      return keyedEntries(held as Y.Map<unknown>).map(({ entry }) =>
        decode(layout.item, entry.get(KEYED_ITEM)),
      );
    return held.toJSON();
  }
  if (held instanceof Y.Array)
    return layout.as === "list" ? held.toArray().map((v) => decode(layout.item, v)) : held.toJSON();
  return cloneJson(held);
}

/** A map's keys in a fixed order whatever order updates arrived in: declared fields first, then the rest sorted. */
function decodeMap(layout: MapLayout, map: Y.Map<unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const declared = Object.keys(layout.fields ?? {});
  for (const k of declared)
    if (map.has(k)) setOwn(out, k, decode(fieldLayout(layout, k), map.get(k)));
  const others = [...map.keys()].filter((k) => !declared.includes(k)).sort();
  for (const k of others) setOwn(out, k, decode(fieldLayout(layout, k), map.get(k)));
  return out;
}

function idOf(held: unknown, idField: string): string | undefined {
  const id =
    held instanceof Y.Map ? held.get(idField) : isPlainObject(held) ? held[idField] : undefined;
  if (typeof id === "string") return id;
  return id instanceof Y.Text ? id.toJSON() : undefined;
}

// ─── Patch ───────────────────────────────────────────────

type PatchCtx = { key: KeyGen; wrote: boolean };

/** Writes `next` into slot `k` of `map`, touching only what differs. */
function patchSlot(
  ctx: PatchCtx,
  map: Y.Map<unknown>,
  k: string,
  layout: DocLayout,
  next: unknown,
): void {
  const current = map.get(k);
  if (next === undefined) {
    if (map.has(k)) {
      map.delete(k);
      ctx.wrote = true;
    }
    return;
  }
  if (!heldAtomically(layout, next)) {
    if (layout.as === "text" && current instanceof Y.Text)
      return patchText(ctx, current, next as string);
    if (layout.as === "map" && current instanceof Y.Map)
      return patchMap(ctx, current as Y.Map<unknown>, layout, next as Record<string, unknown>);
    if (layout.as === "list" && current instanceof Y.Array)
      return patchList(ctx, current as Y.Array<unknown>, layout.item, next as unknown[]);
    if (layout.as === "keyed" && current instanceof Y.Map)
      return patchKeyed(ctx, current as Y.Map<unknown>, layout, next as unknown[]);
  } else if (map.has(k) && !(current instanceof Y.AbstractType) && sameValue(current, next)) return;
  map.set(k, encode(layout, next, ctx.key));
  ctx.wrote = true;
}

function patchMap(
  ctx: PatchCtx,
  map: Y.Map<unknown>,
  layout: MapLayout,
  next: Record<string, unknown>,
): void {
  for (const k of [...map.keys()])
    if (!Object.hasOwn(next, k) || next[k] === undefined) {
      map.delete(k);
      ctx.wrote = true;
    }
  for (const [k, v] of Object.entries(next))
    if (v !== undefined) patchSlot(ctx, map, k, fieldLayout(layout, k), v);
}

const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;

/** Replaces only the span between the common prefix and suffix, never splitting a surrogate pair. */
function patchText(ctx: PatchCtx, text: Y.Text, next: string): void {
  const prev = text.toJSON();
  if (prev === next) return;
  const max = Math.min(prev.length, next.length);
  let p = 0;
  while (p < max && prev.charCodeAt(p) === next.charCodeAt(p)) p++;
  if (p > 0 && isHigh(prev.charCodeAt(p - 1))) p--;
  let s = 0;
  while (
    s < max - p &&
    prev.charCodeAt(prev.length - 1 - s) === next.charCodeAt(next.length - 1 - s)
  )
    s++;
  if (s > 0 && isLow(prev.charCodeAt(prev.length - s))) s--;
  const removed = prev.length - p - s;
  if (removed > 0) text.delete(p, removed);
  const inserted = next.slice(p, next.length - s);
  if (inserted.length > 0) text.insert(p, inserted);
  ctx.wrote = true;
}

type Step = "keep" | "delete" | "insert";

/** An edit script from `a` to `b` by longest common subsequence; one pass of deletes and inserts when too large to diff. */
function editScript(a: readonly string[], b: readonly string[]): Step[] {
  const n = a.length;
  const m = b.length;
  if (n * m > LIST_DIFF_LIMIT)
    return [...Array<Step>(n).fill("delete"), ...Array<Step>(m).fill("insert")];
  const width = m + 1;
  const lcs = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i * width + j] =
        a[i] === b[j]
          ? lcs[(i + 1) * width + j + 1]! + 1
          : Math.max(lcs[(i + 1) * width + j]!, lcs[i * width + j + 1]!);
  const out: Step[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      out.push("keep");
      i++;
      j++;
    } else if (j >= m || (i < n && lcs[(i + 1) * width + j]! >= lcs[i * width + j + 1]!)) {
      out.push("delete");
      i++;
    } else {
      out.push("insert");
      j++;
    }
  }
  return out;
}

function patchList(ctx: PatchCtx, arr: Y.Array<unknown>, item: DocLayout, next: unknown[]): void {
  const items = next.map((v) => v ?? null);
  const prev = arr.toArray().map((v) => stableJson(decode(item, v)));
  const want = items.map((v) => stableJson(v));
  let head = 0;
  while (head < prev.length && head < want.length && prev[head] === want[head]) head++;
  let tail = 0;
  while (
    tail < prev.length - head &&
    tail < want.length - head &&
    prev[prev.length - 1 - tail] === want[want.length - 1 - tail]
  )
    tail++;
  const steps = editScript(
    prev.slice(head, prev.length - tail),
    want.slice(head, want.length - tail),
  );
  let at = head;
  let j = head;
  let k = 0;
  while (k < steps.length) {
    const step = steps[k]!;
    let run = 0;
    while (k + run < steps.length && steps[k + run] === step) run++;
    if (step === "keep") {
      at += run;
      j += run;
    } else if (step === "delete") {
      arr.delete(at, run);
      ctx.wrote = true;
    } else {
      arr.insert(
        at,
        items.slice(j, j + run).map((v) => encode(item, v, ctx.key)),
      );
      at += run;
      j += run;
      ctx.wrote = true;
    }
    k += run;
  }
}

/**
 * Matches each next item to an entry: by id in doc order (so two items with
 * one id keep their two keys), id-less items to id-less entries by position,
 * the rest to new keys. Existing `z` values are kept wherever the order allows.
 */
function patchKeyed(
  ctx: PatchCtx,
  map: Y.Map<unknown>,
  layout: KeyedLayout,
  next: unknown[],
): void {
  const idField = layout.id ?? "id";
  const prev = keyedEntries(map);
  const byId = new Map<string, KeyedEntry[]>();
  const idless: KeyedEntry[] = [];
  for (const e of prev) {
    const id = idOf(e.entry.get(KEYED_ITEM), idField);
    if (id === undefined) idless.push(e);
    else {
      const list = byId.get(id);
      if (list) list.push(e);
      else byId.set(id, [e]);
    }
  }
  const items = next.map((v) => v ?? null);
  const taken = new Set<string>();
  const planned = items.map((item) => {
    const id = isPlainObject(item) && typeof item[idField] === "string" ? item[idField] : undefined;
    const match = id === undefined ? idless.shift() : byId.get(id)?.shift();
    const key = match?.key ?? freshKey(map, ctx.key, taken);
    taken.add(key);
    return { key, match };
  });

  const current = planned.map((p) => p.match?.z);
  const inOrder = planned.every(
    (p, i) =>
      p.match !== undefined &&
      (i === 0 || compareZ({ z: current[i - 1]!, key: planned[i - 1]!.key }, p.match) < 0),
  );
  const zs = inOrder ? (current as string[]) : assignZ(current);

  for (const e of prev)
    if (!taken.has(e.key)) {
      map.delete(e.key);
      ctx.wrote = true;
    }
  planned.forEach(({ key, match }, i) => {
    const z = zs[i]!;
    if (!match) {
      map.set(key, entryMap(layout, items[i], z, ctx.key));
      ctx.wrote = true;
      return;
    }
    if (match.entry.get(KEYED_Z) !== z) {
      match.entry.set(KEYED_Z, z);
      ctx.wrote = true;
    }
    patchSlot(ctx, match.entry, KEYED_ITEM, layout.item, items[i]);
  });
}

// ─── Layout 2 → 3 ────────────────────────────────────────

function liftKeyedOrder(held: unknown, layout: DocLayout): boolean {
  let wrote = false;
  if (layout.as === "map" && held instanceof Y.Map) {
    for (const [k, v] of held.entries()) wrote = liftKeyedOrder(v, fieldLayout(layout, k)) || wrote;
  } else if (layout.as === "list" && held instanceof Y.Array) {
    for (const v of held.toArray()) wrote = liftKeyedOrder(v, layout.item) || wrote;
  } else if (layout.as === "keyed" && held instanceof Y.Map) {
    for (const entry of held.values()) {
      if (!(entry instanceof Y.Map)) continue;
      if (entry.has(LEGACY_Z_FIELD)) {
        const z = entry.get(LEGACY_Z_FIELD);
        entry.delete(LEGACY_Z_FIELD);
        if (!entry.has(KEYED_Z)) entry.set(KEYED_Z, typeof z === "string" ? z : "");
        wrote = true;
      }
      wrote = liftKeyedOrder(entry.get(KEYED_ITEM), layout.item) || wrote;
    }
  }
  return wrote;
}

/**
 * Renames every keyed entry's layout-2 order key `z` to `KEYED_Z`, at any
 * depth, keeping its value, so each item keeps its key and its place. Call
 * inside the migration's transaction. Returns whether anything was written.
 */
export function liftKeyedLayout(doc: Y.Doc, layout: DocLayout): boolean {
  return liftKeyedOrder(contentMap(doc), rootLayout(layout));
}

// ─── Entry points ────────────────────────────────────────

function rootLayout(layout: DocLayout): MapLayout {
  if (layout.as !== "map")
    throw new Error(`a doc layout's root must be a "map", not "${layout.as}"`);
  return layout;
}

function rootValue(value: unknown): Record<string, unknown> {
  if (!isPlainObject(value)) throw new Error("a declarative doc's value must be an object");
  return value;
}

/**
 * Seeds a doc's `content` map with `value`, in one transaction. Only a
 * server seeds: two clients seeding one document would duplicate every
 * keyed item. Throws when `content` isn't empty.
 */
export function layoutToDoc(
  doc: Y.Doc,
  layout: DocLayout,
  value: unknown,
  origin?: unknown,
  opts: LayoutWriteOptions = {},
): Y.Doc {
  const root = rootLayout(layout);
  const top = rootValue(value);
  const content = contentMap(doc);
  if (content.size > 0) throw new Error("layoutToDoc: the doc's content isn't empty");
  doc.transact(() => fillMap(content, root, top, opts.key ?? randomKey), origin);
  return doc;
}

/**
 * The value a doc's `content` holds. Deterministic: docs holding the same
 * state give equal values with keys in the same order, so converged clients
 * format the same text.
 */
export function layoutFromDoc(doc: Y.Doc, layout: DocLayout): Record<string, unknown> {
  return decodeMap(rootLayout(layout), contentMap(doc));
}

/**
 * Writes `next` into a doc in exactly one transaction, touching only what
 * differs, so concurrent edits elsewhere survive: map keys one by one, text
 * by its changed span, list items by a diff, and keyed items by matching
 * ids, keeping their keys. Returns whether anything was written.
 */
export function layoutPatch(
  doc: Y.Doc,
  layout: DocLayout,
  next: unknown,
  origin?: unknown,
  opts: LayoutWriteOptions = {},
): boolean {
  const root = rootLayout(layout);
  const top = rootValue(next);
  const ctx: PatchCtx = { key: opts.key ?? randomKey, wrote: false };
  doc.transact(() => patchMap(ctx, contentMap(doc), root, top), origin);
  return ctx.wrote;
}
