import type {
  beforeUnloadDocumentPayload,
  Extension,
  onChangePayload,
  onLoadDocumentPayload,
  onStoreDocumentPayload,
} from "@hocuspocus/server";
import { eq } from "drizzle-orm";
import * as Y from "yjs";

import { canvases, canvasDocs, teams } from "../../../src/db/schema.ts";
import { SYNC_LIMITS } from "../../../src/lib/canvas/limits.ts";
import { refreshCanvasSnapshot, writeCanvasState } from "../../../src/lib/canvas/state-write.ts";
import { parseDocumentName, SYNC_CLOSE, syncClose } from "../../../src/lib/canvas/sync-channels.ts";
import { SERVER_APPLY_ORIGIN } from "./apply.ts";
import type { ServiceDb } from "./db.ts";
import { SyncRefusal } from "./limits.ts";
import type { SyncMetrics } from "./telemetry.ts";

/** How often a store may bump its team's `last_activity_at`. */
const TEAM_TOUCH_INTERVAL_MS = 10 * 60 * 1000;

export function canvasIdOf(documentName: string): string | null {
  const parsed = parseDocumentName(documentName);
  return parsed?.kind === "canvas" ? parsed.id : null;
}

/**
 * When to rebuild a canvas's snapshot: at most every `intervalMs` while it's
 * edited, and always on the store that runs as the last person leaves.
 */
export class SnapshotSchedule {
  private readonly last = new Map<string, number>();
  private readonly stale = new Set<string>();

  constructor(private readonly intervalMs: number = SYNC_LIMITS.snapshotIntervalMs) {}

  due(canvasId: string, now: number, final: boolean): boolean {
    if (final) return true;
    const last = this.last.get(canvasId);
    return last === undefined || now - last >= this.intervalMs;
  }

  /** A store wrote state without rebuilding the snapshot. */
  markStale(canvasId: string): void {
    this.stale.add(canvasId);
  }

  isStale(canvasId: string): boolean {
    return this.stale.has(canvasId);
  }

  written(canvasId: string, now: number): void {
    this.last.set(canvasId, now);
    this.stale.delete(canvasId);
  }

  forget(canvasId: string): void {
    this.last.delete(canvasId);
    this.stale.delete(canvasId);
  }
}

export type StoreOutcome =
  | { kind: "gone" }
  | { kind: "unchanged"; snapshot: boolean }
  | { kind: "refused"; reason: "too-large" | "too-many-nodes" }
  | { kind: "stored"; snapshot: boolean; versioned: boolean };

interface StoreInput {
  canvasId: string;
  /** The live doc. What's stored is folded into it, then it is encoded and written. */
  document: Y.Doc;
  editorId: string | null;
  withSnapshot: boolean;
  now: Date;
}

/**
 * A live store through the shared write path. The merge runs on the live
 * doc rather than a scratch one: whatever is stored that this doc lacks
 * (another instance's or a solo save's work, deletions included) is folded
 * in, then the whole doc is encoded. Never `Y.mergeUpdates`, which keeps
 * deleted content forever.
 */
export async function storeCanvasState(
  db: ServiceDb,
  input: StoreInput,
  metrics?: SyncMetrics,
): Promise<StoreOutcome & { teamId?: string | null }> {
  const started = performance.now();
  let mergeMs = 0;
  const outcome = await db.transaction((tx) =>
    writeCanvasState(tx, {
      canvasId: input.canvasId,
      editorId: input.editorId,
      now: input.now,
      snapshot: input.withSnapshot ? "always" : "never",
      merge: (stored) => {
        const mergeStarted = performance.now();
        Y.applyUpdate(
          input.document,
          Y.diffUpdate(stored, Y.encodeStateVector(input.document)),
          SERVER_APPLY_ORIGIN,
        );
        const next = Y.encodeStateAsUpdate(input.document);
        const nodeCount = input.document.getMap("nodes").size;
        mergeMs = performance.now() - mergeStarted;
        return { next, nodeCount };
      },
    }),
  );

  switch (outcome.kind) {
    case "gone":
      return outcome;
    case "refused":
      if (metrics) metrics.storesRefused++;
      console.warn(
        `[store] refused ${input.canvasId}: ${outcome.reason} (${outcome.bytes} bytes, ${outcome.nodes} nodes)`,
      );
      return { kind: "refused", reason: outcome.reason };
    case "unchanged":
      if (outcome.snapshot) metrics?.snapshot(outcome.snapshotMs);
      return { kind: "unchanged", snapshot: outcome.snapshot };
    case "stored":
      if (outcome.snapshot) metrics?.snapshot(outcome.snapshotMs);
      metrics?.store(performance.now() - started, mergeMs, outcome.state.length);
      return {
        kind: "stored",
        snapshot: outcome.snapshot,
        versioned: outcome.versioned,
        teamId: outcome.teamId,
      };
  }
}

/** Rebuilds the snapshot from what's stored, for a doc leaving memory with a stale one. */
async function refreshSnapshot(db: ServiceDb, canvasId: string): Promise<void> {
  await db.transaction((tx) => refreshCanvasSnapshot(tx, canvasId));
}

export interface PersistenceOptions {
  db: ServiceDb;
  now: () => number;
  metrics: SyncMetrics;
  snapshots?: SnapshotSchedule;
  telemetry?: { captureException(error: unknown, properties?: Record<string, unknown>): void };
}

/**
 * Load and store for canvas docs. A store over the size or card cap is
 * refused, and everyone on the doc is closed with 4413 so no client keeps
 * resending the change that broke it; the doc then unloads, and the next
 * person to open it gets what's stored.
 */
export function createPersistence(options: PersistenceOptions): Extension & {
  snapshots: SnapshotSchedule;
} {
  const { db, now, metrics } = options;
  const snapshots = options.snapshots ?? new SnapshotSchedule();
  const lastEditor = new Map<string, string>();
  const teamTouchedAt = new Map<string, number>();

  async function touchTeam(teamId: string): Promise<void> {
    const at = now();
    if (at - (teamTouchedAt.get(teamId) ?? 0) < TEAM_TOUCH_INTERVAL_MS) return;
    teamTouchedAt.set(teamId, at);
    await db
      .update(teams)
      .set({ lastActivityAt: new Date(at) })
      .where(eq(teams.id, teamId));
  }

  return {
    extensionName: "canvas-persistence",
    snapshots,

    async onLoadDocument({ documentName }: onLoadDocumentPayload) {
      const canvasId = canvasIdOf(documentName);
      if (!canvasId) throw new SyncRefusal(SYNC_CLOSE.revoked, "not a canvas", "auth");
      const [row] = await db
        .select({ deletedAt: canvases.deletedAt, state: canvasDocs.state })
        .from(canvases)
        .leftJoin(canvasDocs, eq(canvasDocs.canvasId, canvases.id))
        .where(eq(canvases.id, canvasId));
      if (!row || row.deletedAt)
        throw new SyncRefusal(SYNC_CLOSE.revoked, "canvas deleted", "auth");
      return row.state ? new Uint8Array(row.state) : undefined;
    },

    async onChange({ documentName, transactionOrigin }: onChangePayload) {
      const origin = transactionOrigin as {
        source?: string;
        connection?: { context?: { userId?: string } };
      };
      const userId =
        origin?.source === "connection" ? origin.connection?.context?.userId : undefined;
      if (userId) lastEditor.set(documentName, userId);
    },

    async onStoreDocument({ documentName, document, instance }: onStoreDocumentPayload) {
      const canvasId = canvasIdOf(documentName);
      if (!canvasId) return;
      const at = now();
      // Read at store time, not from the payload: that was captured when the
      // change came in, and the last person may have left since.
      const final = document.getConnectionsCount() === 0;
      const withSnapshot = snapshots.due(canvasId, at, final);
      let outcome: Awaited<ReturnType<typeof storeCanvasState>>;
      try {
        outcome = await storeCanvasState(
          db,
          {
            canvasId,
            document,
            editorId: lastEditor.get(documentName) ?? null,
            withSnapshot,
            now: new Date(at),
          },
          metrics,
        );
      } catch (error) {
        metrics.storeFailures++;
        options.telemetry?.captureException(error, { canvas_id: canvasId, during: "store" });
        // Rethrown so Hocuspocus keeps the doc in memory for the next store.
        throw error;
      }

      if (outcome.kind === "refused") {
        for (const connection of document.getConnections()) {
          connection.close(syncClose(SYNC_CLOSE.tooLarge, "canvas too large"));
        }
        // Drop the oversized doc rather than serve it to the next person.
        setTimeout(() => void instance.unloadDocument(document), 0);
        return;
      }
      if (outcome.kind === "gone") {
        for (const connection of document.getConnections()) {
          connection.close(syncClose(SYNC_CLOSE.revoked, "canvas deleted"));
        }
        return;
      }
      if (outcome.snapshot) snapshots.written(canvasId, at);
      else if (outcome.kind === "stored") snapshots.markStale(canvasId);
      if (outcome.kind === "stored" && outcome.teamId) {
        await touchTeam(outcome.teamId).catch((error: unknown) => {
          console.warn(`[store] team touch failed: ${(error as Error).message}`);
        });
      }
    },

    async beforeUnloadDocument({ documentName }: beforeUnloadDocumentPayload) {
      const canvasId = canvasIdOf(documentName);
      if (!canvasId || !snapshots.isStale(canvasId)) return;
      try {
        await refreshSnapshot(db, canvasId);
        snapshots.written(canvasId, now());
      } catch (error) {
        // Never block an unload on the snapshot: the state itself is stored.
        console.warn(
          `[unload] snapshot refresh failed for ${canvasId}: ${(error as Error).message}`,
        );
      }
    },

    async afterUnloadDocument({ documentName }) {
      const canvasId = canvasIdOf(documentName);
      lastEditor.delete(documentName);
      if (canvasId) snapshots.forget(canvasId);
    },
  };
}
