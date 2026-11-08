import * as Y from "yjs";

import type { DocLayout } from "../project/kinds";
import type { AssetEntry, AssetId, AssetKey, AssetPath } from "../project/types";
import { projectView, suffixedId } from "../project/view";
import { PREFAB_KIND, prefabBody } from "../scene/prefab";
import type { Prefab } from "../scene/types";
import {
  docLayout,
  docMeta,
  docPrefabs,
  entitiesMap,
  instancesMap,
  metaMap,
  prefabsMap,
} from "./convert";
import { randomKey, type KeyGen } from "./keys";
import { liftKeyedLayout } from "./layout";
import { appendLog, sameValue } from "./log";
import { docToPrefab, prefabPathNear, prefabToDoc } from "./prefab-doc";
import { readProject, writeEntry } from "./project-doc";
import {
  BULK_FIELD,
  COLLAB_LAYOUT_VERSION,
  LEGACY_BULK_FIELD,
  LEGACY_Z_FIELD,
  Z_FIELD,
  type DocOrigin,
  type LogEntry,
  type LogWarning,
} from "./types";

const MIGRATION: DocOrigin = { kind: "migration" };

/** What a layout migration needs of the project the scene belongs to. */
export type ProjectWriter = {
  /** The scene's path in the project: new prefabs go under its folder's `prefabs/`. */
  scenePath: AssetPath;
  /**
   * The live asset with `id`, or null when the project has none; `body` is
   * its prefab doc's body, null for another kind or a prefab whose doc
   * can't be read.
   */
  prefab(id: AssetId): { entry: AssetEntry; body: Prefab | null } | null;
  /** Adds a prefab entry (key = id where free, else `suffixedId(id, n)`) at `path` and seeds its doc with `prefab`, with `origin`. */
  createPrefab(input: { id: AssetId; path: AssetPath; prefab: Prefab }, origin: DocOrigin): void;
};

export type LayoutMigration = {
  /** False when the doc wasn't seeded or was already at this engine's layout. */
  migrated: boolean;
  from: number;
  to: number;
  /** Prefabs that became assets of their own. */
  created: AssetId[];
  /** Prefabs the project already held with the same body. */
  kept: AssetId[];
  /** Prefabs the project already held with another body: the project's doc was kept, a `prefab-diverged` warning logged. */
  diverged: AssetId[];
  /** The scene doc's log entry for the migration. */
  entry?: LogEntry;
};

const sameBody = (a: Prefab, b: Prefab) =>
  sameValue({ ...prefabBody(a), game: a.game ?? null }, { ...prefabBody(b), game: b.game ?? null });

function renameKey(map: Y.Map<unknown>, from: string, to: string): void {
  if (from === to || !map.has(from)) return;
  const value = map.get(from);
  map.delete(from);
  map.set(to, value instanceof Y.AbstractType ? value.toJSON() : value);
}

/** Layout 2 → 3 for entity and instance records: `z` → `@z`, `bulk` → `@bulk`. */
function liftRecords(doc: Y.Doc): void {
  for (const map of [entitiesMap(doc), instancesMap(doc)])
    for (const rec of map.values()) {
      if (!(rec instanceof Y.Map)) continue;
      renameKey(rec, LEGACY_Z_FIELD, Z_FIELD);
      renameKey(rec, LEGACY_BULK_FIELD, BULK_FIELD);
    }
}

/**
 * Lifts a scene doc to this engine's layout. From layout 1, each prefab in
 * its `prefabs` map becomes a prefab asset of its own (key = id, at
 * `<scene's folder>/prefabs/<id>.json`, its doc seeded from the value)
 * unless the project already has a live asset with that id; a prefab with
 * a different body, or an asset of another kind, is kept as it is and
 * noted as `prefab-diverged` in the migration's log entry, so no second
 * live asset takes the id, and the map is cleared. From layout 2, every
 * entity and instance record's `z` and `bulk` become `@z` and `@bulk`,
 * keeping each record's key. Then `meta.layout` is set; the scene doc's
 * writes are one transaction, all with the `migration` origin. Idempotent:
 * a doc at this layout is left alone.
 */
export function migrateLayout(sceneDoc: Y.Doc, project: ProjectWriter): LayoutMigration {
  const from = docLayout(sceneDoc);
  const to = COLLAB_LAYOUT_VERSION;
  if (!docMeta(sceneDoc) || from >= to)
    return { migrated: false, from, to, created: [], kept: [], diverged: [] };
  if (from >= 2) {
    sceneDoc.transact(() => {
      liftRecords(sceneDoc);
      metaMap(sceneDoc).set("layout", to);
    }, MIGRATION);
    return { migrated: true, from, to, created: [], kept: [], diverged: [] };
  }

  const created: AssetId[] = [];
  const kept: AssetId[] = [];
  const diverged: AssetId[] = [];
  const warnings: LogWarning[] = [];
  for (const [id, value] of docPrefabs(sceneDoc)) {
    const prefab: Prefab = { ...value, kind: PREFAB_KIND, id };
    const existing = project.prefab(id);
    if (!existing) {
      project.createPrefab({ id, path: prefabPathNear(id, project.scenePath), prefab }, MIGRATION);
      created.push(id);
    } else if (existing.body && sameBody(existing.body, prefab)) kept.push(id);
    else {
      diverged.push(id);
      const { kind, path } = existing.entry;
      warnings.push({
        code: "prefab-diverged",
        message:
          kind !== PREFAB_KIND
            ? `The project's "${id}" (${path}) is a ${kind}, not a prefab, so this scene's prefab "${id}" was dropped and its instances of it don't resolve.`
            : existing.body
              ? `The project's prefab "${id}" (${path}) differs from the copy this scene held; the project's was kept.`
              : `The project's prefab "${id}" (${path}) couldn't be read, so it was kept and this scene's copy dropped.`,
        ids: [id],
      });
    }
  }

  let entry: LogEntry | undefined;
  sceneDoc.transact(() => {
    const map = prefabsMap(sceneDoc);
    for (const id of [...map.keys()]) map.delete(id);
    liftRecords(sceneDoc);
    metaMap(sceneDoc).set("layout", to);
    entry = appendLog(sceneDoc, {
      actor: MIGRATION,
      label: `Moved ${created.length + kept.length + diverged.length} prefabs to their own docs`,
      keys: [],
      ...(warnings.length > 0 ? { warnings } : {}),
    });
  }, MIGRATION);
  return { migrated: true, from, to, created, kept, diverged, ...(entry ? { entry } : {}) };
}

export type DocLayoutMigration = {
  /** False when the doc wasn't seeded or was already at this engine's layout. */
  migrated: boolean;
  from: number;
  to: number;
};

/**
 * Lifts a prefab doc, or a declarative asset doc laid out by `layout`, to
 * this engine's layout, in one `migration` transaction: a prefab's entity
 * and instance records, or each `keyed` entry at any depth of `content`,
 * get `@z` (and `@bulk`) for layout 2's `z` (and `bulk`), keeping every
 * key. Then `meta.layout` is set. Idempotent: a doc at this layout, or one
 * never seeded, is left alone. Throws for a layout-1 scene that still holds
 * prefabs: those move with `migrateLayout`.
 */
export function migrateDocLayout(doc: Y.Doc, layout?: DocLayout): DocLayoutMigration {
  const from = docLayout(doc);
  const to = COLLAB_LAYOUT_VERSION;
  if (!docMeta(doc) || from >= to) return { migrated: false, from, to };
  if (!layout && docPrefabs(doc).size > 0)
    throw new Error("migrateDocLayout: a layout-1 scene's prefabs move with migrateLayout");
  doc.transact(() => {
    if (layout) liftKeyedLayout(doc, layout);
    else liftRecords(doc);
    metaMap(doc).set("layout", to);
  }, MIGRATION);
  return { migrated: true, from, to };
}

export type ProjectDocWriterOptions = {
  /** The scene's registry key. */
  scene: AssetKey;
  /** The doc a prefab's content lives in, by key; null when the host can't hand it over. */
  prefabDoc(key: AssetKey): Y.Doc | null;
  now?: () => number;
  key?: KeyGen;
};

/**
 * A `ProjectWriter` over a project doc and the prefab docs the host holds
 * (the dev server's or the hosted service's), for `migrateLayout` at load.
 */
export function projectDocWriter(projectDoc: Y.Doc, opts: ProjectDocWriterOptions): ProjectWriter {
  const scene = readProject(projectDoc).assets[opts.scene];
  if (!scene)
    throw new Error(`projectDocWriter: the project has no asset with the key "${opts.scene}"`);
  const now = opts.now ?? Date.now;
  return {
    scenePath: scene.path,
    prefab(id) {
      const entry = projectView(readProject(projectDoc)).byId.get(id);
      if (!entry) return null;
      if (entry.kind !== PREFAB_KIND) return { entry, body: null };
      const doc = opts.prefabDoc(entry.key);
      return { entry, body: doc && docMeta(doc) ? docToPrefab(doc) : null };
    },
    createPrefab({ id, path, prefab }, origin) {
      const assets = readProject(projectDoc).assets;
      let key = id;
      for (let n = 2; assets[key]; n++) key = suffixedId(id, n);
      projectDoc.transact(
        () =>
          writeEntry(projectDoc, {
            key,
            id,
            kind: PREFAB_KIND,
            path,
            created: { at: now(), by: origin.kind },
          }),
        origin,
      );
      const doc = opts.prefabDoc(key);
      if (doc && !docMeta(doc))
        prefabToDoc(prefab, {
          doc,
          origin,
          key: opts.key ?? randomKey,
          project: readProject(projectDoc).meta.projectId,
          assetKey: key,
        });
    },
  };
}
