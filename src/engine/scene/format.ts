import { BEHAVIORS_FIELD } from "../game/behaviors";
import type { InputScript } from "../headless/playtest-types";
import { canonicalJson } from "../project/canonical";
import type { DocLayout } from "../project/kinds/define";
import type { ChecksFile } from "./checks";
import { compareChunkKeys, isGridValue, parseChunkKey, type GridCells } from "./grid";
import { jsonPointer, pointerSegments } from "./issues";
import { RESERVED_SCENE_KEYS, SCENE_HEADER_KEYS, type Prefab, type SceneDefinition } from "./types";

/**
 * Keys that lead an object, in this order: an entity's or instance's
 * identity, its draw order, then its geometry; in a path (an object with
 * `pts`), the path's own keys. Every other key follows, sorted by code unit,
 * then `behaviors`, then grid-valued keys, so the text never depends on a
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
  "z",
  "shape",
  "at",
  "rot",
  "flip",
  "path",
  "params",
  "overrides",
];
const PATH_KEY_ORDER = ["pts", "mode", "speed", "pauseMs"];

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Keys of `obj` that hold a grid, sorted by code unit; never one of the leading keys or `behaviors`. */
function gridKeys(obj: Record<string, unknown>): string[] {
  return Object.keys(obj)
    .filter((k) => k !== BEHAVIORS_FIELD && !ENTITY_KEY_ORDER.includes(k) && isGridValue(obj[k]))
    .sort(byCodeUnit);
}

function ordered(obj: Record<string, unknown>, plain = false): [string, unknown][] {
  const present = (k: string) => obj[k] !== undefined;
  if (isGridValue(obj))
    return Object.keys(obj)
      .sort(compareChunkKeys)
      .map((k) => [k, obj[k]]);
  if (plain)
    return Object.keys(obj)
      .filter(present)
      .sort(byCodeUnit)
      .map((k) => [k, obj[k]]);
  const inPath = "pts" in obj;
  const grids = inPath ? [] : gridKeys(obj);
  return Object.keys(obj)
    .filter(present)
    .sort((a, b) => compareInnerKeys(a, b, inPath, grids))
    .map((k) => [k, obj[k]]);
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

/**
 * Where a key inside an entity or instance sorts, as `formatScene` writes it.
 * Pass the entity to place its grid-valued keys, which go last.
 */
export const compareEntityKeys = (a: string, b: string, entity?: Record<string, unknown>): number =>
  compareInnerKeys(a, b, false, entity ? gridKeys(entity) : []);

/** An `assets` header as written: sorted by code unit, each id once. */
export function sortedAssets(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort(byCodeUnit);
}

/** Where a key inside an entity or path sorts, as `ordered` writes it; `grids` are the object's grid-valued keys. */
function compareInnerKeys(
  a: string,
  b: string,
  inPath: boolean,
  grids: readonly string[] = [],
): number {
  const order = inPath ? PATH_KEY_ORDER : ENTITY_KEY_ORDER;
  const rank = (k: string) => {
    const i = order.indexOf(k);
    if (i >= 0) return i;
    if (inPath) return order.length;
    if (grids.includes(k)) return order.length + 2;
    return k === BEHAVIORS_FIELD ? order.length + 1 : order.length;
  };
  return rank(a) - rank(b) || byCodeUnit(a, b);
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * Orders two JSON Pointers by where they land in `formatScene`'s text: an
 * ancestor before what it holds, array items by index, keys in canonical
 * order, chunk keys row-major. A missing pointer sorts last. Inside an
 * object, a key under `path` is taken to be a path's and a key under
 * `behaviors` a behavior's. Pass the document to place grid-valued keys,
 * which only their values tell apart.
 */
export function comparePointers(
  a: string | undefined,
  b: string | undefined,
  doc?: unknown,
): number {
  if (a === b) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  const sa = pointerSegments(a);
  const sb = pointerSegments(b);
  let holder: unknown = doc;
  for (let i = 0; i < Math.min(sa.length, sb.length); i++) {
    const x = sa[i]!;
    const y = sb[i]!;
    if (x !== y) {
      const nx = /^\d+$/.test(x) ? Number(x) : NaN;
      const ny = /^\d+$/.test(y) ? Number(y) : NaN;
      if (!Number.isNaN(nx) && !Number.isNaN(ny)) return nx - ny;
      if (i === 0) return compareTopKeys(x, y);
      if (parseChunkKey(x) && parseChunkKey(y)) return compareChunkKeys(x, y);
      if (sa[i - 1] === BEHAVIORS_FIELD) return byCodeUnit(x, y);
      const grids = isObject(holder) ? gridKeys(holder) : [];
      return compareInnerKeys(x, y, sa[i - 1] === "path", grids);
    }
    holder =
      isObject(holder) || Array.isArray(holder)
        ? (holder as Record<string, unknown>)[x]
        : undefined;
  }
  return sa.length - sb.length;
}

/** Single-line JSON with `, ` separators and spaced braces; `plain` sorts an object's keys by code unit only. */
function inline(value: unknown, plain = false): string {
  if (Array.isArray(value)) return `[${value.map((v) => inline(v)).join(", ")}]`;
  if (value !== null && typeof value === "object") {
    const entries = ordered(value as Record<string, unknown>, plain);
    if (entries.length === 0) return "{}";
    return `{ ${entries.map(([k, v]) => member(k, v)).join(", ")} }`;
  }
  return JSON.stringify(value) ?? "null";
}

/** `"key": value`; behavior blocks are keyed by name in code-unit order. */
const member = (k: string, v: unknown) =>
  `${JSON.stringify(k)}: ${inline(v, k === BEHAVIORS_FIELD && isObject(v))}`;

/**
 * One row of a row array (an entity, instance or bulk entry) as its lines,
 * each with `indent`: one line, except an object holding grids, whose grid
 * fields come last with one chunk per line. Records each pointer in the row
 * at its line, numbered from `first`.
 */
function rowLines(
  row: unknown,
  indent: string,
  pointer: string,
  first: number,
  lines?: Map<string, number>,
): string[] {
  const grids = isObject(row) ? gridKeys(row) : [];
  if (lines) addNested(lines, pointer, row, first);
  if (grids.length === 0) return [`${indent}${inline(row)}`];
  const entries = ordered(row as Record<string, unknown>).filter(([k]) => !grids.includes(k));
  const out: string[] = [];
  let head = `${indent}{ ${entries.map(([k, v]) => `${member(k, v)}, `).join("")}`;
  grids.forEach((field, g) => {
    const grid = (row as Record<string, GridCells>)[field]!;
    const fieldPointer = `${pointer}${jsonPointer([field])}`;
    if (lines && g > 0) lines.set(fieldPointer, first + out.length);
    out.push(`${head}${JSON.stringify(field)}: {`);
    const keys = Object.keys(grid).sort(compareChunkKeys);
    keys.forEach((key, i) => {
      if (lines)
        addNested(lines, `${fieldPointer}${jsonPointer([key])}`, grid[key], first + out.length);
      out.push(
        `${indent}  ${JSON.stringify(key)}: ${inline(grid[key])}${i < keys.length - 1 ? "," : ""}`,
      );
    });
    head = `${indent}}, `;
  });
  out.push(`${indent}} }`);
  return out;
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
 * `entities`; one tuple, instance, entity or group per line, the `assets`
 * header on one line, sorted and unique, two-space indent, trailing
 * newline. An entity holding grids spans lines: its grid fields last, one
 * chunk per line. Empty arrays and an empty `groups` are left out. `lines`
 * maps every JSON Pointer to its 1-based line; pointers inside a tuple or
 * entity map to that item's first line, except those inside a chunk (its
 * line) and a later grid field's key (the line it opens on).
 */
export function formatScene(def: SceneDefinition): { text: string; lines: Map<string, number> } {
  const out: string[] = ["{"];
  const lines = new Map<string, number>([["", 1]]);
  const doc = def as Record<string, unknown>;
  const members: [string, unknown][] = [];
  for (const key of SCENE_HEADER_KEYS) {
    const value = doc[key];
    if (value === undefined) continue;
    members.push([key, key === "assets" && Array.isArray(value) ? sortedAssets(value) : value]);
  }
  const bulkKeys = Object.keys(doc)
    .filter((k) => !RESERVED_SCENE_KEYS.includes(k) && doc[k] !== undefined)
    .sort(byCodeUnit);
  for (const key of [...bulkKeys, "entities"]) {
    const value = doc[key];
    if (value === undefined || (Array.isArray(value) && value.length === 0)) continue;
    members.push([key, value]);
  }
  for (const key of ["assets", "groups", "instances"]) {
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
      const rows = rowLines(row, "    ", `${pointer}/${i}`, out.length + 1, lines);
      if (i < value.length - 1) rows[rows.length - 1] += ",";
      out.push(...rows);
    });
    out.push(`  ]${comma}`);
  });
  out.push("}");
  return { text: `${out.join("\n")}\n`, lines };
}

/** A prefab's leading keys, each written on one line. */
const PREFAB_INLINE_KEYS = ["$schema", "kind", "v", "game", "id", "base", "contract"] as const;

/**
 * The canonical text of a prefab file, two-space indent, trailing newline:
 * `$schema`, `kind`, `v`, `game`, `id`, `base` and `contract` one per line;
 * `params` one param per line; `assets` on one line, sorted and unique;
 * `overrides` one per line; `bulk` one array per key with one entry per
 * line; `instances` and then `entities` one per line. Params and overrides
 * are keyed in code-unit order; empty `params`, `assets`, `overrides`,
 * `bulk` and `instances` are left out, and `entities` is always written.
 */
export function formatPrefab(prefab: Prefab): string {
  const doc = prefab as Record<string, unknown>;
  const parts: string[][] = [];
  const rows = (indent: string, items: readonly unknown[]) =>
    items.flatMap((row, i) => {
      const text = rowLines(row, indent, "", 0);
      if (i < items.length - 1) text[text.length - 1] += ",";
      return text;
    });
  const keyed = (key: string) => {
    const value = doc[key];
    if (!isObject(value)) return;
    const ids = Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort(byCodeUnit);
    if (ids.length === 0) return;
    parts.push([
      `  ${JSON.stringify(key)}: {`,
      ...ids.map((id, i) => `    ${member(id, value[id])}${i < ids.length - 1 ? "," : ""}`),
      "  }",
    ]);
  };
  const list = (key: string, items: readonly unknown[] | undefined) => {
    if (items && items.length > 0)
      parts.push([`  ${JSON.stringify(key)}: [`, ...rows("    ", items), "  ]"]);
  };

  for (const key of PREFAB_INLINE_KEYS)
    if (doc[key] !== undefined) parts.push([`  ${JSON.stringify(key)}: ${inline(doc[key])}`]);
  keyed("params");
  if (Array.isArray(prefab.assets) && prefab.assets.length > 0)
    parts.push([`  "assets": ${inline(sortedAssets(prefab.assets))}`]);
  keyed("overrides");
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
  list("instances", prefab.instances);
  if (prefab.entities.length > 0) list("entities", prefab.entities);
  else parts.push(['  "entities": []']);
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

/**
 * A checks file in Yjs and on disk: checks keyed by id, merging per check and
 * field, so an inline `script` is replaced whole; `kind` after the id.
 */
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
