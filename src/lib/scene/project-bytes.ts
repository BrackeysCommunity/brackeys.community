/**
 * Project and asset docs as bytes in, bytes out, for `canvas-sync` and the
 * web app's project bundles. As with `doc-bytes.ts`, no `Y.Doc` crosses
 * this boundary: callers hold their own Yjs and pass encoded state. Seeds
 * are deterministic (a fixed client id and sequential keys derived from
 * the content), so two writers seeding one doc write the same items. Shared
 * with services, so no `@/` imports.
 */
import * as Y from "yjs";

// Entry indexes by relative path: the service image has no tsconfig paths.
import {
  applyRepairs,
  COLLAB_LAYOUT_VERSION,
  contentMap,
  docLayout,
  docMeta,
  docPrefabs,
  docToPrefab,
  entitiesMap,
  isPrefabDoc,
  layoutFromDoc,
  layoutToDoc,
  LOG_ARRAY,
  LOG_CAP,
  migrateDoc,
  migrateDocLayout,
  migrateLayout,
  prefabHeaderMap,
  prefabsMap,
  prefabToDoc,
  PROJECT_LAYOUT_VERSION,
  randomKey,
  readDoc,
  readProject,
  seedProjectDoc,
  sequentialKeys,
  writeEntry,
  type DocOrigin,
  type LogEntry,
  type ProjectLogEntry,
  type ProjectWriter,
} from "../../engine/collab/index.ts";
import {
  createKindRegistry,
  docNameOf,
  formatAssetDoc,
  parseAssetDoc,
  projectView,
  sha256,
  stableJson,
  suffixedId,
  type AssetEntry,
  type AssetId,
  type AssetKey,
  type AssetKindName,
  type DocKindDef,
  type DocLayout,
  type KindEnv,
  type KindRegistry,
  type ProjectId,
  type ProjectState,
  type Sha256,
} from "../../engine/project/index.ts";
import {
  createRegistry,
  formatPrefab,
  hashText,
  PREFAB_KIND,
  SCENE_FORMAT_VERSION,
  type Prefab,
  type SceneDefinition,
} from "../../engine/scene/index.ts";
import { liftReachable } from "./doc-bytes";

const SEED_ORIGIN: DocOrigin = { kind: "migration" };

export { COLLAB_LAYOUT_VERSION };

/** The engine's own kinds over the engine's registry: what a host without game code knows. */
export const ENGINE_KINDS: KindRegistry = createKindRegistry(null);
const ENGINE_ENV: KindEnv = { registry: createRegistry(null), project: null };

function docOf(state: Uint8Array | null): Y.Doc {
  const doc = new Y.Doc();
  if (state && state.byteLength > 0) Y.applyUpdate(doc, state);
  return doc;
}

/** A client id that is a function of what is seeded, as `seedState` derives one. */
function seedClientId(...parts: string[]): number {
  return Number.parseInt(hashText(parts.join("\n")).slice(0, 8), 16);
}

/** A doc kind whose content the engine lays out itself (not a scene's or prefab's codec). */
export function declarativeKind(
  kinds: KindRegistry,
  kind: AssetKindName,
): (DocKindDef & { layout: DocLayout }) | null {
  const def = kinds.get(kind);
  return def?.storage === "doc" && def.layout !== "custom"
    ? (def as DocKindDef & { layout: DocLayout })
    : null;
}

// ─── Project docs ────────────────────────────────────────

/** A registry with nothing in it yet. */
export function emptyProjectState(projectId: ProjectId, name: string): ProjectState {
  return {
    meta: { projectId, layout: PROJECT_LAYOUT_VERSION, name },
    assets: {},
    history: {},
    code: {},
    build: {},
  };
}

/**
 * A new project doc holding `state`: `meta`, every entry, history arrays
 * for blob entries, the code map and build stamps. The same state gives the
 * same bytes on every machine, whatever the key order of `state`.
 */
export function seedProjectState(state: ProjectState): Uint8Array {
  const canonical = JSON.parse(stableJson(state)) as ProjectState;
  const doc = new Y.Doc();
  doc.clientID = seedClientId(
    docNameOf({ kind: "project", project: canonical.meta.projectId }),
    stableJson(canonical),
  );
  seedProjectDoc(doc, canonical, SEED_ORIGIN);
  return Y.encodeStateAsUpdate(doc);
}

/** Whether an encoded project doc has been seeded (its `meta` names its project). */
export function projectSeeded(state: Uint8Array | null): boolean {
  return typeof docOf(state).getMap("meta").get("projectId") === "string";
}

/** An encoded project doc as plain JSON. */
export function readProjectState(state: Uint8Array | null): ProjectState {
  return readProject(docOf(state));
}

/** What the project's one writer fixes on store, as `planProjectDuties` in the service decides it. */
export type ProjectDuties = {
  /**
   * Entries whose content hash isn't stored: back to an earlier one, or to
   * the trash when `to` is null. The entry takes `to.meta`, or none when it
   * is absent, so nothing describes bytes the store doesn't have.
   */
  hashes?: readonly {
    key: AssetKey;
    to: { sha256: Sha256; bytes: number; meta?: Record<string, unknown> } | null;
  }[];
  /** New doc entries the quota refused: to the trash. */
  refused?: readonly { key: AssetKey; message: string }[];
  /** Trashed entries a live doc names: restored. */
  restore?: readonly AssetKey[];
  now: number;
};

export type DutiesResult = {
  /** The whole state after the duties; the input when nothing was written. */
  state: Uint8Array;
  wrote: boolean;
  /** The project log entries written, one per kind of duty. */
  entries: ProjectLogEntry[];
};

const REPAIR_BY = "repair";

function pushLog(doc: Y.Doc, entry: ProjectLogEntry): void {
  const log = doc.getArray<ProjectLogEntry>(LOG_ARRAY);
  log.push([entry]);
  if (log.length > LOG_CAP) log.delete(0, log.length - LOG_CAP);
}

function logDuty(doc: Y.Doc, reason: string, label: string, at: number): ProjectLogEntry {
  const id = randomKey();
  const projectId = readProject(doc).meta.projectId;
  const entry: ProjectLogEntry = {
    id,
    actor: { kind: "repair", reason },
    label,
    at,
    docs: [{ doc: docNameOf({ kind: "project", project: projectId }), entry: id }],
  };
  pushLog(doc, entry);
  return entry;
}

/**
 * Applies the duties to an encoded project doc in one transaction: hash
 * reverts (`hash-mismatch`), quota refusals (`quota-exceeded`), then
 * restores (`asset-in-use`) together with `projectView`'s path and id
 * repairs, each kind with its own project log entry. Keys that aren't in
 * the registry are skipped.
 */
export function applyProjectDuties(state: Uint8Array, duties: ProjectDuties): DutiesResult {
  const doc = docOf(state);
  const entries: ProjectLogEntry[] = [];
  const origin: DocOrigin = { kind: "repair", reason: "server" };
  doc.transact(() => {
    const assets = readProject(doc).assets;
    const trash = (entry: AssetEntry) =>
      writeEntry(doc, { ...entry, deleted: { at: duties.now, by: REPAIR_BY } });

    const reverted: string[] = [];
    const trashedForHash: string[] = [];
    for (const { key, to } of duties.hashes ?? []) {
      const entry = assets[key];
      if (!entry) continue;
      if (to) {
        const { meta: _meta, ...rest } = entry;
        writeEntry(doc, {
          ...rest,
          sha256: to.sha256,
          bytes: to.bytes,
          ...(to.meta ? { meta: to.meta } : {}),
        });
        reverted.push(entry.id);
      } else {
        trash(entry);
        trashedForHash.push(entry.id);
      }
    }
    if (reverted.length + trashedForHash.length > 0) {
      const parts = [
        reverted.length > 0 && `${reverted.join(", ")} back to stored content`,
        trashedForHash.length > 0 && `${trashedForHash.join(", ")} to the trash`,
      ].filter(Boolean);
      entries.push(logDuty(doc, "hash-mismatch", `hash-mismatch: ${parts.join("; ")}`, duties.now));
    }

    const refused: string[] = [];
    for (const { key, message } of duties.refused ?? []) {
      const entry = assets[key];
      if (!entry || entry.deleted) continue;
      trash(entry);
      refused.push(`${entry.id} (${message})`);
    }
    if (refused.length > 0)
      entries.push(
        logDuty(doc, "quota-exceeded", `quota-exceeded: ${refused.join("; ")}`, duties.now),
      );

    const restore = duties.restore ?? [];
    const repaired = applyRepairs(doc, {
      restore,
      origin: { kind: "repair", reason: restore.length > 0 ? "asset-in-use" : "registry" },
      now: duties.now,
    });
    if (repaired.entry) entries.push(repaired.entry);
  }, origin);
  const wrote = entries.length > 0;
  return { state: wrote ? Y.encodeStateAsUpdate(doc) : state, wrote, entries };
}

/** Only what `applyProjectDuties` wrote, as an update against `from`. */
export function stateDiff(state: Uint8Array, from: Uint8Array): Uint8Array {
  return Y.diffUpdate(state, Y.encodeStateVectorFromUpdate(from));
}

// ─── Asset docs ──────────────────────────────────────────

/** An asset doc's `meta`: written once, by the seeder. */
export type AssetDocMeta = {
  kind: AssetKindName;
  /** The file format `v` the content holds; absent for a kind this side doesn't know. */
  schemaVersion?: number;
  layout: number;
  project: ProjectId;
  key: AssetKey;
};

export class AssetSeedError extends Error {}

/**
 * A new asset doc: `meta`, and the content of `seed` (the asset's file
 * text) laid out by its kind. A seed is read as the kind's file (migrated
 * when it parses); one the kind's schema refuses is laid out as written,
 * since its project's game may judge it differently. A prefab is laid out
 * as the prefab doc codec writes one. With no seed only `meta` is written
 * and the creating client writes the content. Throws `AssetSeedError` for a
 * seed this side can't lay out: not a JSON object (for a prefab, not a
 * prefab), or a kind that is neither the prefab kind nor one of `kinds`'
 * declarative ones.
 */
export function seedAssetState(input: {
  project: ProjectId;
  key: AssetKey;
  kind: AssetKindName;
  seed: string | null;
  kinds?: KindRegistry;
  env?: KindEnv;
}): Uint8Array {
  const kinds = input.kinds ?? ENGINE_KINDS;
  const known = kinds.get(input.kind);
  const def = declarativeKind(kinds, input.kind);
  const name = docNameOf({ kind: "asset", project: input.project, key: input.key });
  if (input.kind === PREFAB_KIND && input.seed !== null) {
    const prefab = prefabSeed(name, input.seed, kinds, input.env ?? ENGINE_ENV);
    return seedPrefabState({ project: input.project, key: input.key, prefab });
  }
  let value: Record<string, unknown> | null = null;
  let schemaVersion = known?.storage === "doc" ? known.version : undefined;
  if (input.seed !== null) {
    if (!def) throw new AssetSeedError(`${name}: asset kind "${input.kind}" can't be seeded here`);
    const parsed = parseAssetDoc(def, input.seed, input.env ?? ENGINE_ENV);
    let raw: unknown;
    if (parsed.ok) raw = parsed.value;
    else {
      try {
        raw = JSON.parse(input.seed);
      } catch {
        throw new AssetSeedError(`${name}: the seed isn't JSON`);
      }
    }
    if (raw === null || typeof raw !== "object" || Array.isArray(raw))
      throw new AssetSeedError(`${name}: the seed isn't a JSON object`);
    value = raw as Record<string, unknown>;
    if (!parsed.ok && typeof value.v === "number") schemaVersion = value.v;
  }

  const doc = new Y.Doc();
  doc.clientID = seedClientId(name, input.kind, input.seed ?? "");
  doc.transact(() => {
    const meta = doc.getMap<unknown>("meta");
    meta.set("kind", input.kind);
    if (schemaVersion !== undefined) meta.set("schemaVersion", schemaVersion);
    meta.set("layout", COLLAB_LAYOUT_VERSION);
    meta.set("project", input.project);
    meta.set("key", input.key);
  }, SEED_ORIGIN);
  if (def && value) layoutToDoc(doc, def.layout, value, SEED_ORIGIN, { key: sequentialKeys("s") });
  return Y.encodeStateAsUpdate(doc);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** A prefab file read by the prefab kind (migrated), else as written when its game's entities are unknown here. */
function prefabSeed(name: string, seed: string, kinds: KindRegistry, env: KindEnv): Prefab {
  const def = kinds.get(PREFAB_KIND);
  const parsed = def?.storage === "doc" && def.parse ? def.parse(seed, env) : null;
  if (parsed?.ok) return parsed.value as Prefab;
  let raw: unknown;
  try {
    raw = JSON.parse(seed);
  } catch {
    throw new AssetSeedError(`${name}: the seed isn't JSON`);
  }
  if (
    !isRecord(raw) ||
    raw.kind !== PREFAB_KIND ||
    typeof raw.v !== "number" ||
    typeof raw.id !== "string" ||
    !Array.isArray(raw.entities)
  )
    throw new AssetSeedError(`${name}: the seed isn't a prefab`);
  return raw as unknown as Prefab;
}

/** A new prefab doc holding `prefab`; the same prefab gives the same bytes on every machine. */
export function seedPrefabState(input: {
  project: ProjectId;
  key: AssetKey;
  prefab: Prefab;
}): Uint8Array {
  const doc = new Y.Doc();
  doc.clientID = seedClientId(
    docNameOf({ kind: "asset", project: input.project, key: input.key }),
    PREFAB_KIND,
    stableJson(input.prefab),
  );
  prefabToDoc(input.prefab, {
    doc,
    origin: SEED_ORIGIN,
    key: sequentialKeys("s"),
    project: input.project,
    assetKey: input.key,
  });
  return Y.encodeStateAsUpdate(doc);
}

/**
 * An encoded asset doc read at this engine's layout: a stored doc of an
 * older layout is lifted in the scratch doc, so its records read by their
 * current keys. Kinds `kinds` doesn't lay out are left as stored.
 */
function assetDocOf(state: Uint8Array | null, kinds: KindRegistry = ENGINE_KINDS): Y.Doc {
  const doc = docOf(state);
  liftAssetLayout(doc, kinds);
  return doc;
}

function liftAssetLayout(doc: Y.Doc, kinds: KindRegistry): boolean {
  if (isPrefabDoc(doc)) {
    const laidOut = docLayout(doc) < COLLAB_LAYOUT_VERSION && migrateDocLayout(doc).migrated;
    return liftPrefabFormat(doc) || laidOut;
  }
  if (docLayout(doc) >= COLLAB_LAYOUT_VERSION) return false;
  const meta = metaOf(doc);
  const def = meta && declarativeKind(kinds, meta.kind);
  return def ? migrateDocLayout(doc, def.layout).migrated : false;
}

/**
 * Lifts a prefab doc's `meta.schemaVersion` toward this engine's scene
 * format, as far as this side can without the game: a doc whose next step
 * needs its game's registry stays where it is (`liftReachable`). A doc from
 * a newer engine is left as stored rather than refused here.
 */
function liftPrefabFormat(doc: Y.Doc): boolean {
  const v = doc.getMap<unknown>("meta").get("schemaVersion");
  if (typeof v !== "number" || v >= SCENE_FORMAT_VERSION) return false;
  const lifted = liftReachable(docToPrefab(doc));
  if (lifted.version <= v) return false;
  return migrateDoc(doc, { target: lifted.version }) !== null;
}

/**
 * A stored prefab or declarative asset doc lifted to this engine's collab
 * layout (and a prefab doc toward its scene format version), in `migration`
 * transactions that keep every key: the doc's whole state. Null when it
 * needs nothing: unseeded, current already, or a kind `kinds` doesn't lay
 * out (a game's).
 */
export function migrateAssetLayoutState(
  state: Uint8Array | null,
  kinds: KindRegistry = ENGINE_KINDS,
): Uint8Array | null {
  const doc = docOf(state);
  return liftAssetLayout(doc, kinds) ? Y.encodeStateAsUpdate(doc) : null;
}

/** The prefab an encoded prefab doc holds; null before its header is written or for another kind. */
export function prefabDocValue(state: Uint8Array | null): Prefab | null {
  const doc = assetDocOf(state);
  if (!isPrefabDoc(doc) || typeof prefabHeaderMap(doc).get("id") !== "string") return null;
  return docToPrefab(doc);
}

function metaOf(doc: Y.Doc): AssetDocMeta | null {
  const meta = doc.getMap<unknown>("meta");
  const kind = meta.get("kind");
  const project = meta.get("project");
  const key = meta.get("key");
  if (typeof kind !== "string" || typeof project !== "string" || typeof key !== "string")
    return null;
  const layout = meta.get("layout");
  const out: AssetDocMeta = {
    kind,
    layout: typeof layout === "number" ? layout : 1,
    project,
    key,
  };
  const schemaVersion = meta.get("schemaVersion");
  if (typeof schemaVersion === "number") out.schemaVersion = schemaVersion;
  return out;
}

/** An encoded asset doc's `meta`; null before it is seeded. */
export function assetDocMeta(state: Uint8Array | null): AssetDocMeta | null {
  return metaOf(docOf(state));
}

/**
 * The format version an asset doc holds: its `meta.schemaVersion`, else the
 * content's own `v` (a kind this side doesn't know), else null.
 */
export function assetSchemaVersion(state: Uint8Array | null): number | null {
  const doc = docOf(state);
  const meta = metaOf(doc);
  if (meta?.schemaVersion !== undefined) return meta.schemaVersion;
  const v = contentMap(doc).get("v");
  return typeof v === "number" ? v : null;
}

/** The value a declarative or prefab asset doc holds; undefined before it has content or for another kind. */
export function assetDocValue(
  state: Uint8Array,
  kinds: KindRegistry = ENGINE_KINDS,
): Record<string, unknown> | undefined {
  const prefab = prefabDocValue(state);
  if (prefab) return prefab as unknown as Record<string, unknown>;
  const doc = assetDocOf(state, kinds);
  const meta = metaOf(doc);
  const def = meta && declarativeKind(kinds, meta.kind);
  if (!def || contentMap(doc).size === 0) return undefined;
  return layoutFromDoc(doc, def.layout);
}

/** The scene an encoded scene doc holds; undefined before it is seeded. */
export function sceneDocValue(state: Uint8Array): SceneDefinition | undefined {
  const doc = docOf(state);
  if (!docMeta(doc)) return undefined;
  if (docLayout(doc) < COLLAB_LAYOUT_VERSION) {
    // A read only: a layout-1 scene's own prefabs aren't part of its value.
    if (docLayout(doc) < 2) {
      const prefabs = prefabsMap(doc);
      for (const id of [...prefabs.keys()]) prefabs.delete(id);
    }
    migrateDocLayout(doc);
  }
  return readDoc(doc).def;
}

/** Items in every `keyed` and `list` collection of a value laid out by `layout`. */
export function layoutItemCount(layout: DocLayout, value: unknown): number {
  switch (layout.as) {
    case "atomic":
    case "text":
      return 0;
    case "map": {
      if (value === null || typeof value !== "object" || Array.isArray(value)) return 0;
      let n = 0;
      for (const [field, item] of Object.entries(value)) {
        const slot = layout.fields?.[field] ?? layout.rest;
        if (slot) n += layoutItemCount(slot, item);
      }
      return n;
    }
    case "list":
    case "keyed": {
      if (!Array.isArray(value)) return 0;
      let n = value.length;
      for (const item of value) n += layoutItemCount(layout.item, item);
      return n;
    }
  }
}

/** Items an encoded asset doc's content holds, for `DocKindDef.limits.maxItems`: a prefab's are its children. */
export function assetItemCount(state: Uint8Array, kinds: KindRegistry = ENGINE_KINDS): number {
  const doc = assetDocOf(state, kinds);
  if (isPrefabDoc(doc)) return entitiesMap(doc).size;
  const meta = metaOf(doc);
  const def = meta && declarativeKind(kinds, meta.kind);
  if (!def) return 0;
  return layoutItemCount(def.layout, layoutFromDoc(doc, def.layout));
}

/**
 * An asset doc's canonical text and its SHA-256, for prefabs and the kinds
 * in `kinds` that are laid out declaratively; null before it has content,
 * or for a kind it doesn't know (a game's, whose clients snapshot it).
 */
export async function assetSnapshot(
  state: Uint8Array,
  kinds: KindRegistry = ENGINE_KINDS,
): Promise<{ text: string; sha256: Sha256 } | null> {
  const prefab = prefabDocValue(state);
  if (prefab) {
    // Canonical text exists only at this engine's format, as for scenes.
    if (prefab.v !== SCENE_FORMAT_VERSION) return null;
    const text = formatPrefab(prefab);
    return { text, sha256: await sha256(text) };
  }
  const doc = assetDocOf(state, kinds);
  const meta = metaOf(doc);
  const def = meta && declarativeKind(kinds, meta.kind);
  if (!def || contentMap(doc).size === 0) return null;
  const text = formatAssetDoc(def, layoutFromDoc(doc, def.layout));
  return { text, sha256: await sha256(text) };
}

// ─── Scene layout migration ──────────────────────────────

/** A project's prefab doc as the host holds it: its stored state, and the seed its row was made with. */
export type HostedPrefabDoc = { state: Uint8Array | null; seed: string | null };

/**
 * What a scene's layout migration needs: the prefabs its `prefabs` map
 * holds, and the keys of the project's prefab docs it compares them with
 * (live prefab entries with those ids); null when the scene is unseeded or
 * already at this engine's layout.
 */
export function sceneLayoutNeeds(
  scene: Uint8Array,
  project: Uint8Array | null,
): { prefabs: AssetId[]; keys: AssetKey[] } | null {
  const doc = docOf(scene);
  if (!docMeta(doc) || docLayout(doc) >= COLLAB_LAYOUT_VERSION) return null;
  // Only layout 1 kept prefabs in the scene; from layout 2 the step is the scene's own.
  const prefabs = docLayout(doc) < 2 ? [...docPrefabs(doc).keys()] : [];
  if (prefabs.length === 0) return { prefabs, keys: [] };
  const view = projectView(readProjectState(project));
  const keys = prefabs.flatMap((id) => {
    const entry = view.byId.get(id);
    return entry?.kind === PREFAB_KIND ? [entry.key] : [];
  });
  return { prefabs, keys };
}

export type SceneLayoutMigration = {
  /** The scene's whole state, at this engine's layout. */
  scene: Uint8Array;
  /** The registry's whole state with the new prefab entries; null when the migration added none. */
  project: Uint8Array | null;
  /** The prefab docs to seed: deterministic, so two hosts migrating one scene write the same items. */
  prefabs: { key: AssetKey; state: Uint8Array }[];
  created: AssetId[];
  kept: AssetId[];
  diverged: AssetId[];
  entry?: LogEntry;
};

/**
 * `migrateLayout` on bytes, for a host that holds the project's registry
 * and prefab docs as stored state. A prefab entry whose doc holds nothing
 * yet (no row, or a row that was never seeded) takes the scene's copy, so
 * a migration cut short between its writes finishes on the next load. A
 * scene the registry doesn't list puts new prefabs under `prefabs/` at the
 * project's root. Null when the scene needs no migration.
 */
export function migrateSceneLayoutState(input: {
  scene: Uint8Array;
  projectId: ProjectId;
  sceneKey: AssetKey;
  /** The project's registry, seeded; null only for a scene that holds no prefabs. */
  project: Uint8Array | null;
  /** At least the docs `sceneLayoutNeeds` names; a key left out holds nothing. */
  prefabDocs: ReadonlyMap<AssetKey, HostedPrefabDoc>;
  now: number;
}): SceneLayoutMigration | null {
  const sceneDoc = docOf(input.scene);
  const projectDoc = docOf(input.project);
  const before = Y.encodeStateVector(projectDoc);
  const { projectId } = input;
  const unseeded = new Map<AssetId, AssetKey>();
  const prefabs: SceneLayoutMigration["prefabs"] = [];

  const bodyOf = (key: AssetKey): { body: Prefab | null; empty: boolean } => {
    const held = input.prefabDocs.get(key);
    const stored = prefabDocValue(held?.state ?? null);
    if (stored) return { body: stored, empty: false };
    if (held?.seed == null) return { body: null, empty: true };
    try {
      const seeded = seedAssetState({
        project: projectId,
        key,
        kind: PREFAB_KIND,
        seed: held.seed,
      });
      return { body: prefabDocValue(seeded), empty: false };
    } catch {
      return { body: null, empty: false };
    }
  };

  const writer: ProjectWriter = {
    scenePath: readProject(projectDoc).assets[input.sceneKey]?.path ?? `${input.sceneKey}.json`,
    prefab(id) {
      const entry = projectView(readProject(projectDoc)).byId.get(id);
      if (!entry) return null;
      if (entry.kind !== PREFAB_KIND) return { entry, body: null };
      const { body, empty } = bodyOf(entry.key);
      if (empty) {
        unseeded.set(id, entry.key);
        return null;
      }
      return { entry, body };
    },
    createPrefab({ id, path, prefab }, origin) {
      let key = unseeded.get(id);
      if (key === undefined) {
        const assets = readProject(projectDoc).assets;
        key = id;
        for (let n = 2; assets[key]; n++) key = suffixedId(id, n);
        writeEntry(
          projectDoc,
          { key, id, kind: PREFAB_KIND, path, created: { at: input.now, by: origin.kind } },
          origin,
        );
      }
      prefabs.push({ key, state: seedPrefabState({ project: projectId, key, prefab }) });
    },
  };

  const result = migrateLayout(sceneDoc, writer);
  if (!result.migrated) return null;
  const after = Y.encodeStateVector(projectDoc);
  const changed = after.byteLength !== before.byteLength || after.some((b, i) => b !== before[i]);
  return {
    scene: Y.encodeStateAsUpdate(sceneDoc),
    project: changed ? Y.encodeStateAsUpdate(projectDoc) : null,
    prefabs,
    created: result.created,
    kept: result.kept,
    diverged: result.diverged,
    ...(result.entry ? { entry: result.entry } : {}),
  };
}
