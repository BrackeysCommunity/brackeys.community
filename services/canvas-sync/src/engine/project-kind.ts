import type {
  beforeSyncPayload,
  Extension,
  onChangePayload,
  onLoadDocumentPayload,
  onStoreDocumentPayload,
} from "@hocuspocus/server";
import { and, eq, inArray, isNull, like } from "drizzle-orm";
import * as Y from "yjs";

import { projectAssetsMap, readEntry } from "../../../../packages/engine/collab/index.ts";
import {
  assertSameSeed,
  stampSeedState,
} from "../../../../packages/engine/collab/seed-identity.ts";
import {
  buildRefIndex,
  compareEntries,
  projectUsage,
  projectView,
  referencedTrash,
  type AssetEntry,
  type AssetId,
  type AssetKey,
  type KindRegistry,
  type ProjectState,
  type QuotaPolicy,
  type Sha256,
} from "../../../../packages/engine/project/index.ts";
import {
  createRegistry,
  ID_PATTERN,
  type Registry,
} from "../../../../packages/engine/scene/index.ts";
import {
  engineAssetDocs,
  engineBlobs,
  engineProjects,
  sceneDocs,
} from "../../../../src/db/schema.ts";
import {
  documentName,
  parseDocumentName,
  parseProjectKey,
  SYNC_CLOSE,
  syncClose,
} from "../../../../src/lib/canvas/sync-channels.ts";
import { siteQuotaPolicy } from "../../../../src/lib/engine/quota.ts";
import { PROJECT_DOC_LIMITS } from "../../../../src/lib/scene/limits.ts";
import {
  applyProjectDuties,
  assetDocValue,
  COLLAB_LAYOUT_VERSION,
  emptyProjectState,
  ENGINE_KINDS,
  projectSeeded,
  readProjectState,
  sceneDocValue,
  seedProjectState,
  type ProjectDuties,
} from "../../../../src/lib/scene/project-bytes.ts";
import { SERVER_APPLY_ORIGIN } from "../apply.ts";
import type { ServiceDb } from "../db.ts";
import type { DocumentKind } from "../kinds.ts";
import { SyncRefusal } from "../limits.ts";
import type { MemorySceneStore } from "../scene/store.ts";
import type { SyncMetrics } from "../telemetry.ts";
import { closeAll, foldInto, layoutGrant, linkRegistryRows, mergeStates } from "./asset-kind.ts";
import {
  isRefusal,
  MemoryDocStore,
  sameBytes,
  type DocEdit,
  type DocMerge,
  type DocWriteOutcome,
  type MemoryAssetDocStore,
  type MemoryDocRow,
} from "./doc-store.ts";

// ─── Where projects live ─────────────────────────────────

/** A doc row of a project: a scene in `scene_docs`, any other doc kind in `engine_asset_docs`. */
export interface ProjectDocRow {
  key: AssetKey;
  kind: string;
  prefix: "scene" | "asset";
  bytes: number;
}

/**
 * `engine_projects` and what the project kind checks a registry against.
 * The registry's state is written by the web app when it creates a project
 * and merged here on every store; a soft-deleted project reads as gone.
 */
export interface ProjectStore {
  exists(projectId: string): Promise<boolean>;
  load(projectId: string): Promise<{ state: Uint8Array | null; name: string } | null>;
  /** As `EngineDocStore.write`: the row is held for the length of `merge`. */
  write(projectId: string, merge: DocMerge, edit: DocEdit): Promise<DocWriteOutcome>;
  /** Every doc row the project has. */
  rows(projectId: string): Promise<ProjectDocRow[]>;
  /** Creates the rows that don't exist yet, with no seed. */
  createRows(projectId: string, rows: readonly Omit<ProjectDocRow, "bytes">[]): Promise<void>;
  /** Which of `hashes` the project's blob store holds. */
  knownBlobs(projectId: string, hashes: readonly Sha256[]): Promise<Set<Sha256>>;
}

const bytesOf = (value: Buffer | null): Uint8Array | null => (value ? new Uint8Array(value) : null);

export function postgresProjectStore(db: ServiceDb): ProjectStore {
  const live = (projectId: string) =>
    and(eq(engineProjects.projectId, projectId), isNull(engineProjects.deletedAt))!;
  return {
    async exists(projectId) {
      const [row] = await db
        .select({ projectId: engineProjects.projectId })
        .from(engineProjects)
        .where(live(projectId));
      return row !== undefined;
    },

    async load(projectId) {
      const [row] = await db
        .select({ state: engineProjects.state, name: engineProjects.name })
        .from(engineProjects)
        .where(live(projectId));
      return row ? { state: bytesOf(row.state), name: row.name } : null;
    },

    write(projectId, merge, edit) {
      return db.transaction(async (tx): Promise<DocWriteOutcome> => {
        // Not `for update`: the merge inserts doc rows whose foreign key
        // takes a key-share lock on this row.
        const [locked] = await tx
          .select({ state: engineProjects.state })
          .from(engineProjects)
          .where(live(projectId))
          .for("no key update");
        if (!locked) return { kind: "gone" };
        const stored = bytesOf(locked.state);
        const next = await merge(stored);
        if (isRefusal(next)) return { kind: "refused", ...next };
        if (sameBytes(stored, next.state)) return { kind: "unchanged" };
        await tx
          .update(engineProjects)
          .set({
            state: Buffer.from(next.state),
            byteSize: next.state.byteLength,
            layout: next.schemaVersion,
            updatedAt: edit.now,
          })
          .where(eq(engineProjects.projectId, projectId));
        return { kind: "stored", bytes: next.state.byteLength };
      });
    },

    async rows(projectId) {
      const [assets, scenes] = await Promise.all([
        db
          .select({
            key: engineAssetDocs.assetKey,
            kind: engineAssetDocs.kind,
            bytes: engineAssetDocs.byteSize,
          })
          .from(engineAssetDocs)
          .where(eq(engineAssetDocs.projectId, projectId)),
        db
          .select({ id: sceneDocs.sceneId, bytes: sceneDocs.byteSize })
          .from(sceneDocs)
          .where(like(sceneDocs.sceneId, `${projectId}.%`)),
      ]);
      return [
        ...assets.map((row) => ({ ...row, prefix: "asset" as const })),
        ...scenes.flatMap((row) => {
          const id = parseProjectKey(row.id);
          return id
            ? [{ key: id.key, kind: "scene", prefix: "scene" as const, bytes: row.bytes }]
            : [];
        }),
      ];
    },

    async createRows(projectId, rows) {
      const assets = rows.filter((row) => row.prefix === "asset");
      const scenes = rows.filter((row) => row.prefix === "scene");
      if (assets.length > 0)
        await db
          .insert(engineAssetDocs)
          .values(assets.map((row) => ({ projectId, assetKey: row.key, kind: row.kind })))
          .onConflictDoNothing();
      if (scenes.length > 0)
        await db
          .insert(sceneDocs)
          .values(scenes.map((row) => ({ sceneId: `${projectId}.${row.key}`, projectId })))
          .onConflictDoNothing();
    },

    async knownBlobs(projectId, hashes) {
      if (hashes.length === 0) return new Set();
      const rows = await db
        .select({ sha256: engineBlobs.sha256 })
        .from(engineBlobs)
        .where(and(eq(engineBlobs.projectId, projectId), inArray(engineBlobs.sha256, [...hashes])));
      return new Set(rows.map((row) => row.sha256));
    },
  };
}

export interface MemoryProjectRow extends MemoryDocRow {
  name: string;
}

/**
 * `engine_projects` in memory, shareable between server instances in one
 * process, over the memory doc stores whose rows it creates.
 */
export class MemoryProjectStore implements ProjectStore {
  private readonly table = new MemoryDocStore<MemoryProjectRow>(() => {});
  readonly deleted = new Set<string>();
  /** Blob hashes by project, as `engine_blobs` holds them. */
  readonly blobs = new Map<string, Set<Sha256>>();

  constructor(readonly docs: { assets?: MemoryAssetDocStore; scenes?: MemorySceneStore } = {}) {}

  get rowsById(): ReadonlyMap<string, MemoryProjectRow> {
    return this.table.rows;
  }

  get writes(): number {
    return this.table.writes;
  }

  /** What the web app does when it creates a project: the row, with the registry's first state. */
  create(projectId: string, name: string = projectId, state: Uint8Array | null = null): void {
    this.table.rows.set(projectId, {
      kind: "project",
      name,
      state,
      seed: null,
      schemaVersion: null,
      snapshot: null,
      byteSize: state?.byteLength ?? 0,
      lastEditedById: null,
      lastEditedAt: null,
    });
  }

  addBlob(projectId: string, sha256: Sha256): void {
    const set = this.blobs.get(projectId) ?? new Set();
    set.add(sha256);
    this.blobs.set(projectId, set);
  }

  deleteProject(projectId: string): void {
    this.deleted.add(projectId);
    this.docs.assets?.deleteProject(projectId);
    this.docs.scenes?.deleteProject(projectId);
  }

  async exists(projectId: string) {
    return !this.deleted.has(projectId) && this.table.rows.has(projectId);
  }

  async load(projectId: string) {
    const row = this.deleted.has(projectId) ? undefined : this.table.rows.get(projectId);
    return row ? { state: row.state, name: row.name } : null;
  }

  async write(projectId: string, merge: DocMerge, edit: DocEdit): Promise<DocWriteOutcome> {
    if (this.deleted.has(projectId)) return { kind: "gone" };
    return this.table.write(projectId, merge, edit);
  }

  async rows(projectId: string): Promise<ProjectDocRow[]> {
    const out: ProjectDocRow[] = [];
    const prefix = `${projectId}.`;
    for (const [id, row] of this.docs.assets?.rows ?? [])
      if (id.startsWith(prefix))
        out.push({
          key: id.slice(prefix.length),
          kind: row.kind,
          prefix: "asset",
          bytes: row.byteSize,
        });
    for (const [id, row] of this.docs.scenes?.rows ?? [])
      if (id.startsWith(prefix))
        out.push({
          key: id.slice(prefix.length),
          kind: "scene",
          prefix: "scene",
          bytes: row.byteSize,
        });
    return out;
  }

  async createRows(projectId: string, rows: readonly Omit<ProjectDocRow, "bytes">[]) {
    for (const row of rows) {
      const id = `${projectId}.${row.key}`;
      if (row.prefix === "asset") {
        if (this.docs.assets && !this.docs.assets.rows.has(id))
          this.docs.assets.create(id, row.kind);
      } else if (this.docs.scenes && !this.docs.scenes.rows.has(id)) this.docs.scenes.create(id);
    }
  }

  async knownBlobs(projectId: string, hashes: readonly Sha256[]) {
    const held = this.blobs.get(projectId);
    return new Set(hashes.filter((hash) => held?.has(hash)));
  }
}

// ─── The one writer's duties ─────────────────────────────

/** How a registry entry is held: a doc (and which table), or not a doc at all. */
export function docPrefixOf(entry: AssetEntry, kinds: KindRegistry): "scene" | "asset" | null {
  const def = kinds.get(entry.kind);
  if (def) {
    if (def.storage !== "doc") return null;
    return def.prefix === "scene" ? "scene" : "asset";
  }
  // A game's kind, which this side can't see: blobs carry a hash, docs don't.
  return entry.sha256 === undefined ? "asset" : null;
}

export interface DutyInput {
  /** The registry as merged, before the duties. */
  state: ProjectState;
  /** What was stored before this merge, for the content an unknown hash goes back to; read only for blob entries. */
  stored(): ProjectState | null;
  now: number;
  kinds: KindRegistry;
  registry: Registry;
  quota: QuotaPolicy;
  /** The values of the project's docs open here, by asset id; read only when the trash isn't empty. */
  values(state: ProjectState): ReadonlyMap<AssetId, unknown>;
  knownBlobs(hashes: readonly Sha256[]): Promise<ReadonlySet<Sha256>>;
  /** Whether a doc row is already known to exist, without asking the store. */
  hasRow(key: AssetKey): boolean;
  rows(): Promise<readonly ProjectDocRow[]>;
}

export interface DutyPlan {
  duties: ProjectDuties;
  /** Doc rows to create for new doc entries the quota let in. */
  create: Omit<ProjectDocRow, "bytes">[];
}

const withAssets = (state: ProjectState, assets: Record<AssetKey, AssetEntry>): ProjectState => ({
  ...state,
  assets,
});

/**
 * What the project's one writer fixes after a merge, decided on plain
 * JSON: a live entry whose hash the blob store lacks goes back to the
 * stored hash with its meta, or to an earlier hash from its history with
 * no meta (not inspected), else to the trash; a trashed entry an open
 * doc names is restored; a live doc entry with no row gets one if the
 * quota allows, else goes to the trash. Path and id repairs are a function
 * of the result and are applied with the duties.
 */
export async function planProjectDuties(input: DutyInput): Promise<DutyPlan> {
  const { state, kinds } = input;
  const assets: Record<AssetKey, AssetEntry> = { ...state.assets };

  // Content hashes.
  const hashes: NonNullable<ProjectDuties["hashes"]>[number][] = [];
  const blobEntries = Object.values(assets).filter((e) => !e.deleted && e.sha256 !== undefined);
  const trashedForHash = new Set<AssetKey>();
  if (blobEntries.length > 0) {
    const stored = input.stored();
    const asked = new Set<Sha256>();
    for (const entry of blobEntries) {
      asked.add(entry.sha256!);
      const before = stored?.assets[entry.key]?.sha256;
      if (before !== undefined) asked.add(before);
      for (const h of state.history[entry.key] ?? []) asked.add(h.sha256);
    }
    const known = await input.knownBlobs([...asked].sort());
    for (const entry of blobEntries) {
      const current = entry.sha256!;
      if (known.has(current)) continue;
      const before = stored?.assets[entry.key];
      let to: (typeof hashes)[number]["to"] = null;
      if (before?.sha256 !== undefined && before.sha256 !== current && known.has(before.sha256)) {
        to = {
          sha256: before.sha256,
          bytes: before.bytes ?? 0,
          ...(before.meta ? { meta: before.meta } : {}),
        };
      } else {
        const earlier = [...(state.history[entry.key] ?? [])]
          .reverse()
          .find((h) => h.sha256 !== current && known.has(h.sha256));
        if (earlier) to = { sha256: earlier.sha256, bytes: earlier.bytes };
      }
      hashes.push({ key: entry.key, to });
      if (to) {
        const { meta: _meta, ...rest } = entry;
        assets[entry.key] = {
          ...rest,
          sha256: to.sha256,
          bytes: to.bytes,
          ...(to.meta ? { meta: to.meta } : {}),
        };
      } else {
        assets[entry.key] = { ...entry, deleted: { at: input.now, by: "repair" } };
        trashedForHash.add(entry.key);
      }
    }
  }

  // Trashed entries an open doc names.
  const afterHashes = withAssets(state, assets);
  const view = projectView(afterHashes, kinds);
  let restore: AssetKey[] = [];
  if (view.deleted.length > 0) {
    const index = buildRefIndex(view, input.values(afterHashes), kinds, {
      registry: input.registry,
      project: view,
    });
    restore = referencedTrash(view, index).filter((key) => !trashedForHash.has(key));
  }
  for (const key of restore) {
    const { deleted: _deleted, ...rest } = assets[key]!;
    assets[key] = rest;
  }

  // Rows for new doc entries, within the quota.
  const create: DutyPlan["create"] = [];
  const refused: NonNullable<ProjectDuties["refused"]>[number][] = [];
  const candidates = Object.values(assets).filter(
    (e) =>
      !e.deleted &&
      ID_PATTERN.test(e.key) &&
      docPrefixOf(e, kinds) !== null &&
      !input.hasRow(e.key),
  );
  if (candidates.length > 0) {
    const rows = await input.rows();
    const sizes = new Map(rows.map((row) => [row.key, row.bytes]));
    const fresh = candidates.filter((e) => !sizes.has(e.key)).sort(compareEntries);
    if (fresh.length > 0) {
      const freshKeys = new Set(fresh.map((e) => e.key));
      const others = Object.fromEntries(
        Object.entries(assets).filter(([key]) => !freshKeys.has(key)),
      );
      const usage = projectUsage(projectView(withAssets(state, others)), sizes);
      const restoring = new Set(restore);
      for (const entry of fresh) {
        const verdict = input.quota.check(usage, { docs: 1 });
        if (verdict.ok) {
          usage.docs += 1;
          create.push({ key: entry.key, kind: entry.kind, prefix: docPrefixOf(entry, kinds)! });
        } else if (restoring.has(entry.key)) {
          restoring.delete(entry.key);
        } else {
          refused.push({ key: entry.key, message: verdict.message });
        }
      }
      restore = restore.filter((key) => restoring.has(key));
    }
  }

  return {
    duties: {
      now: input.now,
      ...(hashes.length > 0 ? { hashes } : {}),
      ...(refused.length > 0 ? { refused } : {}),
      ...(restore.length > 0 ? { restore } : {}),
    },
    create,
  };
}

// ─── The kind ────────────────────────────────────────────

export type ProjectRefusal = { refused: "too-large"; bytes: number };

export interface ProjectKindOptions {
  store: ProjectStore;
  /** This instance's live docs: the project's open docs are where references are read. */
  documents: () => ReadonlyMap<string, Y.Doc>;
  now: () => number;
  metrics: SyncMetrics;
  telemetry?: { captureException(error: unknown, properties?: Record<string, unknown>): void };
  /** Checked before a new doc entry gets its row; the site's quotas by default. */
  quota?: QuotaPolicy;
  /** The kinds this instance knows; the engine's by default. */
  kinds?: KindRegistry;
  limits?: { maxStateBytes: number; maxMessageBytes: number };
}

export type ProjectKind = DocumentKind & {
  /**
   * Runs the duties against the live registry doc, when it is open here:
   * what the project's other docs call after a load or store, so a
   * reference they hold to a trashed entry restores it.
   */
  review(projectId: string, opened?: { name: string; doc: Y.Doc }): Promise<void>;
  /**
   * Makes sure `key` has its doc row when the live registry here holds it as
   * a live doc entry: creates the rows of every such entry that lacks one,
   * as far as the quota allows, without waiting for the registry's store.
   * Resolves whether `key` has a row.
   */
  ensureRow(projectId: string, key: AssetKey): Promise<boolean>;
  /** The registry as it stands, the live doc's when it is open here, seeded as a load seeds it; null with no project. */
  registry(projectId: string): Promise<Uint8Array | null>;
  /**
   * Merges a registry state the server made into what's stored and the
   * live doc when it is open here, with the duties done (so a new doc entry
   * gets its row before this resolves).
   */
  update(projectId: string, state: Uint8Array): Promise<DocWriteOutcome["kind"]>;
};

/**
 * `project:<id>`: a hosted project's registry. The row must exist; a new
 * doc is seeded with `meta` only (the web app writes a created project's
 * first state into the row). Every store merges into what's stored
 * through a scratch doc and then applies the one writer's duties in one
 * `repair` transaction: path and id repairs, doc rows for new doc entries
 * (quota-gated), blob hash checks and restoring referenced trash.
 */
export function createProjectKind(options: ProjectKindOptions): ProjectKind {
  const { store, now, metrics } = options;
  const kinds = options.kinds ?? ENGINE_KINDS;
  const registry = createRegistry(null);
  const quota = options.quota ?? siteQuotaPolicy();
  const limits = options.limits ?? PROJECT_DOC_LIMITS;
  /** Positive answers only: a blob or row once seen stays. */
  const knownBlobs = new Map<string, Set<Sha256>>();
  const knownRows = new Map<string, Set<AssetKey>>();
  const reviews = new Map<string, Promise<void>>();
  /** Each project's row planning, one at a time, so two plans never both spend the last of the quota. */
  const planning = new Map<string, Promise<unknown>>();
  /** Keys a change already asked rows for, so a refused entry isn't planned again on every change. */
  const asked = new Map<string, Set<AssetKey>>();
  /** Docs handed to a review as they finish loading, before the server lists them. */
  const opening = new Map<string, Y.Doc>();

  const cached = <T>(map: Map<string, Set<T>>, projectId: string): Set<T> => {
    let set = map.get(projectId);
    if (!set) map.set(projectId, (set = new Set()));
    return set;
  };

  function openValues(projectId: string, state: ProjectState): Map<AssetId, unknown> {
    const values = new Map<AssetId, unknown>();
    const docs = new Map([...opening, ...options.documents()]);
    for (const [name, doc] of docs) {
      const parsed = parseDocumentName(name);
      if (!parsed || (parsed.kind !== "scene" && parsed.kind !== "asset")) continue;
      const id = parseProjectKey(parsed.id);
      if (id?.project !== projectId) continue;
      const entry = state.assets[id.key];
      if (!entry || entry.deleted) continue;
      const bytes = Y.encodeStateAsUpdate(doc);
      const value = parsed.kind === "scene" ? sceneDocValue(bytes) : assetDocValue(bytes, kinds);
      if (value !== undefined) values.set(entry.id, value);
    }
    return values;
  }

  function serial<T>(projectId: string, run: () => Promise<T>): Promise<T> {
    const next = (planning.get(projectId) ?? Promise.resolve()).then(run);
    const settled = next.catch(() => undefined);
    planning.set(projectId, settled);
    void settled.then(() => {
      if (planning.get(projectId) === settled) planning.delete(projectId);
    });
    return next;
  }

  function planFor(
    projectId: string,
    state: ProjectState,
    stored: () => ProjectState | null,
  ): Promise<DutyPlan> {
    const blobs = cached(knownBlobs, projectId);
    const rows = cached(knownRows, projectId);
    return planProjectDuties({
      state,
      stored,
      now: now(),
      kinds,
      registry,
      quota,
      values: (s) => openValues(projectId, s),
      async knownBlobs(hashes) {
        const ask = hashes.filter((h) => !blobs.has(h));
        if (ask.length > 0) for (const h of await store.knownBlobs(projectId, ask)) blobs.add(h);
        return blobs;
      },
      hasRow: (key) => rows.has(key),
      async rows() {
        const all = await store.rows(projectId);
        for (const row of all) rows.add(row.key);
        return all;
      },
    });
  }

  async function createRows(projectId: string, plan: DutyPlan): Promise<void> {
    if (plan.create.length === 0) return;
    await store.createRows(projectId, plan.create);
    const rows = cached(knownRows, projectId);
    for (const row of plan.create) rows.add(row.key);
  }

  /** The rows the live registry's new doc entries are due, created now; the store applies the rest of the duties. */
  function ensureRows(projectId: string): Promise<ReadonlySet<AssetKey>> {
    return serial(projectId, async () => {
      const rows = cached(knownRows, projectId);
      const document = options.documents().get(documentName("project", projectId));
      if (!document) return rows;
      const live = Y.encodeStateAsUpdate(document);
      if (!projectSeeded(live) || live.byteLength > limits.maxStateBytes) return rows;
      const row = await store.load(projectId);
      if (!row) return rows;
      const plan = await planFor(projectId, readProjectState(live), () =>
        row.state ? readProjectState(row.state) : null,
      );
      await createRows(projectId, plan);
      return rows;
    });
  }

  /** Whether the live registry holds a live doc entry this instance hasn't seen a row, or a request for one, for. */
  function wantsRows(projectId: string, document: Y.Doc): boolean {
    const rows = cached(knownRows, projectId);
    const seen = cached(asked, projectId);
    let wants = false;
    for (const [key, map] of projectAssetsMap(document)) {
      if (rows.has(key) || seen.has(key) || !(map instanceof Y.Map)) continue;
      const entry = readEntry(key, map);
      if (!entry || entry.deleted || !ID_PATTERN.test(key) || docPrefixOf(entry, kinds) === null)
        continue;
      seen.add(key);
      wants = true;
    }
    return wants;
  }

  async function ensureRow(projectId: string, key: AssetKey): Promise<boolean> {
    if (cached(knownRows, projectId).has(key)) return true;
    return (await ensureRows(projectId)).has(key);
  }

  function persist(
    projectId: string,
    live: Uint8Array,
  ): Promise<{ outcome: DocWriteOutcome<ProjectRefusal>; merged: Uint8Array | null }> {
    return serial(projectId, () => persistNow(projectId, live));
  }

  async function persistNow(
    projectId: string,
    live: Uint8Array,
  ): Promise<{ outcome: DocWriteOutcome<ProjectRefusal>; merged: Uint8Array | null }> {
    const started = performance.now();
    let mergeMs = 0;
    let merged: Uint8Array | null = null;
    const outcome = (await store.write(
      projectId,
      async (stored) => {
        const mergeStarted = performance.now();
        let state = mergeStates(stored, live);
        let layout: number;
        if (projectSeeded(state)) {
          const plain = readProjectState(state);
          layout = plain.meta.layout;
          const plan = await planFor(projectId, plain, () =>
            stored ? readProjectState(stored) : null,
          );
          state = applyProjectDuties(state, plan.duties).state;
          if (state.byteLength <= limits.maxStateBytes) await createRows(projectId, plan);
        } else layout = readProjectState(state).meta.layout;
        mergeMs = performance.now() - mergeStarted;
        merged = state;
        if (state.byteLength > limits.maxStateBytes) {
          return { refused: "too-large", bytes: state.byteLength };
        }
        return { state, schemaVersion: layout };
      },
      { editorId: null, now: new Date(now()) },
    )) as DocWriteOutcome<ProjectRefusal>;
    if (outcome.kind === "stored")
      metrics.store(performance.now() - started, mergeMs, outcome.bytes);
    if (outcome.kind === "refused") {
      metrics.storesRefused++;
      console.warn(`[store] refused project ${projectId}: too large (${outcome.bytes} bytes)`);
    }
    return { outcome, merged };
  }

  const persistence: Extension = {
    extensionName: "project-persistence",

    async onLoadDocument({ documentName: name, document }: onLoadDocumentPayload) {
      const projectId = name.slice("project:".length);
      linkRegistryRows(document, (key) => ensureRow(projectId, key));
      const row = await store.load(projectId);
      if (!row) throw new SyncRefusal(SYNC_CLOSE.revoked, "project not found", "auth");
      const live = stampSeedState(seededRow(projectId, row));
      // Stored at once with the duties done, so every instance starts from the same registry.
      const { outcome, merged } = await persist(projectId, live);
      if (outcome.kind === "refused") {
        throw new SyncRefusal(SYNC_CLOSE.tooLarge, "project too large", "size");
      }
      if (outcome.kind === "gone") {
        throw new SyncRefusal(SYNC_CLOSE.revoked, "project not found", "auth");
      }
      return merged ?? live;
    },

    // A client holding another seed's history is refused before either side merges.
    async beforeSync(payload: beforeSyncPayload) {
      assertSameSeed(payload);
    },

    // A client that writes a new doc entry opens its doc next: its row is made now, not at the store.
    async onChange({ documentName: name, document }: onChangePayload) {
      const projectId = name.slice("project:".length);
      if (!wantsRows(projectId, document)) return;
      ensureRows(projectId).catch((error: unknown) =>
        options.telemetry?.captureException(error, { project_id: projectId, during: "rows" }),
      );
    },

    async onStoreDocument({ documentName: name, document, instance }: onStoreDocumentPayload) {
      const projectId = name.slice("project:".length);
      let result: Awaited<ReturnType<typeof persist>>;
      try {
        result = await persist(projectId, Y.encodeStateAsUpdate(document));
      } catch (error) {
        metrics.storeFailures++;
        options.telemetry?.captureException(error, { project_id: projectId, during: "store" });
        // Rethrown so Hocuspocus keeps the doc in memory for the next store.
        throw error;
      }
      const { outcome, merged } = result;
      if (outcome.kind === "refused") {
        closeAll(document, syncClose(SYNC_CLOSE.tooLarge, "project too large"));
        setTimeout(() => void instance.unloadDocument(document), 0);
        return;
      }
      if (outcome.kind === "gone") {
        closeAll(document, syncClose(SYNC_CLOSE.revoked, "project deleted"));
        return;
      }
      if (merged) foldInto(document, merged);
    },

    async afterUnloadDocument({ documentName: name }) {
      const projectId = name.slice("project:".length);
      knownBlobs.delete(projectId);
      knownRows.delete(projectId);
      asked.delete(projectId);
    },
  };

  /** What a new registry doc starts from: the row's state, with `meta` seeded when it has none. */
  const seededRow = (projectId: string, row: { state: Uint8Array | null; name: string }) =>
    projectSeeded(row.state)
      ? row.state!
      : mergeStates(row.state, seedProjectState(emptyProjectState(projectId, row.name)));

  async function reviewNow(projectId: string): Promise<void> {
    const document = options.documents().get(documentName("project", projectId));
    if (!document) return;
    // Only the trash can be named from another doc; the registry's own stores do the rest.
    const state = readProjectState(Y.encodeStateAsUpdate(document));
    if (!Object.values(state.assets).some((e) => e.deleted)) return;
    try {
      const { outcome, merged } = await persist(projectId, Y.encodeStateAsUpdate(document));
      if ((outcome.kind === "stored" || outcome.kind === "unchanged") && merged)
        foldInto(document, merged);
    } catch (error) {
      options.telemetry?.captureException(error, { project_id: projectId, during: "review" });
    }
  }

  return {
    name: "project",
    noun: "project",
    limits,
    subject: (id) => documentName("project", id),
    async admit(id, claims) {
      if (!(await store.exists(id))) {
        throw new SyncRefusal(SYNC_CLOSE.revoked, "project not found", "auth");
      }
      return layoutGrant(claims, COLLAB_LAYOUT_VERSION);
    },
    persistence,
    ensureRow,
    async registry(projectId) {
      const live = options.documents().get(documentName("project", projectId));
      if (live) return Y.encodeStateAsUpdate(live);
      const row = await store.load(projectId);
      return row ? seededRow(projectId, row) : null;
    },
    async update(projectId, state) {
      const live = options.documents().get(documentName("project", projectId));
      if (live) Y.applyUpdate(live, state, SERVER_APPLY_ORIGIN);
      const { outcome, merged } = await persist(
        projectId,
        live ? Y.encodeStateAsUpdate(live) : state,
      );
      if (live && merged && (outcome.kind === "stored" || outcome.kind === "unchanged"))
        foldInto(live, merged);
      return outcome.kind;
    },
    review(projectId, opened) {
      if (opened) opening.set(opened.name, opened.doc);
      // One at a time per project; a review asked for while one runs runs after it.
      const previous = reviews.get(projectId) ?? Promise.resolve();
      const next = previous
        .then(() => reviewNow(projectId))
        .finally(() => {
          if (opened && opening.get(opened.name) === opened.doc) opening.delete(opened.name);
        });
      reviews.set(projectId, next);
      void next.then(() => {
        if (reviews.get(projectId) === next) reviews.delete(projectId);
      });
      return next;
    },
  };
}
