import { jsonPointer, makeIssue } from "../scene/issues";
import type { SceneIssue } from "../scene/types";
import { fieldLayout } from "./canonical";
import type { DocLayout } from "./kinds";
import { isPlainObject } from "./kinds/define";
import type { JsonEdit, JsonPointer } from "./ops";

type Json = Record<string, unknown>;
type Container = "map" | "list" | "keyed";

export type JsonEditResult =
  | { ok: true; value: unknown }
  /** `issue.path` points into the edit list: `/<index>/<field>`. */
  | { ok: false; index: number; issue: SceneIssue };

export type PointerRead =
  | { ok: true; value: unknown; layout: DocLayout }
  | { ok: false; issue: SceneIssue };

const INDEX = /^(0|[1-9]\d*)$/;
/** RFC 6901's "past the last item" token; only `insert` takes it, as its last segment. */
const END = "-";

/** Edit-level failure; caught by `applyJsonEdits`, never escapes it. */
class EditRefusal extends Error {
  constructor(
    readonly issue: SceneIssue,
    readonly field: string,
  ) {
    super(issue.message);
  }
}

const refuse = (
  code: "op-invalid" | "ref-not-found" | "id-taken",
  message: string,
  field: string,
): never => {
  throw new EditRefusal(makeIssue(code, { message }), field);
};

/**
 * The reference tokens of an RFC 6901 pointer, unescaped; null when it is
 * malformed (no leading "/", or a "~" not followed by 0 or 1). A token
 * "@<id>" picks a keyed item by id only where the layout has a keyed
 * collection; in a map it is an ordinary key.
 */
export function parseJsonPointer(pointer: JsonPointer): string[] | null {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) return null;
  const out: string[] = [];
  for (const raw of pointer.slice(1).split("/")) {
    if (/~(?![01])/.test(raw)) return null;
    out.push(raw.replace(/~1/g, "/").replace(/~0/g, "~"));
  }
  return out;
}

/** The pointer of one keyed item, `<collection>/@<id>`. */
export function keyedItemPointer(collection: JsonPointer, id: string): JsonPointer {
  return `${collection}${jsonPointer([`@${id}`])}`;
}

function idOf(layout: Extract<DocLayout, { as: "keyed" }>): string {
  return layout.id ?? "id";
}

function containerOf(layout: DocLayout): Container | null {
  return layout.as === "map" || layout.as === "list" || layout.as === "keyed" ? layout.as : null;
}

/** Where a token lands in an array: an index for a list, an index or "@<id>" for a keyed collection; -1 when absent. */
function indexIn(
  arr: unknown[],
  layout: DocLayout,
  token: string,
  at: string,
  field: string,
): number {
  if (INDEX.test(token)) {
    const i = Number(token);
    return i < arr.length ? i : -1;
  }
  if (layout.as === "keyed" && token.startsWith("@")) {
    const id = token.slice(1);
    const key = idOf(layout);
    return arr.findIndex((item) => isPlainObject(item) && item[key] === id);
  }
  if (token === END) {
    return refuse(
      "op-invalid",
      `"-" at ${at || "the root"} names no item; only an insert's last segment may be "-".`,
      field,
    );
  }
  return refuse(
    "op-invalid",
    layout.as === "keyed"
      ? `"${token}" at ${at || "the root"} is neither an index nor "@<id>".`
      : `"${token}" at ${at || "the root"} isn't a list index.`,
    field,
  );
}

const describeMissing = (token: string, at: string) =>
  token.startsWith("@")
    ? `No item with id "${token.slice(1)}" in ${at || "the root"}.`
    : `Nothing at "${token}" in ${at || "the root"}.`;

/** One step down: the child's container (its layout says what it holds) and value; refuses inside atomic and text values. */
function step(
  node: unknown,
  layout: DocLayout,
  token: string,
  at: string,
  field: string,
): { holder: Json | unknown[]; key: string | number; layout: DocLayout; exists: boolean } {
  const container = containerOf(layout);
  if (container === null) {
    return refuse(
      "op-invalid",
      `${at || "The root"} is ${layout.as === "text" ? "a text" : "an atomic"} value; set the whole value instead of a part of it.`,
      field,
    );
  }
  if (container === "map") {
    if (!isPlainObject(node))
      return refuse("op-invalid", `${at || "The root"} isn't an object.`, field);
    const child = fieldLayout(layout as Extract<DocLayout, { as: "map" }>, token);
    return { holder: node, key: token, layout: child, exists: Object.hasOwn(node, token) };
  }
  if (!Array.isArray(node))
    return refuse("op-invalid", `${at || "The root"} isn't an array.`, field);
  const item = (layout as Extract<DocLayout, { as: "list" | "keyed" }>).item;
  const i = indexIn(node, layout, token, at, field);
  return { holder: node, key: i < 0 ? token : i, layout: item, exists: i >= 0 };
}

type Walked = {
  value: unknown;
  layout: DocLayout;
  /** Set when the last token picked an item of a keyed collection. */
  keyed?: { items: unknown[]; layout: Extract<DocLayout, { as: "keyed" }>; index: number };
};

/** Walks every token, all of which must exist. */
function walk(root: unknown, layout: DocLayout, tokens: readonly string[], field: string): Walked {
  let walked: Walked = { value: root, layout };
  let at = "";
  for (const token of tokens) {
    const next = step(walked.value, walked.layout, token, at, field);
    if (!next.exists) return refuse("ref-not-found", describeMissing(token, at), field);
    const value = (next.holder as Json)[next.key as string];
    walked =
      walked.layout.as === "keyed"
        ? {
            value,
            layout: next.layout,
            keyed: {
              items: next.holder as unknown[],
              layout: walked.layout,
              index: next.key as number,
            },
          }
        : { value, layout: next.layout };
    at += jsonPointer([token]);
  }
  return walked;
}

function tokensOf(pointer: unknown, field: string): string[] {
  const tokens = typeof pointer === "string" ? parseJsonPointer(pointer) : null;
  if (tokens === null) {
    return refuse("op-invalid", `${JSON.stringify(pointer)} isn't a JSON Pointer.`, field);
  }
  return tokens;
}

/** The value at `pointer`, walking the layout the way `applyJsonEdits` does. */
export function readPointer(value: unknown, layout: DocLayout, pointer: JsonPointer): PointerRead {
  try {
    return { ok: true, ...walk(value, layout, tokensOf(pointer, ""), "") };
  } catch (e) {
    if (e instanceof EditRefusal) return { ok: false, issue: e.issue };
    throw e;
  }
}

function isJsonValue(v: unknown): boolean {
  if (v === null || typeof v === "string" || typeof v === "boolean") return true;
  if (typeof v === "number") return Number.isFinite(v);
  if (Array.isArray(v)) return v.every(isJsonValue);
  if (isPlainObject(v)) {
    const proto = Object.getPrototypeOf(v);
    return (
      (proto === Object.prototype || proto === null) &&
      Object.values(v).every((x) => x === undefined || isJsonValue(x))
    );
  }
  return false;
}

/** An own data property, so a "__proto__" key stays a key. */
function put(obj: Json, key: string, value: unknown): void {
  Object.defineProperty(obj, key, { value, writable: true, enumerable: true, configurable: true });
}

function cloneJson<T>(v: T): T {
  if (Array.isArray(v)) return v.map(cloneJson) as T;
  if (isPlainObject(v)) {
    const out: Json = {};
    for (const [k, x] of Object.entries(v)) if (x !== undefined) put(out, k, cloneJson(x));
    return out as T;
  }
  return v;
}

/** Why `value` can't live where `layout` puts it, or null when it fits. */
function misfit(value: unknown, layout: DocLayout): string | null {
  switch (layout.as) {
    case "atomic":
      return null;
    case "text":
      return typeof value === "string" ? null : "a string";
    case "map": {
      if (!isPlainObject(value)) return "an object";
      for (const [k, v] of Object.entries(value)) {
        if (v === undefined) continue;
        const why = misfit(v, fieldLayout(layout, k));
        if (why) return `${why} at ${jsonPointer([k])}`;
      }
      return null;
    }
    case "list": {
      if (!Array.isArray(value)) return "an array";
      for (const [i, v] of value.entries()) {
        const why = misfit(v, layout.item);
        if (why) return `${why} at /${i}`;
      }
      return null;
    }
    case "keyed": {
      if (!Array.isArray(value)) return "an array of items with ids";
      const ids = new Set<string>();
      for (const [i, v] of value.entries()) {
        const why = misfitItem(v, layout) ?? misfit(v, layout.item);
        if (why) return `${why} at /${i}`;
        const id = (v as Json)[idOf(layout)] as string;
        if (ids.has(id)) return `items with distinct ids ("${id}" repeats) at /${i}`;
        ids.add(id);
      }
      return null;
    }
  }
}

function misfitItem(value: unknown, layout: Extract<DocLayout, { as: "keyed" }>): string | null {
  const key = idOf(layout);
  return isPlainObject(value) && typeof value[key] === "string" && value[key] !== ""
    ? null
    : `an object with a string "${key}"`;
}

function checkValue(value: unknown, layout: DocLayout, at: string): void {
  if (value === undefined) {
    return refuse("op-invalid", `The edit at ${at || "the root"} has no value.`, "value");
  }
  if (!isJsonValue(value)) {
    return refuse("op-invalid", `The value for ${at || "the root"} isn't plain JSON.`, "value");
  }
  const why = misfit(value, layout);
  if (why)
    return refuse("op-invalid", `The value for ${at || "the root"} must be ${why}.`, "value");
}

/** Checks a whole item for a keyed collection; it must not repeat another item's id. */
function checkKeyedItem(
  value: unknown,
  items: readonly unknown[],
  layout: Extract<DocLayout, { as: "keyed" }>,
  at: string,
  except = -1,
): void {
  checkValue(value, layout.item, at);
  const why = misfitItem(value, layout);
  if (why) return refuse("op-invalid", `An item of ${at || "the root"} must be ${why}.`, "value");
  const key = idOf(layout);
  const id = (value as Json)[key];
  if (items.some((item, i) => i !== except && isPlainObject(item) && item[key] === id)) {
    return refuse(
      "id-taken",
      `${at || "The root"} already has an item with id "${String(id)}".`,
      "value",
    );
  }
}

/** The list or keyed collection `tokens` name; an absent key whose layout is one starts as []. */
function collectionAt(
  root: unknown,
  layout: DocLayout,
  tokens: readonly string[],
  field: string,
): Walked {
  if (tokens.length === 0) return { value: root, layout };
  const parent = walk(root, layout, tokens.slice(0, -1), field);
  const parentAt = jsonPointer(tokens.slice(0, -1));
  const last = tokens.at(-1)!;
  const slot = step(parent.value, parent.layout, last, parentAt, field);
  if (slot.exists) return walk(root, layout, tokens, field);
  if (!Array.isArray(slot.holder) && (slot.layout.as === "list" || slot.layout.as === "keyed")) {
    const created: unknown[] = [];
    put(slot.holder, last, created);
    return { value: created, layout: slot.layout };
  }
  return refuse("ref-not-found", describeMissing(last, parentAt), field);
}

/** A last "-" names the end of the collection above it: the same append as omitting `before`. */
function insert(root: unknown, layout: DocLayout, pointer: string[], edit: JsonEdit): void {
  const { value, before } = edit as Extract<JsonEdit, { insert: JsonPointer }>;
  const append = pointer.at(-1) === END;
  const tokens = append ? pointer.slice(0, -1) : pointer;
  const at = jsonPointer(tokens);
  if (append && before !== undefined) {
    return refuse(
      "op-invalid",
      `${jsonPointer(pointer)} already names the end; drop before.`,
      "before",
    );
  }
  const target = collectionAt(root, layout, tokens, "insert");
  const coll = target.layout;
  if (coll.as !== "list" && coll.as !== "keyed") {
    return refuse("op-invalid", `${at || "The root"} isn't a list or keyed collection.`, "insert");
  }
  const items = target.value;
  if (!Array.isArray(items))
    return refuse("op-invalid", `${at || "The root"} isn't an array.`, "insert");
  if (coll.as === "keyed") checkKeyedItem(value, items, coll, at);
  else checkValue(value, coll.item, at);
  let index = items.length;
  if (typeof before === "number") {
    if (!Number.isInteger(before) || before < 0 || before > items.length) {
      return refuse(
        "op-invalid",
        `before ${before} is outside 0…${items.length} in ${at}.`,
        "before",
      );
    }
    index = before;
  } else if (typeof before === "string") {
    if (coll.as !== "keyed") {
      return refuse("op-invalid", `${at} is a list, so before is an index.`, "before");
    }
    index = items.findIndex((item) => isPlainObject(item) && item[idOf(coll)] === before);
    if (index < 0)
      return refuse("ref-not-found", `No item with id "${before}" in ${at}.`, "before");
  } else if (before !== undefined) {
    return refuse("op-invalid", "before is a sibling's id or an index.", "before");
  }
  items.splice(index, 0, cloneJson(value));
}

function applyOne(root: unknown, layout: DocLayout, edit: JsonEdit): unknown {
  if (!isPlainObject(edit)) return refuse("op-invalid", "An edit must be an object.", "");
  const names = (["set", "unset", "insert", "remove"] as const).filter((k) =>
    Object.hasOwn(edit, k),
  );
  if (names.length !== 1) {
    return refuse("op-invalid", "An edit names exactly one of set, unset, insert and remove.", "");
  }
  const name = names[0]!;
  const tokens = tokensOf((edit as Record<string, unknown>)[name], name);
  if (name === "insert") {
    insert(root, layout, tokens, edit);
    return root;
  }
  if (tokens.length === 0) {
    if (name !== "set")
      return refuse("op-invalid", `${name} needs a pointer below the root.`, name);
    const { value } = edit as Extract<JsonEdit, { set: JsonPointer }>;
    checkValue(value, layout, "");
    return cloneJson(value);
  }

  const at = jsonPointer(tokens);
  const parentAt = jsonPointer(tokens.slice(0, -1));
  const parent = walk(root, layout, tokens.slice(0, -1), name);
  const last = tokens.at(-1)!;
  const slot = step(parent.value, parent.layout, last, parentAt, name);
  /** The parent is a keyed item and `last` is its id field. */
  const idField = parent.keyed !== undefined && last === idOf(parent.keyed.layout);

  if (Array.isArray(slot.holder)) {
    if (name === "unset") {
      return refuse("op-invalid", `${at} is a collection item; remove it instead.`, name);
    }
    if (!slot.exists) return refuse("ref-not-found", describeMissing(last, parentAt), name);
    const index = slot.key as number;
    if (name === "remove") {
      slot.holder.splice(index, 1);
      return root;
    }
    const { value } = edit as Extract<JsonEdit, { set: JsonPointer }>;
    if (parent.layout.as === "keyed")
      checkKeyedItem(value, slot.holder, parent.layout, parentAt, index);
    else checkValue(value, slot.layout, at);
    slot.holder[index] = cloneJson(value);
    return root;
  }

  if (name === "remove")
    return refuse("op-invalid", `${at} is an object key; unset it instead.`, name);
  if (name === "unset") {
    if (idField) return refuse("op-invalid", `${at} is the item's id; it can't be unset.`, name);
    delete slot.holder[last];
    return root;
  }
  const { value } = edit as Extract<JsonEdit, { set: JsonPointer }>;
  checkValue(value, slot.layout, at);
  if (idField) {
    const { items, layout: keyed, index } = parent.keyed!;
    const item = cloneJson(slot.holder);
    put(item, last, value);
    checkKeyedItem(item, items, keyed, jsonPointer(tokens.slice(0, -2)), index);
  }
  put(slot.holder, last, cloneJson(value));
  return root;
}

/**
 * Applies edits in order to a copy of a declarative kind's plain JSON. The
 * layout decides what a pointer may address: keys of a map, indices of a
 * list, indices or "@<id>" of a keyed collection; never the inside of an
 * atomic or text value (`op-invalid`: set the whole value). `insert` goes
 * into a list or keyed collection, creating it when its key is absent; its
 * pointer may end in RFC 6901's "-" to append, as an omitted `before` does;
 * `remove` takes a collection item out; `unset` drops an object key and is
 * a no-op when the key is absent. The input is never changed, and the first
 * failing edit stops the batch.
 */
export function applyJsonEdits(
  value: unknown,
  layout: DocLayout,
  edits: readonly JsonEdit[],
): JsonEditResult {
  let current = cloneJson(value);
  for (const [index, edit] of edits.entries()) {
    try {
      current = applyOne(current, layout, edit);
    } catch (e) {
      if (!(e instanceof EditRefusal)) throw e;
      const path = jsonPointer(e.field ? [index, e.field] : [index]);
      return { ok: false, index, issue: { ...e.issue, path } };
    }
  }
  return { ok: true, value: current };
}
