import type { InputScript } from "../headless/playtest-types";
import { canonicalJson } from "../project/canonical";
import type { DocLayout } from "../project/kinds/define";
import type { ChecksFile } from "./checks";
import { jsonPointer, pointerSegments } from "./issues";
import { RESERVED_SCENE_KEYS, SCENE_HEADER_KEYS, type Prefab, type SceneDefinition } from "./types";

/**
 * Keys that lead an object, in this order: an entity's identity, then its
 * geometry; in a path (an object with `pts`), the path's own keys. Every
 * other key follows, sorted by code unit, so the text never depends on a
 * registry.
 */
const ENTITY_KEY_ORDER = [
  "id",
  "type",
  "prefab",
  "name",
  "layer",
  "group",
  "off",
  "shape",
  "at",
  "path",
  "overrides",
];
const PATH_KEY_ORDER = ["pts", "mode", "speed", "pauseMs"];

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function ordered(obj: Record<string, unknown>): [string, unknown][] {
  const order = "pts" in obj ? PATH_KEY_ORDER : ENTITY_KEY_ORDER;
  const present = (k: string) => obj[k] !== undefined;
  const known = order.filter(present);
  const rest = Object.keys(obj)
    .filter((k) => present(k) && !order.includes(k))
    .sort(byCodeUnit);
  return [...known, ...rest].map((k) => [k, obj[k]]);
}

/** Top-level keys written one item per line: the bulk arrays, `instances` and `entities`; `groups` one group per line. */
const isRowKey = (key: string, value: unknown) =>
  key === "instances" ||
  (!(SCENE_HEADER_KEYS as readonly string[]).includes(key) && Array.isArray(value));

/** Where a top-level key sorts: header keys, then bulk keys by code unit, then `entities`. */
function compareTopKeys(a: string, b: string): number {
  const rank = (k: string) => {
    const header = (SCENE_HEADER_KEYS as readonly string[]).indexOf(k);
    return header >= 0 ? header : (k === "entities" ? 2 : 1) * 1000;
  };
  return rank(a) - rank(b) || byCodeUnit(a, b);
}

/** Where a key inside an entity or path sorts, as `ordered` writes it. */
function compareInnerKeys(a: string, b: string, inPath: boolean): number {
  const order = inPath ? PATH_KEY_ORDER : ENTITY_KEY_ORDER;
  const rank = (k: string) => {
    const i = order.indexOf(k);
    return i < 0 ? order.length : i;
  };
  return rank(a) - rank(b) || byCodeUnit(a, b);
}

/**
 * Orders two JSON Pointers by where they land in `formatScene`'s text: an
 * ancestor before what it holds, array items by index, keys in canonical
 * order. A missing pointer sorts last. Inside an object, a key under `path`
 * is taken to be a path's.
 */
export function comparePointers(a: string | undefined, b: string | undefined): number {
  if (a === b) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  const sa = pointerSegments(a);
  const sb = pointerSegments(b);
  for (let i = 0; i < Math.min(sa.length, sb.length); i++) {
    const x = sa[i]!;
    const y = sb[i]!;
    if (x === y) continue;
    const nx = /^\d+$/.test(x) ? Number(x) : NaN;
    const ny = /^\d+$/.test(y) ? Number(y) : NaN;
    if (!Number.isNaN(nx) && !Number.isNaN(ny)) return nx - ny;
    return i === 0 ? compareTopKeys(x, y) : compareInnerKeys(x, y, sa[i - 1] === "path");
  }
  return sa.length - sb.length;
}

/** Single-line JSON with `, ` separators and spaced braces. */
function inline(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(inline).join(", ")}]`;
  if (value !== null && typeof value === "object") {
    const entries = ordered(value as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    return `{ ${entries.map(([k, v]) => `${JSON.stringify(k)}: ${inline(v)}`).join(", ")} }`;
  }
  return JSON.stringify(value) ?? "null";
}

function addNested(
  lines: Map<string, number>,
  pointer: string,
  value: unknown,
  line: number,
): void {
  lines.set(pointer, line);
  if (Array.isArray(value)) value.forEach((v, i) => addNested(lines, `${pointer}/${i}`, v, line));
  else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value))
      addNested(lines, `${pointer}${jsonPointer([k])}`, v, line);
  }
}

/**
 * The canonical text of a scene, without a registry: header keys in
 * `SCENE_HEADER_KEYS` order, then bulk keys sorted by code unit, then
 * `entities`; one tuple, instance, entity or group per line, two-space
 * indent, trailing newline. Empty arrays and an empty `groups` are left out. `lines`
 * maps every JSON Pointer to its 1-based line; pointers inside a tuple or
 * entity map to that item's line.
 */
export function formatScene(def: SceneDefinition): { text: string; lines: Map<string, number> } {
  const out: string[] = ["{"];
  const lines = new Map<string, number>([["", 1]]);
  const doc = def as Record<string, unknown>;
  const members: [string, unknown][] = [];
  for (const key of SCENE_HEADER_KEYS) if (doc[key] !== undefined) members.push([key, doc[key]]);
  const bulkKeys = Object.keys(doc)
    .filter((k) => !RESERVED_SCENE_KEYS.includes(k) && doc[k] !== undefined)
    .sort(byCodeUnit);
  for (const key of [...bulkKeys, "entities"]) {
    const value = doc[key];
    if (value === undefined || (Array.isArray(value) && value.length === 0)) continue;
    members.push([key, value]);
  }
  for (const key of ["groups", "instances"]) {
    const m = members.findIndex(([k]) => k === key);
    const value = m >= 0 ? members[m]![1] : undefined;
    const empty = Array.isArray(value)
      ? value.length === 0
      : value !== null && typeof value === "object" && Object.keys(value).length === 0;
    if (empty) members.splice(m, 1);
  }

  members.forEach(([key, value], m) => {
    const comma = m < members.length - 1 ? "," : "";
    const pointer = jsonPointer([key]);
    const keyText = `  ${JSON.stringify(key)}: `;
    if (key === "groups" && value !== null && typeof value === "object") {
      const ids = Object.keys(value).sort(byCodeUnit);
      lines.set(pointer, out.length + 1);
      out.push(`${keyText}{`);
      ids.forEach((id, i) => {
        const group = (value as Record<string, unknown>)[id];
        addNested(lines, `${pointer}${jsonPointer([id])}`, group, out.length + 1);
        out.push(`    ${JSON.stringify(id)}: ${inline(group)}${i < ids.length - 1 ? "," : ""}`);
      });
      out.push(`  }${comma}`);
      return;
    }
    if (!isRowKey(key, value) || !Array.isArray(value)) {
      addNested(lines, pointer, value, out.length + 1);
      out.push(`${keyText}${inline(value)}${comma}`);
      return;
    }
    lines.set(pointer, out.length + 1);
    out.push(`${keyText}[`);
    value.forEach((row, i) => {
      addNested(lines, `${pointer}/${i}`, row, out.length + 1);
      out.push(`    ${inline(row)}${i < value.length - 1 ? "," : ""}`);
    });
    out.push(`  ]${comma}`);
  });
  out.push("}");
  return { text: `${out.join("\n")}\n`, lines };
}

const PREFAB_HEADER_KEYS = ["$schema", "kind", "v", "game", "id", "contract"] as const;

/**
 * The canonical text of a prefab file: its header keys inline, then
 * `entities` one per line, then `bulk` one array per key with one entry per
 * line, keys sorted by code unit.
 */
export function formatPrefab(prefab: Prefab): string {
  const doc = prefab as Record<string, unknown>;
  const parts: string[][] = [];
  for (const key of PREFAB_HEADER_KEYS)
    if (doc[key] !== undefined) parts.push([`  ${JSON.stringify(key)}: ${inline(doc[key])}`]);
  const rows = (indent: string, items: readonly unknown[]) =>
    items.map((row, i) => `${indent}${inline(row)}${i < items.length - 1 ? "," : ""}`);
  if (prefab.entities.length > 0)
    parts.push(['  "entities": [', ...rows("    ", prefab.entities), "  ]"]);
  const bulk = Object.keys(prefab.bulk ?? {})
    .filter((k) => prefab.bulk![k]!.length > 0)
    .sort(byCodeUnit);
  if (bulk.length > 0) {
    const lines = ['  "bulk": {'];
    bulk.forEach((k, i) => {
      lines.push(`    ${JSON.stringify(k)}: [`, ...rows("      ", prefab.bulk![k]!));
      lines.push(`    ]${i < bulk.length - 1 ? "," : ""}`);
    });
    lines.push("  }");
    parts.push(lines);
  }
  const body = parts.map((p, i) => {
    if (i < parts.length - 1) p[p.length - 1] += ",";
    return p.join("\n");
  });
  return `{\n${body.join("\n")}\n}\n`;
}

const ATOMIC: DocLayout = { as: "atomic" };

/**
 * An input script in Yjs and on disk: steps merge by insert, each step
 * replaced whole; the header keys before `steps` in this order.
 */
export const INPUT_SCRIPT_LAYOUT = {
  as: "map",
  fields: {
    scene: ATOMIC,
    at: ATOMIC,
    timeOffsetMs: ATOMIC,
    game: ATOMIC,
    maxTicks: ATOMIC,
    steps: { as: "list", item: ATOMIC },
  },
  rest: ATOMIC,
} as const satisfies DocLayout;

/** A checks file in Yjs and on disk: checks keyed by id, merging per check and field; `kind` after the id. */
export const CHECKS_LAYOUT = {
  as: "map",
  fields: { checks: { as: "keyed", item: { as: "map", fields: { kind: ATOMIC }, rest: ATOMIC } } },
  rest: ATOMIC,
} as const satisfies DocLayout;

/** The canonical text of an input script: `canonicalJson` over `INPUT_SCRIPT_LAYOUT`, one step per line. */
export function formatInputScript(script: InputScript): string {
  return canonicalJson(script, INPUT_SCRIPT_LAYOUT);
}

/** The canonical text of a checks file: `canonicalJson` over `CHECKS_LAYOUT`, one check per line. */
export function formatChecks(file: ChecksFile): string {
  return canonicalJson(file, CHECKS_LAYOUT);
}
