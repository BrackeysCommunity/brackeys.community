import type * as Y from "yjs";

import { MIGRATIONS, migrate, type MigrateEnv, type Migration } from "../scene/migrate";
import {
  SCENE_FORMAT_VERSION,
  type BulkKey,
  type Prefab,
  type SceneDefinition,
} from "../scene/types";
import { writeScene } from "./apply";
import { isPrefabDoc, metaMap, readDoc } from "./convert";
import { randomKey, type KeyGen } from "./keys";
import { sameValue } from "./log";
import { docToPrefab, prefabPatch } from "./prefab-doc";
import type { SceneOrigin } from "./types";

export type MigrateDocOptions = {
  migrations?: Readonly<Record<number, Migration>>;
  /** The format version to lift to; default the engine's. */
  target?: number;
  key?: KeyGen;
  /** The game's registry and the project's prefabs, for steps that need them. */
  env?: MigrateEnv;
};

const MIGRATION: SceneOrigin = { kind: "migration" };

/**
 * Lifts a doc to `target` in place, in one `migration` transaction, keeping
 * each entry's key so an edit made against the old version still lands on
 * the same entity: named entities match by id, bulk entries by position.
 * A step that changes only `v` writes only `meta.schemaVersion` and leaves
 * every record untouched; a prefab doc's other changes are patched in with
 * `prefabPatch`, which keeps its children's keys the same way. `env` is
 * what the steps need (v3 → v4 needs the game's registry and the
 * project's prefabs). Returns the versions, or null when the doc was
 * already at `target`. Throws, leaving the doc as it was, when a step is
 * missing or refuses, or the doc is newer than `target`.
 */
export function migrateDoc(
  doc: Y.Doc,
  opts: MigrateDocOptions = {},
): { from: number; to: number } | null {
  const target = opts.target ?? SCENE_FORMAT_VERSION;
  const prefab = isPrefabDoc(doc);
  const view = readDoc(doc);
  const current: unknown = prefab ? docToPrefab(doc) : view.def;
  const migrated = migrate(
    structuredClone(current),
    opts.migrations ?? MIGRATIONS,
    target,
    opts.env,
  );
  if (!migrated.ok)
    throw new Error(`can't migrate ${prefab ? "prefab" : "scene"}: ${migrated.issue.message}`);
  if (migrated.from === target) return null;
  if (
    sameValue({ ...(migrated.raw as object), v: target }, { ...(current as object), v: target })
  ) {
    doc.transact(() => metaMap(doc).set("schemaVersion", target), MIGRATION);
    return { from: migrated.from, to: target };
  }
  if (prefab) {
    prefabPatch(doc, migrated.raw as Prefab, MIGRATION, {
      ...(opts.key ? { key: opts.key } : {}),
      noLog: true,
    });
    return { from: migrated.from, to: target };
  }
  const next = migrated.raw as SceneDefinition;

  const byId = new Map<string, string>();
  view.entityKeys.forEach((key, i) => {
    const id = view.def.entities![i]!.id;
    if (!byId.has(id)) byId.set(id, key);
  });
  const entities = (next.entities ?? []).map((e) => {
    const key = byId.get(e.id);
    byId.delete(e.id);
    return key;
  });
  const buckets = new Map<BulkKey, (string | undefined)[]>();
  for (const [bulk, keys] of view.bulkKeys) buckets.set(bulk, [...keys]);
  const instanceById = new Map<string, string>();
  view.instanceKeys.forEach((key, i) => instanceById.set(view.def.instances![i]!.id, key));
  const instances = (next.instances ?? []).map((x) => instanceById.get(x.id));

  doc.transact(() => {
    const meta = metaMap(doc);
    meta.set("schemaVersion", target);
    for (const k of ["$schema", "game"] as const) {
      const v = (next as Record<string, unknown>)[k];
      if (typeof v === "string") meta.set(k, v);
      else meta.delete(k);
    }
    writeScene(doc, view, next, { entities, buckets, instances }, opts.key ?? randomKey);
  }, MIGRATION);
  return { from: migrated.from, to: target };
}
