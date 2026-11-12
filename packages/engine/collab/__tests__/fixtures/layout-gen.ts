import type { DocLayout } from "../../../project/kinds";

/** Random declarative layouts, values for them, and local edits of those values. */

export type Rand = () => number;
export type MapLayout = Extract<DocLayout, { as: "map" }>;
type KeyedLayout = Extract<DocLayout, { as: "keyed" }>;
type Obj = Record<string, unknown>;

export const pick = <T>(rand: Rand, xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
export const int = (rand: Rand, n: number) => Math.floor(rand() * n);
export const isObject = (v: unknown): v is Obj =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** Includes `Object.prototype` names, so a codec that reads keys off a plain object trips. */
const FIELD_NAMES = ["a", "b", "id", "name", "z", "item", "constructor"];
const REST_NAMES = ["p", "q", "r", "toString"];
/** A small pool, so concurrent creates of one id happen. */
const IDS = ["x", "y", "w"];

export function genMap(rand: Rand, depth: number): MapLayout {
  const fields: Record<string, DocLayout> = {};
  for (let i = int(rand, 4); i > 0; i--)
    fields[pick(rand, FIELD_NAMES)] = genLayout(rand, depth - 1);
  const layout: MapLayout = { as: "map" };
  if (Object.keys(fields).length > 0) layout.fields = fields;
  if (rand() < 0.6) layout.rest = genLayout(rand, depth - 1);
  return layout;
}

function genLayout(rand: Rand, depth: number): DocLayout {
  const r = rand();
  if (depth <= 0 || r < 0.25) return { as: "atomic" };
  if (r < 0.4) return { as: "text" };
  if (r < 0.6) return genMap(rand, depth);
  if (r < 0.75) return { as: "list", item: genLayout(rand, depth - 1) };
  return { as: "keyed", ...(rand() < 0.3 ? { id: "name" } : {}), item: genMap(rand, depth) };
}

function genText(rand: Rand): string {
  let s = "";
  for (let i = int(rand, 6); i > 0; i--) s += pick(rand, ["a", "b", " ", "é", "🎮", "\n"]);
  return s;
}

function genAtomic(rand: Rand, depth = 1): unknown {
  const r = rand();
  if (r < 0.2) return int(rand, 100) - 50;
  if (r < 0.4) return genText(rand);
  if (r < 0.5) return rand() < 0.5;
  if (r < 0.6) return null;
  if (r < 0.8 && depth > 0) return [genAtomic(rand, depth - 1), genAtomic(rand, depth - 1)];
  if (depth > 0) return { k: genAtomic(rand, depth - 1) };
  return 1.5;
}

/** A value for `layout`; now and then one of the wrong shape, as a hand-edited file can hold. */
export function genValue(rand: Rand, layout: DocLayout): unknown {
  if (layout.as !== "atomic" && rand() < 0.05) return genAtomic(rand);
  switch (layout.as) {
    case "atomic":
      return genAtomic(rand);
    case "text":
      return genText(rand);
    case "map": {
      const out: Obj = {};
      for (const k of Object.keys(layout.fields ?? {}))
        if (rand() < 0.8) out[k] = genValue(rand, layout.fields![k]!);
      if (layout.rest)
        for (let i = int(rand, 3); i > 0; i--)
          out[pick(rand, REST_NAMES)] = genValue(rand, layout.rest);
      return out;
    }
    case "list":
      return Array.from({ length: int(rand, 4) }, () => genValue(rand, layout.item));
    case "keyed":
      return Array.from({ length: int(rand, 4) }, () => genItem(rand, layout));
  }
}

function genItem(rand: Rand, layout: KeyedLayout): unknown {
  const item = genValue(rand, layout.item);
  if (isObject(item) && rand() < 0.85) item[layout.id ?? "id"] = pick(rand, IDS);
  return item;
}

/** `genValue` at the root, which is always an object. */
export function genRoot(rand: Rand, layout: MapLayout): Obj {
  for (;;) {
    const value = genValue(rand, layout);
    if (isObject(value)) return value;
  }
}

/** A copy of `value` with one random local change somewhere inside it. */
function mutate(rand: Rand, layout: DocLayout, value: unknown): unknown {
  if (rand() < 0.08) return genValue(rand, layout);
  switch (layout.as) {
    case "atomic":
      return genAtomic(rand);
    case "text": {
      if (typeof value !== "string") return genText(rand);
      const chars = Array.from(value);
      const at = int(rand, chars.length + 1);
      if (rand() < 0.5) chars.splice(at, 0, genText(rand));
      else chars.splice(at, 1 + int(rand, 2));
      return chars.join("");
    }
    case "map": {
      if (!isObject(value)) return genValue(rand, layout);
      const out = { ...value };
      const names = [...Object.keys(layout.fields ?? {}), ...(layout.rest ? REST_NAMES : [])];
      if (names.length === 0) return out;
      const k = pick(rand, names);
      const child =
        (layout.fields && Object.hasOwn(layout.fields, k) ? layout.fields[k] : undefined) ??
        layout.rest ??
        ({ as: "atomic" } as const);
      if (rand() < 0.15) delete out[k];
      else out[k] = Object.hasOwn(out, k) ? mutate(rand, child, out[k]) : genValue(rand, child);
      return out;
    }
    case "list":
    case "keyed": {
      if (!Array.isArray(value)) return genValue(rand, layout);
      const out = [...value];
      const fresh = () =>
        layout.as === "keyed" ? genItem(rand, layout) : genValue(rand, layout.item);
      const r = rand();
      if (r < 0.3 || out.length === 0) out.splice(int(rand, out.length + 1), 0, fresh());
      else if (r < 0.5) out.splice(int(rand, out.length), 1);
      else if (r < 0.65) {
        const [moved] = out.splice(int(rand, out.length), 1);
        out.splice(int(rand, out.length + 1), 0, moved);
      } else {
        const i = int(rand, out.length);
        out[i] = mutate(rand, layout.item, out[i]);
      }
      return out;
    }
  }
}

/** `mutate` at the root, which stays an object. */
export function mutateRoot(rand: Rand, layout: MapLayout, value: unknown): Obj {
  for (;;) {
    const next = mutate(rand, layout, value);
    if (isObject(next)) return next;
  }
}
