/**
 * A prefab as a doc of its own, laid out as a scene's entities are, so
 * concurrent edits to different children, or to different fields of one
 * child, merge.
 *
 * ```
 * doc.getMap("meta")      kind "prefab", schemaVersion, layout, game?, $schema?, project?, key?   seeder only
 * doc.getMap("prefab")    id, contract?   one atomic value each
 * doc.getMap("entities")  key → Y.Map     the children, exactly the scene's entity layout (bulk entries included)
 * doc.getArray("log")     LogEntry[]
 * ```
 */
import * as Y from "yjs";

import { cloneJson } from "../project/canonical";
import { folderOf, joinFolder } from "../project/kinds/define";
import type { AssetPath } from "../project/types";
import { PREFABS_DIR } from "../scene/prefab";
import {
  PREFAB_KIND,
  type BulkEntry,
  type BulkKey,
  type EntityDef,
  type Prefab,
  type SceneDefinition,
} from "../scene/types";
import { writeScene } from "./apply";
import {
  docMeta,
  entitiesMap,
  isPrefabDoc,
  metaMap,
  prefabHeaderMap,
  readDoc,
  seedDocMeta,
  seedEntities,
  type DocView,
} from "./convert";
import { randomKey, type KeyGen } from "./keys";
import { appendLog, fingerprint, sameValue, type LogInput } from "./log";
import type { DocOrigin, LogEntry } from "./types";

/** The log key a change to a prefab doc's header (`id`, `contract`) is recorded under. */
export const PREFAB_HEADER_KEY = "@header";

/** Where a new prefab made from the scene at `scenePath` lives: `<scene's folder>/prefabs/<id>.json`, as the prefab kind places it. */
export function prefabPathNear(id: string, scenePath?: AssetPath): AssetPath {
  const folder = folderOf(scenePath);
  const prefabs =
    folder === PREFABS_DIR || folder.endsWith(`/${PREFABS_DIR}`)
      ? folder
      : joinFolder(folder, PREFABS_DIR);
  return joinFolder(prefabs, `${id}.json`);
}

export type PrefabToDocOptions = {
  /** Fill this doc instead of a new one; it must be empty. */
  doc?: Y.Doc;
  /** The transaction origin of the seeding write. */
  origin?: unknown;
  key?: KeyGen;
  /** Written to `meta`: the project and registry key the doc belongs to. */
  project?: string;
  assetKey?: string;
};

/** The bulk arrays a prefab holds, in key order. */
const bulkOf = (prefab: Prefab): [BulkKey, BulkEntry[]][] =>
  Object.keys(prefab.bulk ?? {})
    .sort()
    .map((k) => [k, prefab.bulk![k]!]);

/**
 * Seeds a doc with a prefab, in one transaction. As with scenes, only the
 * project's one writer seeds a doc that others may open.
 */
export function prefabToDoc(prefab: Prefab, opts: PrefabToDocOptions = {}): Y.Doc {
  const doc = opts.doc ?? new Y.Doc();
  if (entitiesMap(doc).size > 0 || docMeta(doc))
    throw new Error("prefabToDoc: the doc isn't empty");
  doc.transact(() => {
    seedDocMeta(doc, {
      kind: PREFAB_KIND,
      schemaVersion: prefab.v,
      ...(prefab.game !== undefined ? { game: prefab.game } : {}),
      ...(prefab.$schema !== undefined ? { $schema: prefab.$schema } : {}),
      ...(opts.project !== undefined ? { project: opts.project } : {}),
      ...(opts.assetKey !== undefined ? { key: opts.assetKey } : {}),
    });
    const header = prefabHeaderMap(doc);
    header.set("id", prefab.id);
    if (prefab.contract !== undefined) header.set("contract", cloneJson(prefab.contract));
    seedEntities(doc, { entities: prefab.entities, bulk: bulkOf(prefab) }, opts.key ?? randomKey);
  }, opts.origin);
  return doc;
}

/** A prefab doc's view as the prefab it holds. */
function viewToPrefab(doc: Y.Doc, view: DocView): Prefab {
  const meta = metaMap(doc);
  const schema = meta.get("$schema");
  const game = meta.get("game");
  const bulk: Record<BulkKey, BulkEntry[]> = {};
  for (const k of view.bulkKeys.keys()) bulk[k] = cloneJson(view.def[k] as BulkEntry[]);
  return {
    ...(typeof schema === "string" ? { $schema: schema } : {}),
    kind: PREFAB_KIND,
    v: view.def.v,
    ...(typeof game === "string" ? { game } : {}),
    id: view.prefab?.id ?? "",
    ...(view.prefab?.contract !== undefined ? { contract: cloneJson(view.prefab.contract) } : {}),
    entities: cloneJson(view.def.entities ?? []) as EntityDef[],
    ...(Object.keys(bulk).length > 0 ? { bulk } : {}),
  };
}

/** The prefab a doc holds. Pass the result to `formatPrefab` for its canonical text. */
export function docToPrefab(doc: Y.Doc): Prefab {
  if (!isPrefabDoc(doc)) throw new Error("docToPrefab: not a prefab doc");
  return viewToPrefab(doc, readDoc(doc));
}

export type PrefabPatchOptions = {
  key?: KeyGen;
  /** The history label; default "Edit prefab <id>". */
  label?: string;
  /** Leave the change out of the doc's `log`. */
  noLog?: boolean;
};

/**
 * Brings a prefab doc to `next` in one transaction with `origin`, writing
 * only what changed: named children keep their keys by id, bulk entries by
 * position, and each child's map is patched field by field, so a
 * concurrent edit to another child or field survives. Returns the log
 * entry, or null when nothing changed.
 */
export function prefabPatch(
  doc: Y.Doc,
  next: Prefab,
  origin: DocOrigin,
  opts: PrefabPatchOptions = {},
): LogEntry | null {
  const view = readDoc(doc);
  const target: SceneDefinition = {
    ...view.def,
    v: next.v,
    ...(next.game !== undefined ? { game: next.game } : {}),
  };
  if (next.game === undefined) delete target.game;
  delete target.entities;
  for (const k of view.bulkKeys.keys()) delete target[k];
  for (const [k, values] of bulkOf(next)) if (values.length > 0) target[k] = cloneJson(values);
  if (next.entities.length > 0) target.entities = cloneJson(next.entities);

  const byId = new Map<string, string>();
  view.entityKeys.forEach((key, i) => {
    const id = view.def.entities![i]!.id;
    if (!byId.has(id)) byId.set(id, key);
  });
  const entities = next.entities.map((e) => {
    const key = byId.get(e.id);
    byId.delete(e.id);
    return key;
  });
  const buckets = new Map<BulkKey, (string | undefined)[]>();
  for (const [bulk, keys] of view.bulkKeys) buckets.set(bulk, [...keys]);

  const header = prefabHeaderMap(doc);
  const prevHeader = { id: view.prefab?.id ?? "", contract: view.prefab?.contract };
  const nextHeader = { id: next.id, contract: next.contract };
  const meta = metaMap(doc);
  const metaChanges: [string, unknown][] = [
    ["schemaVersion", next.v],
    ["game", next.game],
    ["$schema", next.$schema],
  ].filter(([k, v]) => !sameValue(meta.get(k as string) ?? null, v ?? null)) as [string, unknown][];

  let entry = null as LogEntry | null;
  doc.transact(() => {
    const written = writeScene(
      doc,
      view,
      target,
      { entities, buckets, instances: [] },
      opts.key ?? randomKey,
    );
    for (const [k, v] of metaChanges) {
      if (v === undefined) meta.delete(k);
      else meta.set(k, v);
    }
    if (!sameValue(prevHeader, nextHeader)) {
      if (header.get("id") !== next.id) header.set("id", next.id);
      if (next.contract === undefined) header.delete("contract");
      else if (!sameValue(header.get("contract"), next.contract))
        header.set("contract", cloneJson(next.contract));
      written.keys.push(PREFAB_HEADER_KEY);
      written.before[PREFAB_HEADER_KEY] = cloneJson(prevHeader);
      written.after[PREFAB_HEADER_KEY] = fingerprint(nextHeader);
    }
    if (opts.noLog || written.keys.length === 0) return;
    const input: LogInput = {
      actor: origin,
      label: opts.label ?? `Edit prefab ${next.id}`,
      keys: written.keys,
      before: written.before,
      after: written.after,
      ops: ["definePrefab"],
    };
    entry = appendLog(doc, input);
  }, origin);
  return entry;
}
