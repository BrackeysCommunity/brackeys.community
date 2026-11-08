import type { DocLayout } from "./kinds";
import { byCodeUnit, isPlainObject } from "./kinds/define";

/** JSON with object keys sorted, so equal values give equal text whatever order their keys were set in. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value)
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Whether two JSON values are equal whatever order their keys were set in. */
export const sameValue = (a: unknown, b: unknown): boolean => stableJson(a) === stableJson(b);

/** A deep copy of a JSON value; undefined stays undefined. */
export const cloneJson = <T>(v: T): T =>
  v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);

/** Keys that lead a declarative file, as they lead a scene or prefab file. */
const CANONICAL_HEADER_KEYS = ["$schema", "kind", "v"] as const;

type MapLayout = Extract<DocLayout, { as: "map" }>;
type Json = Record<string, unknown>;

const ATOMIC: DocLayout = { as: "atomic" };

/** The layout of `key` inside a map: its declared field, else `rest`, else atomic. */
export function fieldLayout(layout: MapLayout, key: string): DocLayout {
  return (Object.hasOwn(layout.fields ?? {}, key) ? layout.fields![key] : layout.rest) ?? ATOMIC;
}

/** `lead` keys first, then the layout's declared fields in order, then the rest by code unit; undefined values are left out. */
function orderedKeys(obj: Json, layout: MapLayout | null, lead: readonly string[]): string[] {
  const present = (k: string) => Object.hasOwn(obj, k) && obj[k] !== undefined;
  const first = [...lead, ...Object.keys(layout?.fields ?? {})].filter(
    (k, i, all) => present(k) && all.indexOf(k) === i,
  );
  const rest = Object.keys(obj)
    .filter((k) => present(k) && !first.includes(k))
    .sort(byCodeUnit);
  return [...first, ...rest];
}

/** Single-line JSON with `, ` separators and spaced braces; keys follow the layout where it says anything about them. */
function inline(value: unknown, layout: DocLayout, lead: readonly string[] = []): string {
  if (Array.isArray(value)) {
    if (layout.as === "keyed") {
      const id = [layout.id ?? "id"];
      return `[${value.map((v) => inline(v, layout.item, id)).join(", ")}]`;
    }
    const item = layout.as === "list" ? layout.item : ATOMIC;
    return `[${value.map((v) => inline(v, item)).join(", ")}]`;
  }
  if (isPlainObject(value)) {
    const map = layout.as === "map" ? layout : null;
    const keys = orderedKeys(value, map, lead);
    if (keys.length === 0) return "{}";
    const member = (k: string) =>
      `${JSON.stringify(k)}: ${inline(value[k], map ? fieldLayout(map, k) : ATOMIC)}`;
    return `{ ${keys.map(member).join(", ")} }`;
  }
  return JSON.stringify(value) ?? "null";
}

function block(value: unknown, layout: DocLayout, indent: string, root: boolean): string {
  const inner = `${indent}  `;
  if (layout.as === "map" && isPlainObject(value)) {
    const keys = orderedKeys(value, layout, root ? CANONICAL_HEADER_KEYS : []);
    if (keys.length === 0) return "{}";
    const members = keys.map(
      (k) =>
        `${inner}${JSON.stringify(k)}: ${block(value[k], fieldLayout(layout, k), inner, false)}`,
    );
    return `{\n${members.join(",\n")}\n${indent}}`;
  }
  if ((layout.as === "list" || layout.as === "keyed") && Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const lead = layout.as === "keyed" ? [layout.id ?? "id"] : [];
    const rows = value.map((item) => `${inner}${inline(item, layout.item, lead)}`);
    return `[\n${rows.join(",\n")}\n${indent}]`;
  }
  return inline(value, layout);
}

/**
 * The canonical text of a declarative kind's value: two-space indentation;
 * at the root `$schema`, `kind` and `v` first; object keys in the layout's
 * declared order then by code unit; each item of a `keyed` or `list`
 * collection on one line, a keyed item's id first; an atomic value on one
 * line; a trailing newline. A value that doesn't fit its layout is written
 * as an atomic one.
 */
export function canonicalJson(value: unknown, layout: DocLayout): string {
  return `${block(value, layout, "", true)}\n`;
}
