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
import { parseSceneId } from "../../../../src/lib/scene/ids.ts";
import { SCENE_LIMITS } from "../../../../src/lib/scene/limits.ts";
import {
  COLLAB_LAYOUT_VERSION,
  migrateSceneLayoutState,
  sceneLayoutNeeds,
  type HostedPrefabDoc,
} from "../../../../src/lib/scene/project-bytes.ts";
import { SERVER_APPLY_ORIGIN } from "../apply.ts";
import type { DocWriteOutcome } from "../engine/doc-store.ts";
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
 * because its engine reads another format version or collab layout than
 * the doc holds. `engine-outdated`: reload to update. `server-outdated`:
 * the doc is older than the client's engine and this instance can't
 * migrate it yet.
 */
export type SceneReadOnlyNotice = {
  type: "scene-read-only";
  reason: "engine-outdated" | "server-outdated";
  schemaVersion: number;
  /** The doc's collab layout, when the client's differs. */
  layout?: number;
};

/** What a layout-1 scene's migration at load reaches of its project. */
export interface SceneProjects {
  /** The project's registry, seeded; null with no project. */
  registry(projectId: string): Promise<Uint8Array | null>;
  /** Merges a registry state into the project with the duties done, so new doc entries have rows. */
  updateRegistry(projectId: string, state: Uint8Array): Promise<DocWriteOutcome["kind"]>;
  /** An asset doc (`<project>.<key>`) as it stands; null with no row. */
  readAsset(docId: string): Promise<HostedPrefabDoc | null>;
  /** Merges a state the server made into an asset doc. */
  writeAsset(docId: string, state: Uint8Array): Promise<DocWriteOutcome["kind"]>;
}

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
  /** Where a layout-1 scene's prefabs go at load; without it only a scene holding none migrates. */
  projects?: SceneProjects;
}

const liveVersion = (doc: Y.Doc | undefined): number | null => {
  const v = doc?.getMap("meta").get("schemaVersion");
  return typeof v === "number" ? v : null;
};

const liveLayout = (doc: Y.Doc | undefined): number | null => {
  const layout = doc?.getMap("meta").get("layout");
  return typeof layout === "number" ? layout : null;
};

/**
 * `scene:<project>.<key>`: a hosted scene. Only the server fills a new doc
 * (from the row's seed), migrates an older one at load (its format, and a
 * layout-1 doc's prefabs out into prefab docs of its project), and merges
 * every store into what's stored through a scratch doc. A client whose
 * engine reads another format or collab layout than the doc holds
 * connects read-only.
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

  /**
   * Moves a layout-1 scene's prefabs into prefab docs of its project: the
   * registry first (its duties make the rows), then the prefab docs, so the
   * scene, stored last, never loses a prefab its project doesn't hold yet.
   * The scene's new state; null when it needs nothing.
   */
  async function liftLayout(sceneId: string, state: Uint8Array): Promise<Uint8Array | null> {
    const needs = sceneLayoutNeeds(state, null);
    if (!needs) return null;
    const { project, key } = parseSceneId(sceneId)!;
    const projects = options.projects;
    let registry: Uint8Array | null = null;
    const prefabDocs = new Map<string, HostedPrefabDoc>();
    if (needs.prefabs.length > 0) {
      registry = (await projects?.registry(project)) ?? null;
      if (!projects || !registry) {
        throw new SyncRefusal(SYNC_CLOSE.revoked, "scene's project not found", "auth");
      }
      const keys = sceneLayoutNeeds(state, registry)?.keys ?? [];
      for (const k of keys) {
        const doc = await projects.readAsset(`${project}.${k}`);
        if (doc) prefabDocs.set(k, doc);
      }
    }
    const migration = migrateSceneLayoutState({
      scene: state,
      projectId: project,
      sceneKey: key,
      project: registry,
      prefabDocs,
      now: now(),
    });
    if (!migration) return null;
    if (projects && registry && (migration.project || migration.prefabs.length > 0)) {
      const written = await projects.updateRegistry(project, migration.project ?? registry);
      if (written === "gone") {
        throw new SyncRefusal(SYNC_CLOSE.revoked, "scene's project not found", "auth");
      }
      if (written === "refused")
        throw new SyncRefusal(SYNC_CLOSE.tooLarge, "project too large", "size");
      for (const prefab of migration.prefabs) {
        const outcome = await projects.writeAsset(`${project}.${prefab.key}`, prefab.state);
        // No row: the project's quota refused the prefab its entry.
        if (outcome === "gone" || outcome === "refused") {
          throw new SyncRefusal(
            SYNC_CLOSE.tooLarge,
            "scene's prefabs don't fit its project",
            "size",
          );
        }
      }
    }
    console.log(
      `[load] scene ${sceneId} moved to layout ${COLLAB_LAYOUT_VERSION}: ${migration.created.length} prefab(s) created, ${migration.kept.length} kept, ${migration.diverged.length} diverged`,
    );
    return migration.scene;
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
      const lifted = await liftLayout(sceneId, prepared.state);
      const state = lifted ?? prepared.state;
      if (prepared.seeded || prepared.migratedFrom !== null || lifted) {
        // Stored at once, so every instance and the next load start from it.
        const { outcome } = await persist(sceneId, state, {
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
      return state;
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
      // A doc migrates to this instance's format and layout at load, so once
      // loaded it holds at least those, and more when a newer instance wrote it.
      const live = options.documents().get(documentName("scene", id));
      const version = liveVersion(live) ?? Math.max(format.version, head.schemaVersion ?? 0);
      const layout = Math.max(liveLayout(live) ?? COLLAB_LAYOUT_VERSION, COLLAB_LAYOUT_VERSION);
      // A token without `l` comes from an engine older than collab layouts.
      const clientLayout = claims.l ?? 1;
      if (claims.f === version && clientLayout === layout) return {};
      const notice: SceneReadOnlyNotice = {
        type: "scene-read-only",
        reason: claims.f < version || clientLayout < layout ? "engine-outdated" : "server-outdated",
        schemaVersion: version,
        ...(clientLayout !== layout ? { layout } : {}),
      };
      return { readOnly: true, notice: JSON.stringify(notice) };
    },
    persistence,
    close: () => runner.close(),
  };
}
