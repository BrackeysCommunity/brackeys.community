import type {
  beforeUnloadDocumentPayload,
  Extension,
  onChangePayload,
  onLoadDocumentPayload,
  onStoreDocumentPayload,
} from "@hocuspocus/server";
import { and, desc, eq, sql } from "drizzle-orm";
import * as Y from "yjs";

import { canvasDocs, canvasDocVersions, canvases, teams, user } from "../../../src/db/schema.ts";
import { VERSION_INTERVAL_MS, SYNC_LIMITS } from "../../../src/lib/canvas/limits.ts";
import { checkLiveStore, snapshotOfState } from "../../../src/lib/canvas/live-store.ts";
import { parseDocumentName, SYNC_CLOSE, syncClose } from "../../../src/lib/canvas/sync-channels.ts";
import { SERVER_APPLY_ORIGIN } from "./apply.ts";
import type { ServiceDb } from "./db.ts";
import { SyncRefusal } from "./limits.ts";
import type { SyncMetrics } from "./telemetry.ts";

const EMPTY_STATE = Y.encodeStateAsUpdate(new Y.Doc());

/** How often a store may bump its team's `last_activity_at`. */
const TEAM_TOUCH_INTERVAL_MS = 10 * 60 * 1000;

/** Drizzle types `bytea` as Buffer; this is a view, not a copy. */
function bytea(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

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
 * The service's copy of the web app's `updateCanvasState`, the rules the
 * same: one transaction, the row made to exist before it's locked (two
 * first stores would otherwise both read "nothing stored" and the second
 * would clobber the first), merge, caps, an hourly version of what was
 * stored, then the write.
 */
export async function storeCanvasState(
  db: ServiceDb,
  input: StoreInput,
  metrics?: SyncMetrics,
): Promise<StoreOutcome & { teamId?: string | null }> {
  const started = performance.now();
  return db.transaction(async (tx) => {
    const [canvas] = await tx
      .select({ id: canvases.id, teamId: canvases.teamId, deletedAt: canvases.deletedAt })
      .from(canvases)
      .where(eq(canvases.id, input.canvasId));
    // Trashed, too: its revoke may not have reached this instance.
    if (!canvas || canvas.deletedAt) return { kind: "gone" as const };

    await tx
      .insert(canvasDocs)
      .values({ canvasId: input.canvasId, state: bytea(EMPTY_STATE) })
      .onConflictDoNothing();
    const [row] = await tx
      .select({ state: canvasDocs.state })
      .from(canvasDocs)
      .where(eq(canvasDocs.canvasId, input.canvasId))
      .for("update");
    const stored = new Uint8Array(row!.state);

    // Merge on store, through the live doc rather than a second scratch doc:
    // fold in whatever is stored that this doc lacks (another instance's or
    // a solo save's work, deletions included), then encode the whole doc.
    // Never `Y.mergeUpdates`, which keeps deleted content forever.
    const mergeStarted = performance.now();
    Y.applyUpdate(
      input.document,
      Y.diffUpdate(stored, Y.encodeStateVector(input.document)),
      SERVER_APPLY_ORIGIN,
    );
    const merged = Y.encodeStateAsUpdate(input.document);
    const nodeCount = input.document.getMap("nodes").size;
    const mergeMs = performance.now() - mergeStarted;

    const prepared = checkLiveStore(stored, merged, nodeCount, input.withSnapshot);
    if (prepared.kind === "refused") {
      if (metrics) metrics.storesRefused++;
      console.warn(
        `[store] refused ${input.canvasId}: ${prepared.reason} (${merged.length} bytes, ${nodeCount} nodes)`,
      );
      return { kind: "refused" as const, reason: prepared.reason };
    }
    if (prepared.snapshot) metrics?.snapshot(prepared.snapshotMs);

    if (prepared.kind === "unchanged") {
      if (prepared.snapshot) {
        await tx
          .update(canvases)
          .set({ snapshot: prepared.snapshot, nodeCount: prepared.snapshot.nodes.length })
          .where(eq(canvases.id, input.canvasId));
      }
      return { kind: "unchanged" as const, snapshot: prepared.snapshot != null };
    }

    let versioned = false;
    if (stored.length > EMPTY_STATE.length) {
      const [latest] = await tx
        .select({ takenAt: canvasDocVersions.takenAt })
        .from(canvasDocVersions)
        .where(
          and(eq(canvasDocVersions.docKind, "canvas"), eq(canvasDocVersions.docId, input.canvasId)),
        )
        .orderBy(desc(canvasDocVersions.takenAt))
        .limit(1);
      if (!latest || input.now.getTime() - latest.takenAt.getTime() >= VERSION_INTERVAL_MS) {
        await tx.insert(canvasDocVersions).values({
          docKind: "canvas",
          docId: input.canvasId,
          takenAt: input.now,
          reason: "hourly",
          state: bytea(stored),
          byteSize: stored.length,
        });
        versioned = true;
      }
    }

    await tx
      .update(canvasDocs)
      .set({ state: bytea(merged), updatedAt: input.now })
      .where(eq(canvasDocs.canvasId, input.canvasId));
    await tx
      .update(canvases)
      .set({
        byteSize: merged.length,
        lastEditedAt: input.now,
        updatedAt: input.now,
        // An account deleted mid-session leaves its edits but not its name.
        ...(input.editorId
          ? {
              lastEditedById: sql`coalesce((select ${user.id} from ${user} where ${user.id} = ${input.editorId}), ${canvases.lastEditedById})`,
            }
          : {}),
        ...(prepared.snapshot
          ? { snapshot: prepared.snapshot, nodeCount: prepared.snapshot.nodes.length }
          : {}),
      })
      .where(eq(canvases.id, input.canvasId));

    metrics?.store(performance.now() - started, mergeMs, merged.length);
    return {
      kind: "stored" as const,
      snapshot: prepared.snapshot != null,
      versioned,
      teamId: canvas.teamId,
    };
  });
}

/** Rebuilds the snapshot from what's stored, for a doc leaving memory with a stale one. */
async function refreshSnapshot(db: ServiceDb, canvasId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ state: canvasDocs.state })
      .from(canvasDocs)
      .where(eq(canvasDocs.canvasId, canvasId))
      .for("update");
    if (!row) return;
    const snapshot = snapshotOfState(new Uint8Array(row.state));
    await tx
      .update(canvases)
      .set({ snapshot, nodeCount: snapshot.nodes.length })
      .where(eq(canvases.id, canvasId));
  });
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
