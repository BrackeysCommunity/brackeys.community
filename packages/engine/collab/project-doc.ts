/**
 * The project doc: one per project, the registry every client reads.
 *
 * ```
 * doc.getMap("meta")     projectId, layout, name                     written by the seeder only
 * doc.getMap("assets")   AssetKey → Y.Map of the entry's fields     import and licence are nested Y.Maps
 * doc.getMap("history")  AssetKey → Y.Array<HashHistoryEntry>       every hash a blob asset has held
 * doc.getMap("code")     module path → CodeModuleInfo (atomic)      written by the dev server or a push
 * doc.getMap("build")    AssetKindName → BuildStamp (atomic)        code skew
 * doc.getArray("log")    ProjectLogEntry[]                          batches that wrote the registry or several docs
 * ```
 *
 * An entry's fields other than `import` and `licence` are atomic (last
 * writer wins); those two merge per field. The entry's key is its map key
 * and isn't stored inside it.
 */
import * as Y from "yjs";

import { byCodeUnit, isPlainObject } from "../project/kinds/define";
import type {
  AssetEntry,
  AssetKey,
  BuildStamp,
  CodeModuleInfo,
  HashHistoryEntry,
  Licence,
  ProjectState,
} from "../project/types";
import { sameValue } from "./log";

/** The project doc layout this engine writes, stored as `meta.layout`; a doc with none is layout 1. */
export const PROJECT_LAYOUT_VERSION = 1;

export const PROJECT_MAPS = {
  meta: "meta",
  assets: "assets",
  history: "history",
  code: "code",
  build: "build",
} as const;

/** Entry fields held as nested `Y.Map`s, patched key by key. */
export const ENTRY_NESTED_FIELDS = ["import", "licence"] as const;
const ATOMIC_FIELDS = [
  "id",
  "kind",
  "path",
  "name",
  "sha256",
  "bytes",
  "meta",
  "created",
  "deleted",
];

export const projectMetaMap = (doc: Y.Doc) => doc.getMap<unknown>(PROJECT_MAPS.meta);
export const projectAssetsMap = (doc: Y.Doc) => doc.getMap<Y.Map<unknown>>(PROJECT_MAPS.assets);
export const projectHistoryMap = (doc: Y.Doc) =>
  doc.getMap<Y.Array<HashHistoryEntry>>(PROJECT_MAPS.history);
export const projectCodeMap = (doc: Y.Doc) => doc.getMap<CodeModuleInfo>(PROJECT_MAPS.code);
export const projectBuildMap = (doc: Y.Doc) => doc.getMap<BuildStamp>(PROJECT_MAPS.build);

const isStamp = (v: unknown): v is { at: number; by: string } =>
  isPlainObject(v) && typeof v.at === "number" && typeof v.by === "string";

function nestedJson(value: unknown): Record<string, unknown> | undefined {
  const json = value instanceof Y.Map ? (value.toJSON() as Record<string, unknown>) : value;
  return isPlainObject(json) && Object.keys(json).length > 0 ? json : undefined;
}

/** One registry entry as plain JSON; null when the map lacks an id, kind or path. */
export function readEntry(key: AssetKey, map: Y.Map<unknown>): AssetEntry | null {
  const id = map.get("id");
  const kind = map.get("kind");
  const path = map.get("path");
  if (typeof id !== "string" || typeof kind !== "string" || typeof path !== "string") return null;
  const created = map.get("created");
  const entry: AssetEntry = {
    key,
    id,
    kind,
    path,
    created: isStamp(created) ? { at: created.at, by: created.by } : { at: 0, by: "" },
  };
  const name = map.get("name");
  if (typeof name === "string") entry.name = name;
  const sha256 = map.get("sha256");
  if (typeof sha256 === "string") entry.sha256 = sha256;
  const bytes = map.get("bytes");
  if (typeof bytes === "number") entry.bytes = bytes;
  const meta = map.get("meta");
  if (isPlainObject(meta)) entry.meta = meta;
  const settings = nestedJson(map.get("import"));
  if (settings) entry.import = settings;
  const licence = nestedJson(map.get("licence"));
  if (licence) entry.licence = licence as Licence;
  const deleted = map.get("deleted");
  if (isStamp(deleted)) entry.deleted = { at: deleted.at, by: deleted.by };
  return entry;
}

const sortedRecord = <T>(entries: Iterable<[string, T]>): Record<string, T> =>
  Object.fromEntries([...entries].sort(([a], [b]) => byCodeUnit(a, b)));

/** The project doc as plain JSON, keys sorted. */
export function readProject(doc: Y.Doc): ProjectState {
  const meta = projectMetaMap(doc);
  const projectId = meta.get("projectId");
  const layout = meta.get("layout");
  const name = meta.get("name");
  const assets: [string, AssetEntry][] = [];
  for (const [key, map] of projectAssetsMap(doc)) {
    const entry = map instanceof Y.Map ? readEntry(key, map) : null;
    if (entry) assets.push([key, entry]);
  }
  const history: [string, HashHistoryEntry[]][] = [];
  for (const [key, list] of projectHistoryMap(doc))
    if (list instanceof Y.Array) history.push([key, list.toArray()]);
  return {
    meta: {
      projectId: typeof projectId === "string" ? projectId : "",
      layout: typeof layout === "number" ? layout : 1,
      name: typeof name === "string" ? name : "",
    },
    assets: sortedRecord(assets),
    history: sortedRecord(history),
    code: sortedRecord(projectCodeMap(doc).entries()),
    build: sortedRecord(projectBuildMap(doc).entries()),
  };
}

function patchNested(
  map: Y.Map<unknown>,
  field: string,
  next: Record<string, unknown> | undefined,
) {
  let nested = map.get(field);
  if (!(nested instanceof Y.Map)) {
    nested = new Y.Map<unknown>();
    map.set(field, nested);
  }
  const target = nested as Y.Map<unknown>;
  const want = next ?? {};
  for (const key of [...target.keys()]) if (!Object.hasOwn(want, key)) target.delete(key);
  for (const [key, value] of Object.entries(want))
    if (value !== undefined && !sameValue(target.get(key), value)) target.set(key, value);
}

/**
 * Writes `entry` under its key, creating it when new, touching only the
 * fields that changed. `import` and `licence` always exist as nested maps,
 * so concurrent edits of different settings or licence fields merge. Runs
 * in its own transaction, or in the caller's when inside one.
 */
export function writeEntry(doc: Y.Doc, entry: AssetEntry, origin?: unknown): void {
  doc.transact(() => {
    const assets = projectAssetsMap(doc);
    let map = assets.get(entry.key);
    if (!(map instanceof Y.Map)) {
      map = new Y.Map<unknown>();
      assets.set(entry.key, map);
    }
    const target = map;
    const fields = entry as Record<string, unknown>;
    for (const field of ATOMIC_FIELDS) {
      const value = fields[field];
      if (value === undefined) {
        if (target.has(field)) target.delete(field);
      } else if (!sameValue(target.get(field), value)) target.set(field, value);
    }
    patchNested(target, "import", entry.import);
    patchNested(target, "licence", entry.licence as Record<string, unknown> | undefined);
  }, origin);
}

/** Appends to an asset's hash history, creating the array when the asset has none. */
export function appendHistory(
  doc: Y.Doc,
  key: AssetKey,
  items: readonly HashHistoryEntry[],
  origin?: unknown,
): void {
  doc.transact(() => {
    const history = projectHistoryMap(doc);
    let list = history.get(key);
    if (!(list instanceof Y.Array)) {
      list = new Y.Array<HashHistoryEntry>();
      history.set(key, list);
    }
    if (items.length > 0) list.push([...items]);
  }, origin);
}

/**
 * Writes `next`'s registry where it differs from `prev` (the state `doc`
 * held when `next` was computed from it): changed entries field by field,
 * history entries past `prev`'s, and the removal of an entry or history
 * `next` no longer has (a purge). Call inside the batch's transaction.
 */
export function writeProjectState(doc: Y.Doc, prev: ProjectState, next: ProjectState): void {
  const assets = projectAssetsMap(doc);
  for (const key of Object.keys(prev.assets))
    if (!Object.hasOwn(next.assets, key)) assets.delete(key);
  const histories = projectHistoryMap(doc);
  for (const key of Object.keys(prev.history))
    if (!Object.hasOwn(next.history, key)) histories.delete(key);
  for (const [key, entry] of Object.entries(next.assets))
    if (!sameValue(prev.assets[key], entry)) writeEntry(doc, entry);
  for (const [key, items] of Object.entries(next.history)) {
    const had = prev.history[key];
    if (had && items.length === had.length) continue;
    appendHistory(doc, key, items.slice(had?.length ?? 0));
  }
  const code = projectCodeMap(doc);
  for (const [path, info] of Object.entries(next.code))
    if (!sameValue(prev.code[path], info)) code.set(path, info);
  for (const path of Object.keys(prev.code)) if (!Object.hasOwn(next.code, path)) code.delete(path);
  const build = projectBuildMap(doc);
  for (const [kind, stamp] of Object.entries(next.build))
    if (!sameValue(prev.build[kind], stamp)) build.set(kind, stamp);
}

/**
 * Fills an empty project doc: `meta` (at `PROJECT_LAYOUT_VERSION`), every
 * entry, a history array for each blob entry so concurrent first replaces
 * append to one array, the code map and build stamps. The project's one
 * writer seeds; pass a fixed `doc.clientID` for the same bytes everywhere.
 */
export function seedProjectDoc(doc: Y.Doc, state: ProjectState, origin?: unknown): void {
  if (projectMetaMap(doc).size > 0 || projectAssetsMap(doc).size > 0)
    throw new Error("seedProjectDoc: the project doc isn't empty");
  doc.transact(() => {
    const meta = projectMetaMap(doc);
    meta.set("projectId", state.meta.projectId);
    meta.set("layout", PROJECT_LAYOUT_VERSION);
    meta.set("name", state.meta.name);
    const empty: ProjectState = {
      meta: state.meta,
      assets: {},
      history: {},
      code: {},
      build: {},
    };
    const history = { ...state.history };
    for (const entry of Object.values(state.assets))
      if (entry.sha256 !== undefined) history[entry.key] ??= [];
    writeProjectState(doc, empty, { ...state, history });
  }, origin);
}
