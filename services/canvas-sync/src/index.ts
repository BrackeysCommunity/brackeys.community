import { type Extension, Hocuspocus } from "@hocuspocus/server";
import crossws from "crossws/adapters/bun";
import * as Y from "yjs";

import type { KindRegistry, QuotaPolicy } from "../../../packages/engine/project/index.ts";
import { CANVAS_LIMITS, SYNC_LIMITS } from "../../../src/lib/canvas/limits.ts";
import {
  type ApplyMessage,
  documentProject,
  type RevokeMessage,
  SYNC_CLOSE,
  syncClose,
} from "../../../src/lib/canvas/sync-channels.ts";
import type { SceneFormat } from "../../../src/lib/scene/doc-bytes.ts";
import {
  createServiceTelemetry,
  type ServiceTelemetry,
} from "../../../src/lib/service-telemetry.ts";
import { createAuthenticate, type SyncContext } from "./auth.ts";
import { holdAwarenessWhileConnected, pinAwareness } from "./awareness.ts";
import type { ServiceDb } from "./db.ts";
import { createAssetKind, type AssetKind } from "./engine/asset-kind.ts";
import type { EngineDocStore } from "./engine/doc-store.ts";
import { createProjectKind, type ProjectKind, type ProjectStore } from "./engine/project-kind.ts";
import { canvasKind, type DocumentKind, DocumentKinds } from "./kinds.ts";
import {
  ConnectionCaps,
  createMessageLimiter,
  DocumentGrowth,
  localLedger,
  SyncRefusal,
  type UserConnectionLedger,
} from "./limits.ts";
import { createPersistence, SnapshotSchedule } from "./persistence.ts";
import type { SyncChannelSource } from "./redis.ts";
import { noTombstones, RevocationList, type RevocationTombstones, revoke } from "./revoke.ts";
import { connectedUsers, localRoster, type PresenceRoster } from "./roster.ts";
import { createSceneKind, type SceneLimits, type SceneProjects } from "./scene/kind.ts";
import type { SnapshotRunner } from "./scene/snapshot.ts";
import type { SceneStore } from "./scene/store.ts";
import { reportMetrics, sampleEventLoopLag, SyncMetrics } from "./telemetry.ts";

/**
 * Bun's own cap on one websocket frame. Well above the 1 MB message cap,
 * so an oversize update reaches `beforeHandleMessage` and is refused with
 * 4413, which tells the client to stop. A frame Bun drops itself closes
 * with 1006, which the client can't tell from a network drop; its own size
 * guard keeps it from sending one.
 */
const MAX_FRAME_BYTES = 2 * CANVAS_LIMITS.maxStateBytes;

/**
 * A connection whose document fails to load (a corrupt row, a database
 * error, a canvas deleted mid-connect) reaches neither `connected` nor
 * `onDisconnect`: Hocuspocus only answers permission-denied and keeps the
 * socket. This is the one place that sees each such connection's context.
 */
class SyncHocuspocus extends Hocuspocus<SyncContext> {
  caps?: ConnectionCaps;

  override async createDocument(
    ...args: Parameters<Hocuspocus<SyncContext>["createDocument"]>
  ): ReturnType<Hocuspocus<SyncContext>["createDocument"]> {
    const context = args[4] as SyncContext | undefined;
    this.caps?.loadStarted(context);
    try {
      const document = await super.createDocument(...args);
      this.caps?.loaded(context);
      return document;
    } catch (error) {
      this.caps?.loadFailed(context);
      throw error;
    }
  }
}

export interface ServerOptions {
  /** 0 picks a free port. */
  port: number;
  secret: string;
  /** Hosts canvases; without it `canvas:` documents are refused. */
  db?: ServiceDb;
  /** Hosts scenes; without it `scene:` documents are refused. */
  sceneStore?: SceneStore;
  sceneLimits?: SceneLimits;
  /** The scene format this instance migrates to at load; the engine's by default. */
  sceneFormat?: SceneFormat;
  sceneSnapshots?: SnapshotRunner;
  /** Hosts project registries; without it `project:` documents are refused. */
  projectStore?: ProjectStore;
  /** Hosts asset docs; without it `asset:` documents are refused. */
  assetStore?: EngineDocStore;
  /** Checked before a new asset doc gets its row; everything fits by default. */
  quota?: QuotaPolicy;
  /** The asset kinds projects and asset docs are judged by; the engine's by default. */
  engineKinds?: KindRegistry;
  instanceId: string;
  /** Relays updates between instances; without it this instance stands alone. */
  redis?: Extension;
  channels?: SyncChannelSource;
  ledger?: UserConnectionLedger;
  /** Revokes published before this instance started listening. */
  tombstones?: RevocationTombstones;
  roster?: PresenceRoster;
  telemetry?: ServiceTelemetry;
  now?: () => number;
  debounceMs?: number;
  maxDebounceMs?: number;
  snapshotIntervalMs?: number;
  metricsWindowMs?: number;
}

export interface SyncServer {
  port: number;
  hocuspocus: Hocuspocus<SyncContext>;
  metrics: SyncMetrics;
  caps: ConnectionCaps;
  snapshots: SnapshotSchedule;
  handleRevoke(message: RevokeMessage): number;
  handleApply(message: ApplyMessage): Promise<boolean>;
  /** Stops accepting, closes every connection, stores what's pending and waits for docs to unload. */
  stop(timeoutMs?: number): Promise<void>;
}

/** What a scene's layout migration reaches of its project, when this instance hosts both kinds. */
function sceneProjects(
  projects: ProjectKind | undefined,
  assets: AssetKind | undefined,
): SceneProjects | undefined {
  if (!projects || !assets) return undefined;
  return {
    registry: (projectId) => projects.registry(projectId),
    updateRegistry: (projectId, state) => projects.update(projectId, state),
    readAsset: (docId) => assets.read(docId),
    writeAsset: (docId, state) => assets.write(docId, state),
  };
}

/** The Hocuspocus instance served by Bun, plus the routes Railway needs. */
export async function startServer(options: ServerOptions): Promise<SyncServer> {
  const now = options.now ?? Date.now;
  const telemetry = options.telemetry ?? createServiceTelemetry("canvas-sync");
  const metrics = new SyncMetrics();
  const ledger = options.ledger ?? localLedger;
  const tombstones = options.tombstones ?? noTombstones;
  const roster = options.roster ?? localRoster;
  const snapshots = new SnapshotSchedule(
    options.snapshotIntervalMs ?? SYNC_LIMITS.snapshotIntervalMs,
  );

  // Assigned below; the caps read live counts from it.
  let hocuspocus!: Hocuspocus<SyncContext>;
  const caps = new ConnectionCaps(
    {
      forDocument: (name) => hocuspocus.documents.get(name)?.getConnectionsCount() ?? 0,
      forUser: (userId) => {
        let count = 0;
        for (const document of hocuspocus.documents.values()) {
          for (const connection of document.getConnections()) {
            if ((connection.context as SyncContext | undefined)?.userId === userId) count++;
          }
        }
        return count;
      },
    },
    ledger,
    now,
  );

  const documents = () => hocuspocus.documents as ReadonlyMap<string, Y.Doc>;
  const hosted: DocumentKind[] = [];
  if (options.db) {
    const persistence = createPersistence({ db: options.db, now, metrics, snapshots, telemetry });
    hosted.push(canvasKind({ db: options.db, persistence, documents }));
  }
  let projectKind: ProjectKind | undefined;
  let assetKind: AssetKind | undefined;
  if (options.projectStore) {
    projectKind = createProjectKind({
      store: options.projectStore,
      documents,
      now,
      metrics,
      telemetry,
      quota: options.quota,
      kinds: options.engineKinds,
    });
    hosted.push(projectKind);
  }
  if (options.assetStore) {
    assetKind = createAssetKind({
      store: options.assetStore,
      documents,
      now,
      metrics,
      telemetry,
      kinds: options.engineKinds,
      snapshotIntervalMs: options.snapshotIntervalMs,
    });
    hosted.push(assetKind);
  }
  if (options.sceneStore) {
    hosted.push(
      createSceneKind({
        store: options.sceneStore,
        documents,
        now,
        metrics,
        telemetry,
        limits: options.sceneLimits,
        format: options.sceneFormat,
        snapshots: options.sceneSnapshots,
        snapshotIntervalMs: options.snapshotIntervalMs,
        projects: sceneProjects(projectKind, assetKind),
      }),
    );
  }
  /** A project's other docs may name its trash; the registry rechecks after they load or store. */
  const reviewProject = (name: string, doc?: Y.Doc) => {
    if (!projectKind || !(name.startsWith("scene:") || name.startsWith("asset:"))) return;
    const project = documentProject(name);
    if (project !== null) void projectKind.review(project, doc && { name, doc });
  };
  const kinds = new DocumentKinds(hosted);
  const revocations = new RevocationList();
  const authenticate = createAuthenticate({
    secret: options.secret,
    kinds,
    caps,
    revocations,
    tombstones,
    now,
  });
  const limitMessage = createMessageLimiter(now);
  const growth = new DocumentGrowth();
  const awarenessHolds = new Map<string, () => void>();
  // A revoke can land while a connect is still awaiting the canvas row, the
  // ledger or the doc load, when there is no socket yet for it to close.
  const isRevoked = (context: SyncContext) =>
    revocations.covers(context.subject, context.userId, context.mintedAt, now());

  const countRefusal = (error: unknown) => {
    if (error instanceof SyncRefusal) metrics.refused(error.metric);
    else metrics.refused("auth");
  };

  const sync = new SyncHocuspocus({
    name: options.instanceId,
    quiet: true,
    debounce: options.debounceMs ?? SYNC_LIMITS.storeDebounceMs,
    maxDebounce: options.maxDebounceMs ?? SYNC_LIMITS.storeMaxDebounceMs,
    extensions: [...(options.redis ? [options.redis] : []), kinds.extension()],
    async onAuthenticate(payload) {
      try {
        return await authenticate(payload);
      } catch (error) {
        countRefusal(error);
        throw error;
      }
    },
    async connected({ context, connection, documentName }) {
      caps.confirm(context.seat, context.userId);
      const document = hocuspocus.documents.get(documentName);
      if (document) roster.record(documentName, connectedUsers(document));
      if (connection.sessionId !== null) {
        metrics.refused("auth");
        connection.close(syncClose(SYNC_CLOSE.revoked, "unsupported document"));
      } else if (isRevoked(context)) {
        metrics.revocations++;
        connection.close(syncClose(SYNC_CLOSE.revoked));
      } else if (context.notice !== undefined) {
        connection.sendStateless(context.notice);
      }
    },
    async beforeHandleMessage({ connection, update, context, document, documentName }) {
      metrics.messages++;
      try {
        // The editor never multiplexes sessions on one socket; a session's
        // queued messages run before `connected` can close it.
        if (connection.sessionId !== null) {
          throw new SyncRefusal(SYNC_CLOSE.revoked, "unsupported document", "auth");
        }
        if (isRevoked(context)) {
          throw new SyncRefusal(SYNC_CLOSE.revoked, "access revoked", "auth");
        }
        const kind = kinds.get(context.kind);
        const limits =
          context.kind === "asset" && assetKind ? assetKind.limitsFor(context.docId) : kind?.limits;
        limitMessage(connection, update, limits);
        if (
          !context.readOnly &&
          growth.exceeds(
            documentName,
            update.byteLength,
            () => Y.encodeStateAsUpdate(document).byteLength,
            limits?.maxStateBytes,
          )
        ) {
          const tooLarge = `${kind?.noun ?? "document"} too large`;
          for (const other of document.getConnections()) {
            if (other !== connection) other.close(syncClose(SYNC_CLOSE.tooLarge, tooLarge));
          }
          throw new SyncRefusal(SYNC_CLOSE.tooLarge, tooLarge, "size");
        }
      } catch (error) {
        countRefusal(error);
        throw error;
      }
    },
    async beforeHandleAwareness({ connection, context, document, states }) {
      if (!connection || !context) return;
      const ownedElsewhere = new Set<number>();
      for (const other of document.getConnections()) {
        if (other !== connection)
          for (const id of document.getClients(other)) ownedElsewhere.add(id);
      }
      pinAwareness(states, context, ownedElsewhere);
    },
    async afterStoreDocument({ documentName }) {
      growth.stored(documentName);
      reviewProject(documentName);
    },
    async afterLoadDocument({ document, documentName }) {
      awarenessHolds.get(documentName)?.();
      awarenessHolds.set(documentName, holdAwarenessWhileConnected(document));
      reviewProject(documentName, document);
    },
    async afterUnloadDocument({ documentName }) {
      awarenessHolds.get(documentName)?.();
      awarenessHolds.delete(documentName);
      growth.forget(documentName);
    },
    async onDisconnect({ context, document, documentName }) {
      if (document) roster.record(documentName, connectedUsers(document));
      if (!context?.userId) return;
      // A socket that closed while its connection was being set up never reaches `connected`.
      caps.drop(context.seat, context.userId);
      caps.released(context.userId);
    },
  });
  sync.caps = caps;
  hocuspocus = sync;

  const ws = crossws({
    hooks: {
      open(peer) {
        // `peer.websocket` is a proxy whose methods lose `this` under Bun;
        // everything goes through the peer instead.
        const socket = {
          send: (data: Uint8Array) => peer.send(data),
          close: (code?: number, reason?: string) => peer.close(code, reason),
          get readyState() {
            return (peer.websocket as { readyState?: number }).readyState ?? 1;
          },
        };
        // Hocuspocus hands this same request to onAuthenticate, so it names the socket's seats.
        const request = peer.request as Request;
        const client = hocuspocus.handleConnection(socket, request);
        Object.assign(peer, { hp: client, hpRequest: request });
      },
      message(peer, message) {
        (peer as unknown as { hp?: { handleMessage(data: Uint8Array): void } }).hp?.handleMessage(
          message.uint8Array(),
        );
      },
      close(peer, event) {
        const { hp, hpRequest } = peer as unknown as {
          hp?: { handleClose(event: { code: number; reason: string }): void };
          hpRequest?: Request;
        };
        hp?.handleClose({ code: event.code ?? 1000, reason: event.reason ?? "" });
        if (hpRequest) caps.socketClosed(hpRequest);
      },
    },
  });

  const server = Bun.serve({
    port: options.port,
    websocket: { ...ws.websocket, maxPayloadLength: MAX_FRAME_BYTES },
    async fetch(request, srv) {
      if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
        return ws.handleUpgrade(request, srv);
      }
      const { pathname } = new URL(request.url);
      if (pathname === "/health") {
        return Response.json(
          {
            documents: hocuspocus.getDocumentsCount(),
            connections: hocuspocus.getConnectionsCount(),
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      }
      return new Response("Not found", { status: 404 });
    },
  });

  const handleRevoke = (message: RevokeMessage) => {
    revocations.record(message, now());
    const closed = revoke(hocuspocus.documents, message);
    metrics.revocations += closed;
    if (closed > 0)
      console.log(`[revoke] closed ${closed} connection(s) for ${JSON.stringify(message)}`);
    return closed;
  };
  const handleApply = async (message: ApplyMessage) => {
    try {
      const canvas = kinds.get("canvas");
      const applied = canvas?.apply ? await canvas.apply(message.canvasId) : false;
      if (applied) metrics.applies++;
      return applied;
    } catch (error) {
      telemetry.captureException(error, { canvas_id: message.canvasId, during: "apply" });
      return false;
    }
  };

  const stopChannels = options.channels
    ? await options.channels.start({ revoke: handleRevoke, apply: (m) => void handleApply(m) })
    : async () => {};
  const stopLag = sampleEventLoopLag(metrics);
  const stopReport = reportMetrics(
    metrics,
    telemetry,
    () => ({
      documents: hocuspocus.getDocumentsCount(),
      connections: hocuspocus.getConnectionsCount(),
    }),
    options.metricsWindowMs,
  );

  let stopping: Promise<void> | null = null;
  async function stop(timeoutMs = 25_000): Promise<void> {
    stopping ??= (async () => {
      // No new sockets; the open ones stay until their stores are done.
      void server.stop(false);
      await stopChannels();
      const unloaded = new Promise<void>((resolve) => {
        if (hocuspocus.getDocumentsCount() === 0) return resolve();
        hocuspocus.configuration.extensions.push({
          async afterUnloadDocument({ instance }) {
            if (instance.getDocumentsCount() === 0) resolve();
          },
        });
      });
      hocuspocus.closeConnections();
      hocuspocus.flushPendingStores();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timedOut = await Promise.race([
        unloaded.then(() => false),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(true), timeoutMs);
        }),
      ]);
      clearTimeout(timer);
      if (timedOut) {
        console.error(
          `[shutdown] ${hocuspocus.getDocumentsCount()} document(s) still loaded after ${timeoutMs}ms`,
        );
      }
      await hocuspocus.hooks("onDestroy", { instance: hocuspocus });
      await kinds.close();
      await ledger.close();
      await tombstones.close();
      await roster.close();
      stopLag();
      stopReport();
      // Now drop the sockets, so clients reconnect to whichever instance is up.
      await server.stop(true);
      await telemetry.shutdown();
    })();
    return stopping;
  }

  return {
    port: server.port ?? options.port,
    hocuspocus,
    metrics,
    caps,
    snapshots,
    handleRevoke,
    handleApply,
    stop,
  };
}

async function main() {
  const { config } = await import("./config.ts");
  const { createDb } = await import("./db.ts");
  const { postgresSceneStore } = await import("./scene/pg-store.ts");
  const { workerSnapshots } = await import("./scene/snapshot.ts");
  const { postgresAssetDocStore } = await import("./engine/doc-store.ts");
  const { postgresProjectStore } = await import("./engine/project-kind.ts");
  const { syncEnvPrefix } = await import("../../../src/lib/canvas/sync-channels.ts");
  const { pool, db } = createDb(config.DATABASE_URL);
  const prefix = syncEnvPrefix(config.RAILWAY_ENVIRONMENT_NAME);
  const telemetry = createServiceTelemetry("canvas-sync");

  let redisPieces: Pick<ServerOptions, "redis" | "channels" | "ledger" | "tombstones" | "roster"> =
    {};
  if (config.REDIS_URL) {
    const { createRedisExtension, redisChannels, redisLedger, redisRoster, redisTombstones } =
      await import("./redis.ts");
    redisPieces = {
      redis: createRedisExtension(config.REDIS_URL, prefix, config.INSTANCE_ID),
      channels: redisChannels(config.REDIS_URL, prefix),
      ledger: redisLedger(config.REDIS_URL, prefix, config.INSTANCE_ID),
      tombstones: redisTombstones(config.REDIS_URL, prefix),
      roster: redisRoster(config.REDIS_URL, prefix, config.INSTANCE_ID),
    };
  } else {
    console.warn("[boot] REDIS_URL unset: no relay between instances, no revokes from the web app");
  }

  const server = await startServer({
    port: config.PORT,
    secret: config.CANVAS_SYNC_SECRET,
    db,
    sceneStore: postgresSceneStore(db),
    sceneSnapshots: workerSnapshots(),
    projectStore: postgresProjectStore(db),
    assetStore: postgresAssetDocStore(db),
    instanceId: config.INSTANCE_ID,
    telemetry,
    debounceMs: config.STORE_DEBOUNCE_MS,
    ...redisPieces,
  });
  console.log(`[boot] canvas-sync ${config.INSTANCE_ID} listening on ${server.port} (${prefix})`);

  const shutdown = async (signal: string) => {
    console.log(
      `[shutdown] ${signal}: ${server.hocuspocus.getConnectionsCount()} connection(s), ${server.hocuspocus.getDocumentsCount()} document(s)`,
    );
    await server.stop(config.SHUTDOWN_TIMEOUT_MS);
    await pool.end().catch(() => {});
    console.log("[shutdown] done");
    process.exit(0);
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
}

if (import.meta.main) await main();
