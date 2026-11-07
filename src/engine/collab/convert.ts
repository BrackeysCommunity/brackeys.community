import * as Y from "yjs";

import { bulkEntries, bulkKeysOf, bulkKeyType } from "../scene/expand";
import {
  RESERVED_SCENE_KEYS,
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

const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));
const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

export const entitiesMap = (doc: Y.Doc) => doc.getMap<Y.Map<unknown>>(DOC_MAPS.entities);
export const settingsMap = (doc: Y.Doc) => doc.getMap<unknown>(DOC_MAPS.settings);
export const sceneMap = (doc: Y.Doc) => doc.getMap<unknown>(DOC_MAPS.scene);
export const metaMap = (doc: Y.Doc) => doc.getMap<unknown>(DOC_MAPS.meta);
export const groupsMap = (doc: Y.Doc) => doc.getMap<Y.Map<unknown>>(DOC_MAPS.groups);
export const instancesMap = (doc: Y.Doc) => doc.getMap<Y.Map<unknown>>(DOC_MAPS.instances);
export const prefabsMap = (doc: Y.Doc) => doc.getMap<unknown>(DOC_MAPS.prefabs);

/** Every map that holds the scene or its prefabs: what undo, validation and bindings watch. */
export function contentMaps(doc: Y.Doc): Y.Map<unknown>[] {
  return [
    entitiesMap(doc),
    settingsMap(doc),
    sceneMap(doc),
    groupsMap(doc),
    instancesMap(doc),
    prefabsMap(doc),
  ] as Y.Map<unknown>[];
}

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
  for (const [k, v] of map.entries()) out[k] = v instanceof Y.Map ? v.toJSON() : clone(v);
  if (typeof out[Z_FIELD] !== "string") out[Z_FIELD] = "";
  return out as EntityRecord;
}

/** The record a named entity is stored as. */
export function entityRecord(def: EntityDef, z: string): EntityRecord {
  return { ...clone(def), z } as EntityRecord;
}

/** The record a bulk entry is stored as: its key, its type and its one geometry field. */
export function bulkRecord(key: BulkKey, value: BulkEntry, z: string): EntityRecord {
  const field = Array.isArray(value) && typeof value[0] === "number" ? "at" : "shape";
  return { z, [BULK_FIELD]: key, type: bulkKeyType(key), [field]: clone(value) };
}

function setField(map: Y.Map<unknown>, k: string, v: unknown): void {
  if (NESTED_FIELDS.includes(k) && isPlainObject(v)) {
    const nested = new Y.Map<unknown>();
    for (const [pk, pv] of Object.entries(v)) if (pv !== undefined) nested.set(pk, clone(pv));
    map.set(k, nested);
  } else map.set(k, clone(v));
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
        if (pv !== undefined && !same(before[pk], pv)) current.set(pk, clone(pv));
    } else setField(map, k, v);
  }
}

// ─── Doc to scene ────────────────────────────────────────

/** A doc read as a scene, with the key behind each entry. */
export type DocView = {
  def: SceneDefinition;
  /** The key of each of `def.entities`, in order. */
  entityKeys: string[];
  /** The keys of each bulk array's entries, in order. */
  bulkKeys: Map<BulkKey, string[]>;
  records: Map<string, EntityRecord>;
  /** The key of each of `def.instances`, in order. */
  instanceKeys: string[];
  instanceRecords: Map<string, EntityRecord>;
  /** The prefabs the doc holds. */
  prefabs: PrefabLibrary;
};

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

/** The prefabs a doc holds, by id. */
export function docPrefabs(doc: Y.Doc): PrefabLibrary {
  const out = new Map<string, Prefab>();
  for (const id of [...prefabsMap(doc).keys()].sort()) {
    const p = prefabsMap(doc).get(id);
    if (isPlainObject(p) && Array.isArray(p.entities)) out.set(id, clone(p) as Prefab);
  }
  return out;
}

/**
 * Reads a doc. Deterministic: two docs holding the same state give the same
 * definition, so converged clients agree on `formatScene` text and
 * `sceneHash`. Entries sort by bucket, then `z`, then key; a record with
 * no geometry or no id can't be written to disk and is skipped.
 */
export function readDoc(doc: Y.Doc): DocView {
  const meta = metaMap(doc);
  const scene = sceneMap(doc);
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
  if (typeof schema === "string") out.$schema = schema;
  out.v = meta.get("schemaVersion");
  const game = meta.get("game");
  if (typeof game === "string") out.game = game;
  for (const [k, v] of scene.entries()) out[k] = clone(v);
  if (settingsMap(doc).size > 0) out.settings = settingsMap(doc).toJSON();
  const groups = readGroups(doc);
  if (groups) out.groups = groups;

  const instanceRecords = new Map<string, EntityRecord>();
  const instanceList: { key: string; z: string; rec: EntityRecord }[] = [];
  for (const [key, map] of instancesMap(doc).entries()) {
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
  return {
    def: out as SceneDefinition,
    entityKeys,
    bulkKeys,
    records,
    instanceKeys,
    instanceRecords,
    prefabs: docPrefabs(doc),
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
  const game = meta.get("game");
  if (typeof game === "string") out.game = game;
  const schema = meta.get("$schema");
  if (typeof schema === "string") out.$schema = schema;
  return out;
}

// ─── Scene to doc ────────────────────────────────────────

export type SceneToDocOptions = {
  /** Fill this doc instead of a new one; it must be empty. */
  doc?: Y.Doc;
  key?: KeyGen;
  /** The transaction origin of the seeding write. */
  origin?: unknown;
  /** The prefabs to hold beside the scene: the ones its home has. */
  prefabs?: PrefabLibrary;
};

/** The record an instance is stored as. */
export function instanceRecord(def: InstanceDef, z: string): EntityRecord {
  return { ...clone(def), z } as unknown as EntityRecord;
}

/** A new `Y.Map` holding a group. */
export function groupMap(group: GroupDef): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  map.set("at", clone(group.at));
  if (group.name !== undefined) map.set("name", group.name);
  return map;
}

/**
 * Seeds a doc with a scene, in one transaction. Only a server seeds: two
 * clients seeding one document on their own would duplicate every entity.
 */
export function sceneToDoc(def: SceneDefinition, opts: SceneToDocOptions = {}): Y.Doc {
  const doc = opts.doc ?? new Y.Doc();
  const key = opts.key ?? randomKey;
  if (entitiesMap(doc).size > 0 || docMeta(doc)) throw new Error("sceneToDoc: the doc isn't empty");
  doc.transact(() => {
    const meta = metaMap(doc);
    const scene = sceneMap(doc);
    const top = def as Record<string, unknown>;
    meta.set("schemaVersion", def.v);
    for (const k of META_HEADER) if (k !== "v" && typeof top[k] === "string") meta.set(k, top[k]);
    for (const [k, v] of Object.entries(top)) {
      if (v === undefined || (META_HEADER as readonly string[]).includes(k)) continue;
      if (k === "settings" || k === "entities" || k === "groups" || k === "instances") continue;
      if (!RESERVED_SCENE_KEYS.includes(k) && Array.isArray(v)) continue;
      scene.set(k, clone(v));
    }
    const settings = settingsMap(doc);
    for (const [k, v] of Object.entries(def.settings ?? {}))
      if (v !== undefined) settings.set(k, clone(v));

    const entities = entitiesMap(doc);
    for (const bulk of bulkKeysOf(def)) {
      const values = bulkEntries(def, bulk);
      const zs = initialZ(values.length);
      values.forEach((value, i) => entities.set(key(), recordMap(bulkRecord(bulk, value, zs[i]!))));
    }
    const named = def.entities ?? [];
    const zs = initialZ(named.length);
    named.forEach((e, i) => entities.set(key(), recordMap(entityRecord(e, zs[i]!))));

    for (const [id, group] of Object.entries(def.groups ?? {}))
      groupsMap(doc).set(id, groupMap(group));
    const placed = def.instances ?? [];
    const izs = initialZ(placed.length);
    placed.forEach((inst, i) =>
      instancesMap(doc).set(key(), recordMap(instanceRecord(inst, izs[i]!))),
    );
    for (const [id, prefab] of opts.prefabs ?? []) prefabsMap(doc).set(id, clone(prefab));
  }, opts.origin);
  return doc;
}
