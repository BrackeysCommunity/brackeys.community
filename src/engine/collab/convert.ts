import * as Y from "yjs";

import type { Registry } from "../game/types";
import { cloneJson } from "../project/canonical";
import { isPlainObject } from "../project/kinds/define";
import { EMPTY_SCENE_TEMPLATE } from "../scene/create";
import { bulkEntries, bulkKeysOf, bulkKeyType } from "../scene/expand";
import { FRAGMENT_KIND, fragmentBounds } from "../scene/fragment";
import {
  PREFAB_KIND,
  RESERVED_SCENE_KEYS,
  type Bounds,
  type BulkEntry,
  type BulkKey,
  type EntityDef,
  type GroupDef,
  type InstanceDef,
  type Prefab,
  type PrefabLibrary,
  type SceneDefinition,
} from "../scene/types";
import { randomKey, type KeyGen } from "./keys";
import { sameValue as same } from "./log";
import { compareZ, initialZ } from "./order";
import {
  BULK_FIELD,
  COLLAB_LAYOUT_VERSION,
  DOC_MAPS,
  NESTED_FIELDS,
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
/** A prefab doc's header: `id` and `contract`. */
export const prefabHeaderMap = (doc: Y.Doc) => doc.getMap<unknown>(DOC_MAPS.prefab);

/** Every map that holds a scene's or a prefab's content: what undo, validation and bindings watch. */
export function contentMaps(doc: Y.Doc): Y.Map<unknown>[] {
  return [
    entitiesMap(doc),
    settingsMap(doc),
    sceneMap(doc),
    groupsMap(doc),
    instancesMap(doc),
    prefabHeaderMap(doc),
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
  typeof rec.bulk === "string" ? rec.bulk : ENTITIES_BUCKET;

// ─── Records ─────────────────────────────────────────────

/** An entity's `Y.Map` as plain JSON; values are copies. */
export function recordOf(map: Y.Map<unknown>): EntityRecord {
  const out: Record<string, unknown> = {};
  for (const [k, v] of map.entries()) out[k] = v instanceof Y.Map ? v.toJSON() : cloneJson(v);
  if (typeof out[Z_FIELD] !== "string") out[Z_FIELD] = "";
  return out as EntityRecord;
}

/** The record a named entity is stored as. */
export function entityRecord(def: EntityDef, z: string): EntityRecord {
  return { ...cloneJson(def), z } as EntityRecord;
}

/** The record a bulk entry is stored as: its key, its type and its one geometry field. */
export function bulkRecord(key: BulkKey, value: BulkEntry, z: string): EntityRecord {
  const field = Array.isArray(value) && typeof value[0] === "number" ? "at" : "shape";
  return { z, [BULK_FIELD]: key, type: bulkKeyType(key), [field]: cloneJson(value) };
}

function setField(map: Y.Map<unknown>, k: string, v: unknown): void {
  if (NESTED_FIELDS.includes(k) && isPlainObject(v)) {
    const nested = new Y.Map<unknown>();
    for (const [pk, pv] of Object.entries(v)) if (pv !== undefined) nested.set(pk, cloneJson(pv));
    map.set(k, nested);
  } else map.set(k, cloneJson(v));
}

/** A new `Y.Map` holding a record. */
export function recordMap(rec: EntityRecord): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(rec)) if (v !== undefined) setField(map, k, v);
  return map;
}

/**
 * Writes only what differs between two records into an entity's `Y.Map`,
 * so a concurrent edit to another field survives. `path` and `overrides`
 * are patched key by key; every other value is replaced whole.
 */
export function patchRecord(map: Y.Map<unknown>, prev: EntityRecord, next: EntityRecord): void {
  for (const k of Object.keys(prev)) if (next[k] === undefined) map.delete(k);
  for (const [k, v] of Object.entries(next)) {
    if (v === undefined || same(prev[k], v)) continue;
    const current = map.get(k);
    if (
      NESTED_FIELDS.includes(k) &&
      current instanceof Y.Map &&
      isPlainObject(v) &&
      isPlainObject(prev[k])
    ) {
      const before = prev[k] as Record<string, unknown>;
      for (const pk of Object.keys(before)) if (v[pk] === undefined) current.delete(pk);
      for (const [pk, pv] of Object.entries(v))
        if (pv !== undefined && !same(before[pk], pv)) current.set(pk, cloneJson(pv));
    } else setField(map, k, v);
  }
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
  /** A prefab doc's header. */
  prefab?: { id: string; contract?: unknown };
};

export type ReadDocOptions = {
  /** For a prefab doc: measures its children, so the synthesised bounds hold them all. */
  registry?: Registry;
  /** For a prefab doc: the scene size its bounds centre on the origin; default the empty scene's. */
  parentBounds?: Bounds;
};

/** Room around a prefab's children in the scene a prefab doc reads as. */
const PREFAB_MARGIN = 64;

/**
 * The bounds a prefab is edited in: `parent`'s size centred on the
 * prefab's origin, grown to hold its children (with a margin) when a
 * registry can measure them.
 */
export function prefabSceneBounds(
  prefab: Pick<Prefab, "v" | "entities" | "bulk">,
  parent: Bounds = EMPTY_SCENE_TEMPLATE.bounds as Bounds,
  registry?: Registry,
): Bounds {
  const w = parent[2] - parent[0];
  const h = parent[3] - parent[1];
  const out: Bounds = [-Math.floor(w / 2), -Math.floor(h / 2), Math.ceil(w / 2), Math.ceil(h / 2)];
  if (!registry) return out;
  const box = fragmentBounds(
    {
      kind: FRAGMENT_KIND,
      v: prefab.v,
      entities: prefab.entities,
      ...(prefab.bulk ? { bulk: prefab.bulk } : {}),
    },
    registry,
  );
  if (!box) return out;
  return [
    Math.min(out[0], Math.floor(box.minX) - PREFAB_MARGIN),
    Math.min(out[1], Math.floor(box.minY) - PREFAB_MARGIN),
    Math.max(out[2], Math.ceil(box.maxX) + PREFAB_MARGIN),
    Math.max(out[3], Math.ceil(box.maxY) + PREFAB_MARGIN),
  ];
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
    out[id] = { at: [at[0], at[1]], ...(typeof name === "string" ? { name } : {}) };
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
 * `sceneHash`. Entries sort by bucket, then `z`, then key; a record with
 * no geometry or no id can't be written to disk and is skipped. A prefab
 * doc reads as a scene of its children (`kind: "prefab"`), named after the
 * prefab, with bounds from `prefabSceneBounds` that are never written.
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
    list.push({ key, z: rec.z, rec });
  }

  const out: Record<string, unknown> = {};
  const schema = meta.get("$schema");
  if (typeof schema === "string" && !prefab) out.$schema = schema;
  out.v = meta.get("schemaVersion");
  const game = meta.get("game");
  if (typeof game === "string") out.game = game;
  const header = prefab ? readPrefabHeader(doc) : undefined;
  if (header) out.name = header.id;
  else for (const [k, v] of scene.entries()) out[k] = cloneJson(v);
  if (!prefab && settingsMap(doc).size > 0) out.settings = settingsMap(doc).toJSON();
  const groups = prefab ? undefined : readGroups(doc);
  if (groups) out.groups = groups;

  const instanceRecords = new Map<string, EntityRecord>();
  const instanceList: { key: string; z: string; rec: EntityRecord }[] = [];
  for (const [key, map] of prefab ? [] : instancesMap(doc).entries()) {
    if (!(map instanceof Y.Map)) continue;
    const rec = recordOf(map);
    instanceRecords.set(key, rec);
    instanceList.push({ key, z: rec.z, rec });
  }
  const instanceKeys: string[] = [];
  const instances: InstanceDef[] = [];
  for (const { key, rec } of instanceList.sort(compareZ)) {
    if (typeof rec.id !== "string" || typeof rec.prefab !== "string" || !Array.isArray(rec.at))
      continue;
    const { z: _z, ...fields } = rec;
    instances.push(fields as unknown as InstanceDef);
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
        const { z: _z, ...fields } = rec;
        entities.push(fields as EntityDef);
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
      },
      opts.parentBounds,
      opts.registry,
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

/** A prefab doc's `id` and `contract`; the id is "" before the header is written. */
function readPrefabHeader(doc: Y.Doc): { id: string; contract?: unknown } {
  const map = prefabHeaderMap(doc);
  const id = map.get("id");
  const contract = map.get("contract");
  return {
    id: typeof id === "string" ? id : "",
    ...(contract !== undefined ? { contract: cloneJson(contract) } : {}),
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
  return { ...cloneJson(def), z } as unknown as EntityRecord;
}

/** A new `Y.Map` holding a group. */
export function groupMap(group: GroupDef): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  map.set("at", cloneJson(group.at));
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
      if (k === "settings" || k === "entities" || k === "groups" || k === "instances") continue;
      if (!RESERVED_SCENE_KEYS.includes(k) && Array.isArray(v)) continue;
      scene.set(k, cloneJson(v));
    }
    const settings = settingsMap(doc);
    for (const [k, v] of Object.entries(def.settings ?? {}))
      if (v !== undefined) settings.set(k, cloneJson(v));

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
