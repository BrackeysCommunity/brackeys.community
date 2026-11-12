import type {
  beforeSyncPayload,
  beforeUnloadDocumentPayload,
  Document,
  Extension,
  onChangePayload,
  onLoadDocumentPayload,
  onStoreDocumentPayload,
} from "@hocuspocus/server";
import * as Y from "yjs";

import {
  assertSameSeed,
  stampSeedState,
} from "../../../../packages/engine/collab/seed-identity.ts";
import type { KindRegistry } from "../../../../packages/engine/project/index.ts";
import { PREFAB_KIND, SCENE_FORMAT_VERSION } from "../../../../packages/engine/scene/index.ts";
import { SYNC_LIMITS } from "../../../../src/lib/canvas/limits.ts";
import { documentName, SYNC_CLOSE, syncClose } from "../../../../src/lib/canvas/sync-channels.ts";
import type { CanvasTokenClaims } from "../../../../src/lib/canvas/token.ts";
import { ASSET_DOC_LIMITS } from "../../../../src/lib/scene/limits.ts";
import {
  AssetSeedError,
  assetDocMeta,
  COLLAB_LAYOUT_VERSION,
  assetItemCount,
  assetSchemaVersion,
  assetSnapshot,
  ENGINE_KINDS,
  migrateAssetLayoutState,
  seedAssetState,
} from "../../../../src/lib/scene/project-bytes.ts";
import { SERVER_APPLY_ORIGIN } from "../apply.ts";
import { formatReadOnlyReason, type DocumentKind, type KindGrant } from "../kinds.ts";
import { assetDocLimits, assetKindLimits, SyncRefusal, type AssetDocLimits } from "../limits.ts";
import { SnapshotSchedule } from "../persistence.ts";
import type { SyncMetrics } from "../telemetry.ts";
import { splitDocId, type DocWriteOutcome, type EngineDocStore } from "./doc-store.ts";

/**
 * Sent once connected to a client the project or asset kind connected
 * read-only because its collab layout differs from the docs'.
 * `engine-outdated`: reload to update. `server-outdated`: this instance
 * writes an older layout than the client's engine.
 */
export type LayoutReadOnlyNotice = {
  type: "layout-read-only";
  reason: "engine-outdated" | "server-outdated";
  layout: number;
};

/** What a project or asset doc admits a client on, by the token's `l` against the docs' layout. */
export function layoutGrant(claims: Pick<CanvasTokenClaims, "l">, layout: number): KindGrant {
  if (claims.l === undefined) {
    throw new SyncRefusal(SYNC_CLOSE.unauthorized, "token carries no layout version", "auth");
  }
  if (claims.l === layout) return {};
  const notice: LayoutReadOnlyNotice = {
    type: "layout-read-only",
    reason: claims.l < layout ? "engine-outdated" : "server-outdated",
    layout,
  };
  return { readOnly: true, notice: JSON.stringify(notice) };
}

/** Who made a connection's last change, for `last_edited_by`. */
export function trackEditors(): {
  onChange(payload: onChangePayload): void;
  get(name: string): string | null;
  forget(name: string): void;
} {
  const last = new Map<string, string>();
  return {
    onChange({ documentName: name, transactionOrigin }) {
      const origin = transactionOrigin as {
        source?: string;
        connection?: { context?: { userId?: string } };
      };
      const userId =
        origin?.source === "connection" ? origin.connection?.context?.userId : undefined;
      if (userId) last.set(name, userId);
    },
    get: (name) => last.get(name) ?? null,
    forget: (name) => void last.delete(name),
  };
}

/** What a live registry doc creates its doc rows with, by the doc itself; the project kind links it at load. */
const registryRows = new WeakMap<Y.Doc, (key: string) => Promise<boolean>>();

/** Lets the asset kind ask the live registry `document` for a row its entries are due. */
export function linkRegistryRows(document: Y.Doc, ensure: (key: string) => Promise<boolean>): void {
  registryRows.set(document, ensure);
}

export function closeAll(document: Document, event: { code: number; reason: string }): void {
  for (const connection of document.getConnections()) connection.close(event);
}

/** Folds `merged` into the live doc: whatever the store held that the live doc lacked. */
export function foldInto(document: Y.Doc, merged: Uint8Array): void {
  const scratch = new Y.Doc();
  Y.applyUpdate(scratch, merged);
  Y.applyUpdate(
    document,
    Y.encodeStateAsUpdate(scratch, Y.encodeStateVector(document)),
    SERVER_APPLY_ORIGIN,
  );
}

/** Stored and live, merged in a scratch doc so neither is touched until the write lands. */
export function mergeStates(stored: Uint8Array | null, live: Uint8Array): Uint8Array {
  const scratch = new Y.Doc();
  if (stored && stored.byteLength > 0) Y.applyUpdate(scratch, stored);
  Y.applyUpdate(scratch, live);
  return Y.encodeStateAsUpdate(scratch);
}

export type AssetRefusal = {
  refused: "too-large" | "too-many-items";
  bytes: number;
  items?: number;
};

export interface AssetKindOptions {
  store: EngineDocStore;
  /** This instance's live docs, to read an open doc's layout at connect. */
  documents: () => ReadonlyMap<string, Y.Doc>;
  now: () => number;
  metrics: SyncMetrics;
  telemetry?: { captureException(error: unknown, properties?: Record<string, unknown>): void };
  /** The kinds this instance can seed, snapshot and cap; the engine's by default. */
  kinds?: KindRegistry;
  /** What a kind gets when it names no limits; `ASSET_DOC_LIMITS` by default. */
  defaults?: { maxStateBytes: number; maxMessageBytes: number };
  snapshotIntervalMs?: number;
}

export type AssetKind = DocumentKind & {
  snapshots: SnapshotSchedule;
  /** The caps of one doc, by the kind its row was created as; the defaults before it is admitted. */
  limitsFor(id: string): AssetDocLimits;
  /** A doc's state as it stands, the live doc's when it is open here, and its row's seed; null with no row. */
  read(id: string): Promise<{ state: Uint8Array | null; seed: string | null } | null>;
  /**
   * Merges a state the server made (a prefab a scene's layout migration
   * moved out) into the doc as a store would, limits and snapshot included,
   * and into the live doc when it is open here.
   */
  write(id: string, state: Uint8Array): Promise<DocWriteOutcome["kind"]>;
};

/**
 * `asset:<project>.<key>`: every doc of a project that isn't a scene or the
 * registry. The row comes first (the project kind creates it when the
 * registry gains the entry); only the server seeds a new doc, `meta` from
 * the row and the content from its seed, and merges every store into
 * what's stored. Docs of the engine's own kinds (prefabs and the
 * declarative ones) keep a canonical snapshot and its SHA-256; a game's
 * kinds snapshot client-side.
 */
export function createAssetKind(options: AssetKindOptions): AssetKind {
  const { store, now, metrics } = options;
  const kinds = options.kinds ?? ENGINE_KINDS;
  const defaults = assetDocLimits(undefined, options.defaults ?? ASSET_DOC_LIMITS);
  const schedule = new SnapshotSchedule(
    options.snapshotIntervalMs ?? SYNC_LIMITS.snapshotIntervalMs,
  );
  const editors = trackEditors();
  const limitsByDoc = new Map<string, AssetDocLimits>();

  const limitsOfKind = (kind: string) => assetKindLimits(kind, kinds, defaults);
  const limitsFor = (id: string) => limitsByDoc.get(id) ?? defaults;

  /**
   * A doc with no row yet whose project's live registry here holds it as a
   * live doc entry (a client created the asset and opens its doc before the
   * registry's store): the registry creates the row now, quota permitting.
   */
  async function rowDue(id: string): Promise<boolean> {
    const parts = splitDocId(id);
    if (!parts) return false;
    const registry = options.documents().get(documentName("project", parts.projectId));
    const ensure = registry && registryRows.get(registry);
    return ensure ? ensure(parts.key) : false;
  }

  async function headOf(id: string) {
    return (await store.head(id)) ?? ((await rowDue(id)) ? store.head(id) : null);
  }

  async function persist(
    id: string,
    live: Uint8Array,
    edit: { editorId: string | null; withSnapshot: boolean },
  ): Promise<{ outcome: DocWriteOutcome<AssetRefusal>; merged: Uint8Array | null }> {
    const started = performance.now();
    let mergeMs = 0;
    let merged: Uint8Array | null = null;
    const outcome = (await store.write(
      id,
      async (stored) => {
        const mergeStarted = performance.now();
        const state = mergeStates(stored, live);
        mergeMs = performance.now() - mergeStarted;
        merged = state;
        const meta = assetDocMeta(state);
        const limits = meta ? limitsOfKind(meta.kind) : limitsFor(id);
        limitsByDoc.set(id, limits);
        if (state.byteLength > limits.maxStateBytes) {
          return { refused: "too-large", bytes: state.byteLength };
        }
        if (limits.maxItems !== undefined) {
          const items = assetItemCount(state, kinds);
          if (items > limits.maxItems) {
            return { refused: "too-many-items", bytes: state.byteLength, items };
          }
        }
        const schemaVersion = assetSchemaVersion(state) ?? 0;
        if (!edit.withSnapshot) return { state, schemaVersion };
        const snapshotStarted = performance.now();
        const snapshot = await assetSnapshot(state, kinds);
        metrics.snapshot(performance.now() - snapshotStarted);
        return {
          state,
          schemaVersion,
          ...(snapshot ? { snapshot: { text: snapshot.text, hash: snapshot.sha256 } } : {}),
        };
      },
      { editorId: edit.editorId, now: new Date(now()) },
    )) as DocWriteOutcome<AssetRefusal>;
    if (outcome.kind === "stored")
      metrics.store(performance.now() - started, mergeMs, outcome.bytes);
    if (outcome.kind === "refused") {
      metrics.storesRefused++;
      console.warn(
        `[store] refused asset ${id}: ${outcome.refused} (${outcome.bytes} bytes${outcome.items !== undefined ? `, ${outcome.items} items` : ""})`,
      );
    }
    return { outcome, merged };
  }

  /** Stores a state made at load (seeded or migrated) at once, so every instance and the next load start from it. */
  async function storeLoaded(id: string, state: Uint8Array): Promise<Uint8Array> {
    const { outcome, merged } = await persist(id, state, { editorId: null, withSnapshot: true });
    if (outcome.kind === "refused") {
      throw new SyncRefusal(SYNC_CLOSE.tooLarge, "asset too large", "size");
    }
    if (outcome.kind === "gone") {
      throw new SyncRefusal(SYNC_CLOSE.revoked, "asset not found", "auth");
    }
    schedule.written(id, now());
    return merged ?? state;
  }

  const persistence: Extension = {
    extensionName: "asset-persistence",

    async onLoadDocument({ documentName: name }: onLoadDocumentPayload) {
      const id = name.slice("asset:".length);
      let [row, head] = await Promise.all([store.load(id), store.head(id)]);
      if ((!row || !head) && (await rowDue(id)))
        [row, head] = await Promise.all([store.load(id), store.head(id)]);
      if (!row || !head) throw new SyncRefusal(SYNC_CLOSE.revoked, "asset not found", "auth");
      limitsByDoc.set(id, limitsOfKind(head.kind));
      if (assetDocMeta(row.state)) {
        const lifted = migrateAssetLayoutState(row.state, kinds);
        if (!lifted) return stampSeedState(row.state!);
        console.log(`[load] asset ${id} lifted to layout ${COLLAB_LAYOUT_VERSION}`);
        return storeLoaded(id, stampSeedState(lifted));
      }

      const parts = splitDocId(id)!;
      let seeded: Uint8Array;
      try {
        seeded = seedAssetState({
          project: parts.projectId,
          key: parts.key,
          kind: head.kind,
          seed: row.seed,
          kinds,
        });
      } catch (error) {
        if (!(error instanceof AssetSeedError)) throw error;
        options.telemetry?.captureException(error, { asset_id: id, during: "seed" });
        throw new SyncRefusal(SYNC_CLOSE.revoked, "asset can't be seeded", "auth");
      }
      return storeLoaded(id, stampSeedState(seeded));
    },

    // A client holding another seed's history is refused before either side merges.
    async beforeSync(payload: beforeSyncPayload) {
      assertSameSeed(payload);
    },

    async onChange(payload: onChangePayload) {
      editors.onChange(payload);
    },

    async onStoreDocument({ documentName: name, document, instance }: onStoreDocumentPayload) {
      const id = name.slice("asset:".length);
      const at = now();
      const withSnapshot = schedule.due(id, at, document.getConnectionsCount() === 0);
      let result: Awaited<ReturnType<typeof persist>>;
      try {
        result = await persist(id, Y.encodeStateAsUpdate(document), {
          editorId: editors.get(name),
          withSnapshot,
        });
      } catch (error) {
        metrics.storeFailures++;
        options.telemetry?.captureException(error, { asset_id: id, during: "store" });
        // Rethrown so Hocuspocus keeps the doc in memory for the next store.
        throw error;
      }
      const { outcome, merged } = result;
      if (outcome.kind === "refused") {
        closeAll(document, syncClose(SYNC_CLOSE.tooLarge, "asset too large"));
        setTimeout(() => void instance.unloadDocument(document), 0);
        return;
      }
      if (outcome.kind === "gone") {
        closeAll(document, syncClose(SYNC_CLOSE.revoked, "asset deleted"));
        return;
      }
      if (merged) foldInto(document, merged);
      if (withSnapshot) schedule.written(id, at);
      else if (outcome.kind === "stored") schedule.markStale(id);
    },

    async beforeUnloadDocument({ documentName: name, document }: beforeUnloadDocumentPayload) {
      const id = name.slice("asset:".length);
      if (!schedule.isStale(id)) return;
      try {
        await persist(id, Y.encodeStateAsUpdate(document), {
          editorId: null,
          withSnapshot: true,
        });
        schedule.written(id, now());
      } catch (error) {
        // Never block an unload on the snapshot: the state itself is stored.
        console.warn(`[unload] snapshot refresh failed for ${id}: ${(error as Error).message}`);
      }
    },

    async afterUnloadDocument({ documentName: name }) {
      const id = name.slice("asset:".length);
      editors.forget(name);
      schedule.forget(id);
      limitsByDoc.delete(id);
    },
  };

  return {
    name: "asset",
    noun: "asset",
    limits: defaults,
    snapshots: schedule,
    limitsFor,
    subject: (id) => documentName("asset", id),
    async read(id) {
      const live = options.documents().get(documentName("asset", id));
      const row = await store.load(id);
      if (!row) return null;
      return { state: live ? Y.encodeStateAsUpdate(live) : row.state, seed: row.seed };
    },
    async write(id, state) {
      const live = options.documents().get(documentName("asset", id));
      if (live) Y.applyUpdate(live, state, SERVER_APPLY_ORIGIN);
      const { outcome, merged } = await persist(id, live ? Y.encodeStateAsUpdate(live) : state, {
        editorId: null,
        withSnapshot: true,
      });
      if (outcome.kind === "stored" || outcome.kind === "unchanged") {
        schedule.written(id, now());
        if (live && merged) foldInto(live, merged);
      }
      return outcome.kind;
    },
    async admit(id, claims) {
      const head = await headOf(id);
      if (!head) throw new SyncRefusal(SYNC_CLOSE.revoked, "asset not found", "auth");
      limitsByDoc.set(id, limitsOfKind(head.kind));
      const live = options.documents().get(documentName("asset", id));
      const stored = live?.getMap("meta").get("layout");
      const layout = typeof stored === "number" ? stored : COLLAB_LAYOUT_VERSION;
      const granted = layoutGrant(claims, Math.max(layout, COLLAB_LAYOUT_VERSION));
      if (granted.readOnly || head.kind !== PREFAB_KIND || claims.f === undefined) return granted;
      // Prefab docs carry the scene format, so a v3 doc this side can't migrate stays read-only.
      const liveVersion = live?.getMap("meta").get("schemaVersion");
      const version =
        typeof liveVersion === "number"
          ? liveVersion
          : (head.schemaVersion ?? SCENE_FORMAT_VERSION);
      const reason = formatReadOnlyReason(claims.f, version, SCENE_FORMAT_VERSION);
      if (!reason) return {};
      return {
        readOnly: true,
        notice: JSON.stringify({ type: "scene-read-only", reason, schemaVersion: version }),
      };
    },
    persistence,
  };
}
