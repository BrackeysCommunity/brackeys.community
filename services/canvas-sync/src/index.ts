import { type Extension, Hocuspocus } from "@hocuspocus/server";
import crossws from "crossws/adapters/bun";
import * as Y from "yjs";

import { CANVAS_LIMITS, SYNC_LIMITS } from "../../../src/lib/canvas/limits.ts";
import {
  type ApplyMessage,
  type RevokeMessage,
  SYNC_CLOSE,
  syncClose,
} from "../../../src/lib/canvas/sync-channels.ts";
import {
  createServiceTelemetry,
  type ServiceTelemetry,
} from "../../../src/lib/service-telemetry.ts";
import { applyStoredState } from "./apply.ts";
import { createAuthenticate, type SyncContext } from "./auth.ts";
import { holdAwarenessWhileConnected, pinAwareness } from "./awareness.ts";
import type { ServiceDb } from "./db.ts";
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
  db: ServiceDb;
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

  const persistence = createPersistence({ db: options.db, now, metrics, snapshots, telemetry });
  const revocations = new RevocationList();
  const authenticate = createAuthenticate({
    secret: options.secret,
    db: options.db,
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
    revocations.covers(context.canvasId, context.userId, context.mintedAt, now());

  const countRefusal = (error: unknown) => {
    if (error instanceof SyncRefusal) metrics.refused(error.metric);
    else metrics.refused("auth");
  };

  const sync = new SyncHocuspocus({
    name: options.instanceId,
    quiet: true,
    debounce: options.debounceMs ?? SYNC_LIMITS.storeDebounceMs,
    maxDebounce: options.maxDebounceMs ?? SYNC_LIMITS.storeMaxDebounceMs,
    extensions: [...(options.redis ? [options.redis] : []), persistence],
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
        limitMessage(connection, update);
        if (
          context.access === "write" &&
          growth.exceeds(
            documentName,
            update.byteLength,
            () => Y.encodeStateAsUpdate(document).byteLength,
          )
        ) {
          for (const other of document.getConnections()) {
            if (other !== connection)
              other.close(syncClose(SYNC_CLOSE.tooLarge, "canvas too large"));
          }
          throw new SyncRefusal(SYNC_CLOSE.tooLarge, "canvas too large", "size");
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
    },
    async afterLoadDocument({ document, documentName }) {
      awarenessHolds.get(documentName)?.();
      awarenessHolds.set(documentName, holdAwarenessWhileConnected(document));
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
      const applied = await applyStoredState(hocuspocus.documents, options.db, message.canvasId);
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
