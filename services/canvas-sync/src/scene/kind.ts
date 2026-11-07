import type {
  beforeUnloadDocumentPayload,
  Document,
  Extension,
  onChangePayload,
  onLoadDocumentPayload,
  onStoreDocumentPayload,
} from "@hocuspocus/server";
import * as Y from "yjs";

import { SYNC_LIMITS } from "../../../../src/lib/canvas/limits.ts";
import { documentName, SYNC_CLOSE, syncClose } from "../../../../src/lib/canvas/sync-channels.ts";
import {
  ENGINE_FORMAT,
  prepareLoadedState,
  type SceneFormat,
} from "../../../../src/lib/scene/doc-bytes.ts";
import { SCENE_LIMITS } from "../../../../src/lib/scene/limits.ts";
import { SERVER_APPLY_ORIGIN } from "../apply.ts";
import type { DocumentKind } from "../kinds.ts";
import { SyncRefusal } from "../limits.ts";
import { SnapshotSchedule } from "../persistence.ts";
import type { SyncMetrics } from "../telemetry.ts";
import { inlineSnapshots, type SnapshotRunner } from "./snapshot.ts";
import type { SceneStore, SceneWriteOutcome } from "./store.ts";

export interface SceneLimits {
  maxEntities: number;
  maxStateBytes: number;
  maxMessageBytes: number;
}

/**
 * Sent once connected to a client the scene kind connected read-only
 * because its engine reads another format version than the doc holds.
 * `engine-outdated`: reload to update. `server-outdated`: the doc is older
 * than the client's engine and this instance can't migrate it yet.
 */
export type SceneReadOnlyNotice = {
  type: "scene-read-only";
  reason: "engine-outdated" | "server-outdated";
  schemaVersion: number;
};

export interface SceneKindOptions {
  store: SceneStore;
  /** This instance's live docs, to read an open scene's version at connect. */
  documents: () => ReadonlyMap<string, Y.Doc>;
  now: () => number;
  metrics: SyncMetrics;
  telemetry?: { captureException(error: unknown, properties?: Record<string, unknown>): void };
  limits?: SceneLimits;
  /** The format this instance migrates scenes to at load. */
  format?: SceneFormat;
  snapshots?: SnapshotRunner;
  snapshotIntervalMs?: number;
}

const liveVersion = (doc: Y.Doc | undefined): number | null => {
  const v = doc?.getMap("meta").get("schemaVersion");
  return typeof v === "number" ? v : null;
};

/**
 * `scene:<id>`: a hosted scene. Only the server fills a new doc (from the
 * row's seed), migrates an older one at load, and merges every store into
 * what's stored through a scratch doc. A client whose engine reads another
 * format than the doc holds connects read-only.
 */
export function createSceneKind(options: SceneKindOptions): DocumentKind & {
  snapshots: SnapshotSchedule;
} {
  const { store, now, metrics } = options;
  const limits = options.limits ?? SCENE_LIMITS;
  const format = options.format ?? ENGINE_FORMAT;
  const runner = options.snapshots ?? inlineSnapshots(format.version);
  const schedule = new SnapshotSchedule(
    options.snapshotIntervalMs ?? SYNC_LIMITS.snapshotIntervalMs,
  );
  const lastEditor = new Map<string, string>();

  /**
   * Merges `live` into what's stored, in a scratch doc so neither side is
   * touched until the write lands, then folds whatever was stored that the
   * live doc lacked back into it. Never `Y.mergeUpdates`, which keeps
   * deleted content forever.
   */
  async function persist(
    sceneId: string,
    live: Uint8Array,
    edit: { editorId: string | null; withSnapshot: boolean },
  ): Promise<{ outcome: SceneWriteOutcome; merged: Y.Doc | null }> {
    const started = performance.now();
    let mergeMs = 0;
    let merged: Y.Doc | null = null;
    const outcome = await store.write(
      sceneId,
      async (stored) => {
        const mergeStarted = performance.now();
        const scratch = new Y.Doc();
        if (stored && stored.byteLength > 0) Y.applyUpdate(scratch, stored);
        Y.applyUpdate(scratch, live);
        const state = Y.encodeStateAsUpdate(scratch);
        const entities = scratch.getMap("entities").size;
        mergeMs = performance.now() - mergeStarted;
        merged = scratch;
        if (state.byteLength > limits.maxStateBytes) {
          return { refused: "too-large", bytes: state.byteLength, entities };
        }
        if (entities > limits.maxEntities) {
          return { refused: "too-many-entities", bytes: state.byteLength, entities };
        }
        const schemaVersion = liveVersion(scratch) ?? format.version;
        if (!edit.withSnapshot) return { state, schemaVersion };
        const snapshotStarted = performance.now();
        const snapshot = await runner.run(state);
        metrics.snapshot(performance.now() - snapshotStarted);
        return {
          state,
          schemaVersion,
          ...(snapshot?.text !== undefined && snapshot.hash !== undefined
            ? { snapshot: { text: snapshot.text, hash: snapshot.hash } }
            : {}),
        };
      },
      { editorId: edit.editorId, now: new Date(now()) },
    );
    if (outcome.kind === "stored")
      metrics.store(performance.now() - started, mergeMs, outcome.bytes);
    if (outcome.kind === "refused") {
      metrics.storesRefused++;
      console.warn(
        `[store] refused scene ${sceneId}: ${outcome.refused} (${outcome.bytes} bytes, ${outcome.entities} entities)`,
      );
    }
    return { outcome, merged };
  }

  function closeAll(document: Document, event: { code: number; reason: string }): void {
    for (const connection of document.getConnections()) connection.close(event);
  }

  const persistence: Extension = {
    extensionName: "scene-persistence",

    async onLoadDocument({ documentName: name }: onLoadDocumentPayload) {
      const sceneId = name.slice("scene:".length);
      const row = await store.load(sceneId);
      if (!row) throw new SyncRefusal(SYNC_CLOSE.revoked, "scene not found", "auth");
      const prepared = prepareLoadedState(sceneId, row.state, row.seed, format);
      if (prepared.seeded || prepared.migratedFrom !== null) {
        // Stored at once, so every instance and the next load start from it.
        const { outcome } = await persist(sceneId, prepared.state, {
          editorId: null,
          withSnapshot: true,
        });
        if (outcome.kind === "refused") {
          throw new SyncRefusal(SYNC_CLOSE.tooLarge, "scene too large", "size");
        }
        if (outcome.kind === "gone") {
          throw new SyncRefusal(SYNC_CLOSE.revoked, "scene not found", "auth");
        }
        schedule.written(sceneId, now());
      }
      return prepared.state;
    },

    async onChange({ documentName: name, transactionOrigin }: onChangePayload) {
      const origin = transactionOrigin as {
        source?: string;
        connection?: { context?: { userId?: string } };
      };
      const userId =
        origin?.source === "connection" ? origin.connection?.context?.userId : undefined;
      if (userId) lastEditor.set(name, userId);
    },

    async onStoreDocument({ documentName: name, document, instance }: onStoreDocumentPayload) {
      const sceneId = name.slice("scene:".length);
      const at = now();
      const final = document.getConnectionsCount() === 0;
      const withSnapshot = schedule.due(sceneId, at, final);
      let result: Awaited<ReturnType<typeof persist>>;
      try {
        result = await persist(sceneId, Y.encodeStateAsUpdate(document), {
          editorId: lastEditor.get(name) ?? null,
          withSnapshot,
        });
      } catch (error) {
        metrics.storeFailures++;
        options.telemetry?.captureException(error, { scene_id: sceneId, during: "store" });
        // Rethrown so Hocuspocus keeps the doc in memory for the next store.
        throw error;
      }
      const { outcome, merged } = result;
      if (outcome.kind === "refused") {
        closeAll(document, syncClose(SYNC_CLOSE.tooLarge, "scene too large"));
        setTimeout(() => void instance.unloadDocument(document), 0);
        return;
      }
      if (outcome.kind === "gone") {
        closeAll(document, syncClose(SYNC_CLOSE.revoked, "scene deleted"));
        return;
      }
      if (merged) {
        Y.applyUpdate(
          document,
          Y.encodeStateAsUpdate(merged, Y.encodeStateVector(document)),
          SERVER_APPLY_ORIGIN,
        );
      }
      if (withSnapshot) schedule.written(sceneId, at);
      else if (outcome.kind === "stored") schedule.markStale(sceneId);
    },

    async beforeUnloadDocument({ documentName: name, document }: beforeUnloadDocumentPayload) {
      const sceneId = name.slice("scene:".length);
      if (!schedule.isStale(sceneId)) return;
      try {
        await persist(sceneId, Y.encodeStateAsUpdate(document), {
          editorId: null,
          withSnapshot: true,
        });
        schedule.written(sceneId, now());
      } catch (error) {
        // Never block an unload on the snapshot: the state itself is stored.
        console.warn(
          `[unload] snapshot refresh failed for ${sceneId}: ${(error as Error).message}`,
        );
      }
    },

    async afterUnloadDocument({ documentName: name }) {
      lastEditor.delete(name);
      schedule.forget(name.slice("scene:".length));
    },
  };

  return {
    name: "scene",
    noun: "scene",
    limits,
    snapshots: schedule,
    subject: (id) => documentName("scene", id),
    async admit(id, claims) {
      if (claims.f === undefined) {
        throw new SyncRefusal(SYNC_CLOSE.unauthorized, "token carries no engine version", "auth");
      }
      const head = await store.head(id);
      if (!head) throw new SyncRefusal(SYNC_CLOSE.revoked, "scene not found", "auth");
      // A doc migrates to this instance's format at load, so once loaded it
      // holds at least that, and more when a newer instance wrote it.
      const version =
        liveVersion(options.documents().get(documentName("scene", id))) ??
        Math.max(format.version, head.schemaVersion ?? 0);
      if (claims.f === version) return {};
      const notice: SceneReadOnlyNotice = {
        type: "scene-read-only",
        reason: claims.f < version ? "engine-outdated" : "server-outdated",
        schemaVersion: version,
      };
      return { readOnly: true, notice: JSON.stringify(notice) };
    },
    persistence,
    close: () => runner.close(),
  };
}
