import * as Y from "yjs";

import type { Registry } from "../game/types";
import { cloneJson } from "../project/canonical";
import { isPlainObject } from "../project/kinds/define";
import { EMPTY_SCENE_TEMPLATE } from "../scene/create";
import { bulkEntries, bulkKeysOf, bulkKeyType } from "../scene/expand";
import { FRAGMENT_KIND, fragmentBounds } from "../scene/fragment";
import { canonicalGrid, isGridValue, GRID_CHUNK, type GridCells } from "../scene/grid";
import {
  PREFAB_KIND,
  RESERVED_SCENE_KEYS,
  type AssetId,
  type Bounds,
  type BulkEntry,
  type BulkKey,
  type EntityDef,
  type GroupDef,
  type InstanceDef,
  type OverridePath,
  type Prefab,
  type PrefabLibrary,
  type PrefabParam,
  type SceneDefinition,
} from "../scene/types";
import { randomKey, type KeyGen } from "./keys";
import { sameValue as same } from "./log";
import { compareZ, initialZ } from "./order";
import {
  BEHAVIORS_FIELD,
  BULK_FIELD,
  COLLAB_LAYOUT_VERSION,
  DOC_MAPS,
  GRID_ROW_KEY,
  NESTED2_FIELDS,
  NESTED_FIELDS,
  OVERRIDES_FIELD,
  PARAMS_FIELD,
  Z_FIELD,
  type EntityRecord,
  type SceneDocMeta,
} from "./types";

/** Header keys `meta` holds; `scene` holds the rest of the header. */
const META_HEADER = ["$schema", "v", "game"] as const;
/** The bucket a named entity is written to. */
export const ENTITIES_BUCKET = "entities";

export const entitiesMap = (doc: Y.Doc) => doc.getMap<Y.Map<unknown>>(DOC_MAPS.entities);
export const settingsMap = (doc: Y.Doc) => doc.getMap<unknown>(DOC_MAPS.settings);
export const sceneMap = (doc: Y.Doc) => doc.getMap<unknown>(DOC_MAPS.scene);
export const metaMap = (doc: Y.Doc) => doc.getMap<unknown>(DOC_MAPS.meta);
export const groupsMap = (doc: Y.Doc) => doc.getMap<Y.Map<unknown>>(DOC_MAPS.groups);
export const instancesMap = (doc: Y.Doc) => doc.getMap<Y.Map<unknown>>(DOC_MAPS.instances);
/** Layout 1's prefabs, which `migrateLayout` moves into prefab docs; layout 2 never writes it. */
export const prefabsMap = (doc: Y.Doc) => doc.getMap<unknown>(DOC_MAPS.prefabs);
/** A prefab doc's header: `id`, `base` and `contract`. */
export const prefabHeaderMap = (doc: Y.Doc) => doc.getMap<unknown>(DOC_MAPS.prefab);
/** The `assets` header as a set: AssetId → true. */
export const assetsMap = (doc: Y.Doc) => doc.getMap<unknown>(DOC_MAPS.assets);
/** A prefab doc's exposed parameters: name → PrefabParam. */
export const paramsMap = (doc: Y.Doc) => doc.getMap<unknown>(DOC_MAPS.params);
/** A prefab doc's variant overrides: override path → value. */
export const prefabOverridesMap = (doc: Y.Doc) => doc.getMap<unknown>(DOC_MAPS.overrides);

/**
 * Every map that holds a scene's or a prefab's content: what undo,
 * validation and bindings watch. The prefab doc's `params` and `overrides`
 * are included for every doc (they stay empty on a scene's), so a binding
 * made before the doc has synced still watches them.
 */
export function contentMaps(doc: Y.Doc): Y.Map<unknown>[] {
  return [
    entitiesMap(doc),
    settingsMap(doc),
    sceneMap(doc),
    assetsMap(doc),
    groupsMap(doc),
    instancesMap(doc),
    prefabHeaderMap(doc),
    paramsMap(doc),
    prefabOverridesMap(doc),
  ] as Y.Map<unknown>[];
}

/** Whether a doc holds a prefab rather than a scene. */
export const isPrefabDoc = (doc: Y.Doc) => metaMap(doc).get("kind") === PREFAB_KIND;

/** Whether a transaction changed any of `maps` or anything inside them. */
export function touchesMaps(tr: Y.Transaction, maps: readonly Y.Map<unknown>[]): boolean {
  return maps.some((t) => tr.changedParentTypes.has(t as never) || tr.changed.has(t as never));
}

/** The bulk key a record is written under, or `entities` for a named entity. */
export const bucketOf = (rec: EntityRecord): string =>
  typeof rec[BULK_FIELD] === "string" ? rec[BULK_FIELD] : ENTITIES_BUCKET;

/** Whether a record key belongs to the layout (`@z`, `@bulk`) rather than to the record's fields. */
export const isLayoutKey = (key: string): boolean => key.startsWith("@");

/** A record's fields: everything but the layout's own keys. */
export function recordFields(rec: EntityRecord): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rec)) if (!isLayoutKey(k)) out[k] = v;
  return out;
}

// ─── Records ─────────────────────────────────────────────

/** The doc key of one grid row. */
export const gridRowKey = (field: string, chunk: string, row: number): string =>
  `${field}@${chunk}/${row}`;

/**
 * A grid value's rows as doc keys, or null when it can't be written as
 * rows (a chunk past 32 rows, or no row with cells) and is kept whole.
 */
function gridRows(field: string, grid: GridCells): [string, string][] | null {
  const out: [string, string][] = [];
  for (const [chunk, rows] of Object.entries(grid)) {
    if (rows.length > GRID_CHUNK) return null;
    rows.forEach((row, r) => {
      if (row !== "") out.push([gridRowKey(field, chunk, r), row]);
    });
  }
  return out.length > 0 ? out : null;
}

const isNested = (k: string) => NESTED_FIELDS.includes(k) || NESTED2_FIELDS.includes(k);

/**
 * The nested maps a record keeps even while empty, so two clients adding
 * a record's first behavior (an instance's first param or override)
 * write into the same `Y.Map` and both land: a named entity's
 * `behaviors`, an instance's `params` and `overrides`. An empty one
 * reads as absent.
 */
function keptMaps(rec: Record<string, unknown>): readonly string[] {
  if (rec[BULK_FIELD] !== undefined) return [];
  if (typeof rec.type === "string") return [BEHAVIORS_FIELD];
  if (typeof rec.prefab === "string") return [PARAMS_FIELD, OVERRIDES_FIELD];
  return [];
}

/** A field written as grid rows: every top-level field but the nested ones, the layout's keys and empty grids. */
function rowsOf(k: string, v: unknown): [string, string][] | null {
  if (isLayoutKey(k) || isNested(k) || !isGridValue(v)) return null;
  return gridRows(k, v);
}

/** Row keys gathered into their grids: canonical when they decode, else as written, for validation to report. */
function gatherRows(rows: Map<string, Map<string, string[]>>, out: Record<string, unknown>): void {
  for (const [field, chunks] of rows) {
    const grid: Record<string, string[]> = {};
    for (const [chunk, list] of chunks) grid[chunk] = Array.from(list, (r) => r ?? "");
    try {
      out[field] = canonicalGrid(grid);
    } catch {
      out[field] = grid;
    }
  }
}

/** A record's `Y.Map` as plain JSON, grid rows gathered into their fields; values are copies. */
export function recordOf(map: Y.Map<unknown>): EntityRecord {
  const out: Record<string, unknown> = {};
  const rows = new Map<string, Map<string, string[]>>();
  for (const [k, v] of map.entries()) {
    const m = !isLayoutKey(k) && k.includes("@") ? GRID_ROW_KEY.exec(k) : null;
    if (m && typeof v === "string") {
      const [, field, cx, cy, r] = m as unknown as [string, string, string, string, string];
      let chunks = rows.get(field);
      if (!chunks) rows.set(field, (chunks = new Map()));
      const chunk = `${cx},${cy}`;
      let list = chunks.get(chunk);
      if (!list) chunks.set(chunk, (list = []));
      list[Number(r)] = v;
      continue;
    }
    if (v instanceof Y.Map) {
      if (v.size > 0 || !isNested(k)) out[k] = v.toJSON();
    } else out[k] = cloneJson(v);
  }
  gatherRows(rows, out);
  if (typeof out[Z_FIELD] !== "string") out[Z_FIELD] = "";
  return out as EntityRecord;
}

/** The record a named entity is stored as. */
export function entityRecord(def: EntityDef, z: string): EntityRecord {
  return { ...cloneJson(def), [Z_FIELD]: z } as EntityRecord;
}

/** The record a bulk entry is stored as: its key, its type and its one geometry field. */
export function bulkRecord(key: BulkKey, value: BulkEntry, z: string): EntityRecord {
  const field = Array.isArray(value) && typeof value[0] === "number" ? "at" : "shape";
  return { [Z_FIELD]: z, [BULK_FIELD]: key, type: bulkKeyType(key), [field]: cloneJson(value) };
}

/** A nested field's value as a `Y.Map`; two levels for behaviors, a level whose value isn't an object kept atomic. */
function nestedMap(k: string, v: Record<string, unknown>): Y.Map<unknown> {
  const nested = new Y.Map<unknown>();
  const deep = NESTED2_FIELDS.includes(k);
  for (const [pk, pv] of Object.entries(v)) {
    if (pv === undefined) continue;
    nested.set(pk, deep && isPlainObject(pv) ? plainMap(pv) : cloneJson(pv));
  }
  return nested;
}

function plainMap(v: Record<string, unknown>): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  for (const [k, x] of Object.entries(v)) if (x !== undefined) map.set(k, cloneJson(x));
  return map;
}

function setField(map: Y.Map<unknown>, k: string, v: unknown): void {
  if (isNested(k) && isPlainObject(v)) map.set(k, nestedMap(k, v));
  else map.set(k, cloneJson(v));
}

/** A new `Y.Map` holding a record. */
export function recordMap(rec: EntityRecord): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(rec)) {
    if (v === undefined) continue;
    const rows = rowsOf(k, v);
    if (rows) for (const [rk, row] of rows) map.set(rk, row);
    else setField(map, k, v);
  }
  for (const k of keptMaps(rec)) if (rec[k] === undefined) map.set(k, new Y.Map<unknown>());
  return map;
}

/** A record as its doc keys: grid fields as their rows, every other field under its own name. */
function docEntries(rec: EntityRecord): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const [k, v] of Object.entries(rec)) {
    if (v === undefined) continue;
    const rows = rowsOf(k, v);
    if (rows) for (const [rk, row] of rows) out.set(rk, row);
    else out.set(k, v);
  }
  return out;
}

/** Writes what differs between two plain objects into a nested map, key by key. */
function patchPlain(
  map: Y.Map<unknown>,
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
) {
  for (const k of Object.keys(prev)) if (next[k] === undefined) map.delete(k);
  for (const [k, v] of Object.entries(next))
    if (v !== undefined && !same(prev[k], v)) map.set(k, cloneJson(v));
}

/**
 * Writes only what differs between two records into a record's `Y.Map`, so
 * a concurrent edit to another field survives. `path`, `overrides` and
 * `params` are patched key by key, `behaviors` block by block and then
 * field by field, and a grid field row by row; every other value is
 * replaced whole. Removing a behavior deletes its block, so it wins over a
 * concurrent edit inside it. A record's kept maps (`keptMaps`) are emptied
 * rather than deleted and filled from empty in place, so concurrent first
 * writes merge; a record written before they existed gets one on its
 * first write, and two clients making that write at once keep only one.
 */
export function patchRecord(map: Y.Map<unknown>, prev: EntityRecord, next: EntityRecord): void {
  const before = docEntries(prev);
  const after = docEntries(next);
  const kept = keptMaps(next);
  for (const k of before.keys()) {
    if (after.has(k)) continue;
    const current = map.get(k);
    if (kept.includes(k) && current instanceof Y.Map)
      for (const name of [...current.keys()]) current.delete(name);
    else map.delete(k);
  }
  for (const [k, v] of after) {
    const current = map.get(k);
    const old = before.get(k) ?? (kept.includes(k) && current instanceof Y.Map ? {} : undefined);
    if (same(old, v)) continue;
    if (!(isNested(k) && current instanceof Y.Map && isPlainObject(v) && isPlainObject(old))) {
      setField(map, k, v);
      continue;
    }
    if (!NESTED2_FIELDS.includes(k)) {
      patchPlain(current, old, v);
      continue;
    }
    for (const name of Object.keys(old)) if (v[name] === undefined) current.delete(name);
    for (const [name, block] of Object.entries(v)) {
      const was = old[name];
      if (block === undefined || same(was, block)) continue;
      const inner = current.get(name);
      if (inner instanceof Y.Map && isPlainObject(block) && isPlainObject(was))
        patchPlain(inner, was, block);
      else current.set(name, isPlainObject(block) ? plainMap(block) : cloneJson(block));
    }
  }
}

/** Brings an atomic-valued map to `next`: removes keys it lacks, writes the ones that differ. */
export function patchMap(map: Y.Map<unknown>, next: Readonly<Record<string, unknown>>): void {
  for (const k of [...map.keys()]) if (next[k] === undefined) map.delete(k);
  for (const [k, v] of Object.entries(next))
    if (v !== undefined && !same(map.get(k), v)) map.set(k, cloneJson(v));
}

/** The doc's `assets` header: its ids, sorted. */
export function readAssets(doc: Y.Doc): AssetId[] {
  return [...assetsMap(doc).entries()]
    .filter(([, v]) => v === true)
    .map(([id]) => id)
    .sort();
}

/** Brings the doc's `assets` set to `ids`, adding and removing ids one by one so concurrent changes merge. */
export function writeAssets(doc: Y.Doc, ids: readonly AssetId[]): void {
  patchMap(assetsMap(doc), Object.fromEntries(ids.map((id) => [id, true])));
}

// ─── Doc to scene ────────────────────────────────────────

/** A doc read as a scene, with the key behind each entry. */
export type DocView = {
  /** "prefab" for a prefab doc, read as a scene of its children: its name is the prefab's id, its bounds synthesised. */
  kind: "scene" | "prefab";
  def: SceneDefinition;
  /** The key of each of `def.entities`, in order. */
  entityKeys: string[];
  /** The keys of each bulk array's entries, in order. */
  bulkKeys: Map<BulkKey, string[]>;
  records: Map<string, EntityRecord>;
  /** The key of each of `def.instances`, in order. */
  instanceKeys: string[];
  instanceRecords: Map<string, EntityRecord>;
  /** A prefab doc's header, parameters and variant overrides; its instances and assets are in `def`. */
  prefab?: PrefabDocHeader;
};

/** What a prefab doc holds besides its children. */
export type PrefabDocHeader = {
  id: string;
  base?: string;
  contract?: unknown;
  params?: Record<string, PrefabParam>;
  overrides?: Record<OverridePath, unknown>;
};

export type ReadDocOptions = {
  /** For a prefab doc: measures its children, so the synthesised bounds hold them all. */
  registry?: Registry;
  /** For a prefab doc: the scene size its bounds centre on the origin; default the empty scene's. */
  parentBounds?: Bounds;
  /** For a prefab doc, with `registry`: the prefabs its nested instances name, so the bounds hold their children too. */
  prefabs?: PrefabLibrary;
};

/** Room around a prefab's children in the scene a prefab doc reads as. */
const PREFAB_MARGIN = 64;

/**
 * The bounds a prefab is edited in: `parent`'s size centred on the
 * prefab's origin, grown to hold its children (with a margin) when a
 * registry can measure them, and its nested instances' origins; with
 * `prefabs` as well, the nested instances' resolved children.
 */
export function prefabSceneBounds(
  prefab: Pick<Prefab, "v" | "entities" | "bulk" | "instances">,
  parent: Bounds = EMPTY_SCENE_TEMPLATE.bounds as Bounds,
  registry?: Registry,
  prefabs?: PrefabLibrary,
): Bounds {
  const w = parent[2] - parent[0];
  const h = parent[3] - parent[1];
  const out: Bounds = [-Math.floor(w / 2), -Math.floor(h / 2), Math.ceil(w / 2), Math.ceil(h / 2)];
  const grow = (minX: number, minY: number, maxX: number, maxY: number) => {
    out[0] = Math.min(out[0], Math.floor(minX) - PREFAB_MARGIN);
    out[1] = Math.min(out[1], Math.floor(minY) - PREFAB_MARGIN);
    out[2] = Math.max(out[2], Math.ceil(maxX) + PREFAB_MARGIN);
    out[3] = Math.max(out[3], Math.ceil(maxY) + PREFAB_MARGIN);
  };
  for (const inst of prefab.instances ?? []) {
    const [x, y] = inst.at;
    if (Number.isFinite(x) && Number.isFinite(y)) grow(x, y, x, y);
  }
  if (!registry) return out;
  const box = fragmentBounds(
    {
      kind: FRAGMENT_KIND,
      v: prefab.v,
      entities: prefab.entities,
      ...(prefab.bulk ? { bulk: prefab.bulk } : {}),
      ...(prefab.instances?.length ? { instances: prefab.instances } : {}),
    },
    registry,
    prefabs,
  );
  if (box) grow(box.minX, box.minY, box.maxX, box.maxY);
  return out;
}

/** The doc's groups by id; one without a usable `at` is skipped. */
function readGroups(doc: Y.Doc): Record<string, GroupDef> | undefined {
  const out: Record<string, GroupDef> = {};
  for (const id of [...groupsMap(doc).keys()].sort()) {
    const map = groupsMap(doc).get(id);
    if (!(map instanceof Y.Map)) continue;
    const at = map.get("at");
    if (!Array.isArray(at) || at.length !== 2) continue;
    const name = map.get("name");
    const rot = map.get("rot");
    const flip = map.get("flip");
    out[id] = {
      at: [at[0], at[1]],
      ...(rot === 1 || rot === 2 || rot === 3 ? { rot } : {}),
      ...(flip === true ? { flip } : {}),
      ...(typeof name === "string" ? { name } : {}),
    };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** The prefabs a layout-1 doc holds in its `prefabs` map, by id; empty for layout 2. */
export function docPrefabs(doc: Y.Doc): PrefabLibrary {
  const out = new Map<string, Prefab>();
  for (const id of [...prefabsMap(doc).keys()].sort()) {
    const p = prefabsMap(doc).get(id);
    if (isPlainObject(p) && Array.isArray(p.entities)) out.set(id, cloneJson(p) as Prefab);
  }
  return out;
}

/**
 * Reads a doc. Deterministic: two docs holding the same state give the same
 * definition, so converged clients agree on `formatScene` text and
 * `sceneHash`. Entries sort by bucket, then `@z`, then key; a record with
 * no geometry or no id can't be written to disk and is skipped. Grid
 * fields come back from their rows, canonical, and only the layout's
 * `@`-keys are dropped. A prefab doc reads as a scene of its children and
 * instances (`kind: "prefab"`), named after the prefab, with bounds from
 * `prefabSceneBounds` that are never written; its base, params and
 * overrides are in `prefab`. Those bounds hold nested instances' children
 * when `prefabs` is given, so an edit to a nested prefab can change a
 * prefab doc's `sceneHash`: every reader that hashes a prefab doc passes
 * the same library, and a base taken before such an edit is stale.
 */
export function readDoc(doc: Y.Doc, opts: ReadDocOptions = {}): DocView {
  const meta = metaMap(doc);
  const scene = sceneMap(doc);
  const prefab = isPrefabDoc(doc);
  const records = new Map<string, EntityRecord>();
  const buckets = new Map<string, { key: string; z: string; rec: EntityRecord }[]>();
  for (const [key, map] of entitiesMap(doc).entries()) {
    if (!(map instanceof Y.Map)) continue;
    const rec = recordOf(map);
    records.set(key, rec);
    const bucket = bucketOf(rec);
    let list = buckets.get(bucket);
    if (!list) buckets.set(bucket, (list = []));
    list.push({ key, z: rec[Z_FIELD], rec });
  }

  const out: Record<string, unknown> = {};
  const schema = meta.get("$schema");
  if (typeof schema === "string" && !prefab) out.$schema = schema;
  out.v = meta.get("schemaVersion");
  const game = meta.get("game");
  if (typeof game === "string") out.game = game;
  const header = prefab ? readPrefabHeader(doc) : undefined;
  if (header) out.name = header.id;
  else for (const [k, v] of scene.entries()) if (k !== "assets") out[k] = cloneJson(v);
  if (!prefab && settingsMap(doc).size > 0) out.settings = settingsMap(doc).toJSON();
  const assets = readAssets(doc);
  if (assets.length > 0) out.assets = assets;
  const groups = prefab ? undefined : readGroups(doc);
  if (groups) out.groups = groups;

  const instanceRecords = new Map<string, EntityRecord>();
  const instanceList: { key: string; z: string; rec: EntityRecord }[] = [];
  for (const [key, map] of instancesMap(doc).entries()) {
    if (!(map instanceof Y.Map)) continue;
    const rec = recordOf(map);
    instanceRecords.set(key, rec);
    instanceList.push({ key, z: rec[Z_FIELD], rec });
  }
  const instanceKeys: string[] = [];
  const instances: InstanceDef[] = [];
  for (const { key, rec } of instanceList.sort(compareZ)) {
    if (typeof rec.id !== "string" || typeof rec.prefab !== "string" || !Array.isArray(rec.at))
      continue;
    instances.push(recordFields(rec) as unknown as InstanceDef);
    instanceKeys.push(key);
  }
  if (instances.length > 0) out.instances = instances;

  const entityKeys: string[] = [];
  const bulkKeys = new Map<BulkKey, string[]>();
  const names = [...buckets.keys()].sort();
  for (const bucket of names) {
    const list = buckets.get(bucket)!.sort(compareZ);
    if (bucket === ENTITIES_BUCKET) {
      const entities: EntityDef[] = [];
      for (const { key, rec } of list) {
        if (typeof rec.id !== "string") continue;
        entities.push(recordFields(rec) as EntityDef);
        entityKeys.push(key);
      }
      if (entities.length > 0) out.entities = entities;
      continue;
    }
    const values: BulkEntry[] = [];
    const keys: string[] = [];
    for (const { key, rec } of list) {
      const value = rec.shape ?? rec.at;
      if (!Array.isArray(value)) continue;
      values.push(value as BulkEntry);
      keys.push(key);
    }
    if (values.length > 0) {
      out[bucket] = values;
      bulkKeys.set(bucket, keys);
    }
  }
  if (header) {
    const bulk: Record<BulkKey, BulkEntry[]> = {};
    for (const k of bulkKeys.keys()) bulk[k] = out[k] as BulkEntry[];
    out.bounds = prefabSceneBounds(
      {
        v: typeof out.v === "number" ? out.v : 0,
        entities: (out.entities as EntityDef[] | undefined) ?? [],
        ...(bulkKeys.size > 0 ? { bulk } : {}),
        ...(instances.length > 0 ? { instances } : {}),
      },
      opts.parentBounds,
      opts.registry,
      opts.prefabs,
    );
  }
  return {
    kind: header ? "prefab" : "scene",
    def: out as SceneDefinition,
    entityKeys,
    bulkKeys,
    records,
    instanceKeys,
    instanceRecords,
    ...(header ? { prefab: header } : {}),
  };
}

/** A prefab doc's header, params and overrides; the id is "" before the header is written. */
function readPrefabHeader(doc: Y.Doc): PrefabDocHeader {
  const map = prefabHeaderMap(doc);
  const id = map.get("id");
  const base = map.get("base");
  const contract = map.get("contract");
  const params: Record<string, PrefabParam> = {};
  for (const name of [...paramsMap(doc).keys()].sort()) {
    const p = paramsMap(doc).get(name);
    if (isPlainObject(p)) params[name] = cloneJson(p) as PrefabParam;
  }
  const overrides: Record<OverridePath, unknown> = {};
  for (const path of [...prefabOverridesMap(doc).keys()].sort()) {
    const v = prefabOverridesMap(doc).get(path);
    if (v !== undefined) overrides[path] = cloneJson(v);
  }
  return {
    id: typeof id === "string" ? id : "",
    ...(typeof base === "string" ? { base } : {}),
    ...(contract !== undefined ? { contract: cloneJson(contract) } : {}),
    ...(Object.keys(params).length > 0 ? { params } : {}),
    ...(Object.keys(overrides).length > 0 ? { overrides } : {}),
  };
}

/** The scene a doc holds. Pass the result to `formatScene` for its canonical text. */
export function docToScene(doc: Y.Doc): SceneDefinition {
  return readDoc(doc).def;
}

/** What `meta` says about a doc, or null before it has been seeded. */
export function docMeta(doc: Y.Doc): SceneDocMeta | null {
  const meta = metaMap(doc);
  const v = meta.get("schemaVersion");
  if (typeof v !== "number") return null;
  const out: SceneDocMeta = { schemaVersion: v };
  const layout = meta.get("layout");
  if (typeof layout === "number") out.layout = layout;
  for (const k of ["kind", "game", "$schema", "project", "key"] as const) {
    const value = meta.get(k);
    if (typeof value === "string") out[k] = value;
  }
  return out;
}

/** The collab layout a seeded doc holds: `meta.layout`, else 1. */
export function docLayout(doc: Y.Doc): number {
  const layout = metaMap(doc).get("layout");
  return typeof layout === "number" ? layout : 1;
}

/** Writes the seeder's `meta` for a doc of this engine's layout. Call inside the seeding transaction. */
export function seedDocMeta(
  doc: Y.Doc,
  meta: Omit<SceneDocMeta, "layout"> & { kind?: string },
): void {
  const map = metaMap(doc);
  if (meta.kind !== undefined) map.set("kind", meta.kind);
  map.set("schemaVersion", meta.schemaVersion);
  map.set("layout", COLLAB_LAYOUT_VERSION);
  for (const k of ["game", "$schema", "project", "key"] as const) {
    const value = meta[k];
    if (typeof value === "string") map.set(k, value);
  }
}

// ─── Scene to doc ────────────────────────────────────────

export type SceneToDocOptions = {
  /** Fill this doc instead of a new one; it must be empty. */
  doc?: Y.Doc;
  key?: KeyGen;
  /** The transaction origin of the seeding write. */
  origin?: unknown;
  /** Written to `meta`: the project and registry key the doc belongs to. */
  project?: string;
  assetKey?: string;
};

/** The record an instance is stored as. */
export function instanceRecord(def: InstanceDef, z: string): EntityRecord {
  return { ...cloneJson(def), [Z_FIELD]: z } as unknown as EntityRecord;
}

/** A new `Y.Map` holding a group. */
export function groupMap(group: GroupDef): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  map.set("at", cloneJson(group.at));
  if (group.rot !== undefined) map.set("rot", group.rot);
  if (group.flip !== undefined) map.set("flip", group.flip);
  if (group.name !== undefined) map.set("name", group.name);
  return map;
}

/**
 * Seeds a doc with a scene, in one transaction, at this engine's layout.
 * The scene's prefabs are docs of their own (`prefabToDoc`). Only a server
 * seeds: two clients seeding one document on their own would duplicate
 * every entity.
 */
export function sceneToDoc(def: SceneDefinition, opts: SceneToDocOptions = {}): Y.Doc {
  const doc = opts.doc ?? new Y.Doc();
  const key = opts.key ?? randomKey;
  if (entitiesMap(doc).size > 0 || docMeta(doc)) throw new Error("sceneToDoc: the doc isn't empty");
  doc.transact(() => {
    const scene = sceneMap(doc);
    const top = def as Record<string, unknown>;
    seedDocMeta(doc, {
      schemaVersion: def.v,
      ...(typeof top.game === "string" ? { game: top.game } : {}),
      ...(typeof top.$schema === "string" ? { $schema: top.$schema } : {}),
      ...(opts.project !== undefined ? { project: opts.project } : {}),
      ...(opts.assetKey !== undefined ? { key: opts.assetKey } : {}),
    });
    for (const [k, v] of Object.entries(top)) {
      if (v === undefined || (META_HEADER as readonly string[]).includes(k)) continue;
      if (["settings", "assets", "entities", "groups", "instances"].includes(k)) continue;
      if (!RESERVED_SCENE_KEYS.includes(k) && Array.isArray(v)) continue;
      scene.set(k, cloneJson(v));
    }
    const settings = settingsMap(doc);
    for (const [k, v] of Object.entries(def.settings ?? {}))
      if (v !== undefined) settings.set(k, cloneJson(v));
    writeAssets(doc, def.assets ?? []);

    seedEntities(
      doc,
      {
        ...(def.entities ? { entities: def.entities } : {}),
        bulk: bulkKeysOf(def).map(
          (bulk) => [bulk, bulkEntries(def, bulk)] as [BulkKey, BulkEntry[]],
        ),
      },
      key,
    );

    for (const [id, group] of Object.entries(def.groups ?? {}))
      groupsMap(doc).set(id, groupMap(group));
    const placed = def.instances ?? [];
    const izs = initialZ(placed.length);
    placed.forEach((inst, i) =>
      instancesMap(doc).set(key(), recordMap(instanceRecord(inst, izs[i]!))),
    );
  }, opts.origin);
  return doc;
}

/** Writes a scene's or prefab's entities and bulk entries as new records: bulk keys first, then named. */
export function seedEntities(
  doc: Y.Doc,
  parts: { entities?: readonly EntityDef[]; bulk: Iterable<[BulkKey, readonly BulkEntry[]]> },
  key: KeyGen,
): void {
  const entities = entitiesMap(doc);
  for (const [bulk, values] of parts.bulk) {
    const zs = initialZ(values.length);
    values.forEach((value, i) => entities.set(key(), recordMap(bulkRecord(bulk, value, zs[i]!))));
  }
  const named = parts.entities ?? [];
  const zs = initialZ(named.length);
  named.forEach((e, i) => entities.set(key(), recordMap(entityRecord(e, zs[i]!))));
}
