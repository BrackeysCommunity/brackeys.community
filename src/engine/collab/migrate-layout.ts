import type * as Y from "yjs";

import type { AssetEntry, AssetId, AssetKey, AssetPath } from "../project/types";
import { projectView, suffixedId } from "../project/view";
import { PREFAB_KIND, prefabBody } from "../scene/prefab";
import type { Prefab } from "../scene/types";
import { docLayout, docMeta, docPrefabs, metaMap, prefabsMap } from "./convert";
import { randomKey, type KeyGen } from "./keys";
import { appendLog, sameValue } from "./log";
import { docToPrefab, prefabPathNear, prefabToDoc } from "./prefab-doc";
import { readProject, writeEntry } from "./project-doc";
import { COLLAB_LAYOUT_VERSION, type DocOrigin, type LogEntry, type LogWarning } from "./types";

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

/**
 * Lifts a layout-1 scene doc to this engine's layout: each prefab in its
 * `prefabs` map becomes a prefab asset of its own (key = id, at
 * `<scene's folder>/prefabs/<id>.json`, its doc seeded from the value)
 * unless the project already has a live asset with that id; a prefab with
 * a different body, or an asset of another kind, is kept as it is and
 * noted as `prefab-diverged` in the migration's log entry, so no second
 * live asset takes the id. Then the map is cleared and `meta.layout` set,
 * all with the `migration` origin. Idempotent: a doc at this layout is
 * left alone.
 */
export function migrateLayout(sceneDoc: Y.Doc, project: ProjectWriter): LayoutMigration {
  const from = docLayout(sceneDoc);
  const to = COLLAB_LAYOUT_VERSION;
  if (!docMeta(sceneDoc) || from >= to)
    return { migrated: false, from, to, created: [], kept: [], diverged: [] };

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
