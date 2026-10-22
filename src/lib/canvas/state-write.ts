/**
 * The one write path for a canvas's stored state, used by the web app's
 * saves, imports and restores and by `canvas-sync`'s live stores: lock,
 * merge, caps, version, store. Shared with services, so no `@/` imports,
 * and only encoded bytes cross in or out: the service's Hocuspocus doc
 * comes from its own Yjs and never reaches this module.
 *
 * Lock order is `canvases`, then `canvas_docs`, everywhere a transaction
 * takes both (the move into a team does the same), so a save racing a
 * move or a delete waits instead of deadlocking.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as Y from "yjs";

import { canvasDocs, canvasDocVersions, canvases, user } from "../../db/schema";
import { docFromState } from "./doc-state";
import { canvasNodes, deriveSnapshot, type JsonCanvas } from "./json-canvas";
import { CANVAS_LIMITS, VERSION_INTERVAL_MS } from "./limits";

export const EMPTY_STATE = Y.encodeStateAsUpdate(new Y.Doc());

export type VersionReason = "hourly" | "pre-restore" | "pre-link" | "pre-import" | "staff";

/** The web app's transaction and the service's both fit. */
export type CanvasWriteTx = Pick<
  NodePgDatabase<Record<string, never>>,
  "select" | "insert" | "update"
>;

/** Drizzle types `bytea` as Node's Buffer; this is a view, not a copy. */
export function bytea(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** The JSON Canvas copy of a stored state, sanitised for readers. */
export function snapshotOfState(state: Uint8Array): JsonCanvas {
  const doc = docFromState(state);
  try {
    return deriveSnapshot(doc);
  } finally {
    doc.destroy();
  }
}

/**
 * `always` writes the snapshot even when the state is unchanged (the
 * service refreshing a stale one); `when-changed` only alongside new state.
 */
export type SnapshotMode = "always" | "when-changed" | "never";

export type PreparedState =
  | { kind: "refused"; reason: "too-large" | "too-many-nodes"; bytes: number; nodes: number }
  | { kind: "unchanged" | "changed"; snapshot?: JsonCanvas; snapshotMs: number };

/**
 * Refuses `next` over a cap, notices when it changes nothing, and derives
 * the snapshot when one is wanted. `nodeCount` saves decoding `next` when
 * the caller already knows it.
 */
export function prepareState(
  stored: Uint8Array,
  next: Uint8Array,
  options: { nodeCount?: number; snapshot: SnapshotMode },
): PreparedState {
  const bytes = next.length;
  if (bytes > CANVAS_LIMITS.maxStateBytes) {
    return { kind: "refused", reason: "too-large", bytes, nodes: options.nodeCount ?? 0 };
  }
  const kind = sameBytes(next, stored) ? "unchanged" : "changed";
  const wantSnapshot =
    options.snapshot === "always" || (options.snapshot === "when-changed" && kind === "changed");
  if (options.nodeCount !== undefined && !wantSnapshot) {
    if (options.nodeCount > CANVAS_LIMITS.maxNodes) {
      return { kind: "refused", reason: "too-many-nodes", bytes, nodes: options.nodeCount };
    }
    return { kind, snapshotMs: 0 };
  }
  const started = performance.now();
  const doc = docFromState(next);
  try {
    const nodes = options.nodeCount ?? canvasNodes(doc).size;
    if (nodes > CANVAS_LIMITS.maxNodes) {
      return { kind: "refused", reason: "too-many-nodes", bytes, nodes };
    }
    if (!wantSnapshot) return { kind, snapshotMs: 0 };
    return { kind, snapshot: deriveSnapshot(doc), snapshotMs: performance.now() - started };
  } finally {
    doc.destroy();
  }
}

export interface LockedCanvas {
  teamId: string | null;
  deletedAt: Date | null;
}

/**
 * Locks the canvas row, then its stored state, for the rest of `tx`. Null
 * when the canvas doesn't exist. A trashed canvas is returned as it is;
 * the caller decides what that means.
 */
export async function lockCanvasState(
  tx: CanvasWriteTx,
  canvasId: string,
): Promise<{ canvas: LockedCanvas; stored: Uint8Array } | null> {
  const [canvas] = await tx
    .select({ teamId: canvases.teamId, deletedAt: canvases.deletedAt })
    .from(canvases)
    .where(eq(canvases.id, canvasId))
    .for("update");
  if (!canvas) return null;
  // FOR UPDATE can't lock a row that isn't there, so two first writes
  // would both read "nothing stored" and the second would clobber the
  // first. Make sure the row exists before locking it.
  await tx
    .insert(canvasDocs)
    .values({ canvasId, state: bytea(EMPTY_STATE) })
    .onConflictDoNothing();
  const [row] = await tx
    .select({ state: canvasDocs.state })
    .from(canvasDocs)
    .where(eq(canvasDocs.canvasId, canvasId))
    .for("update");
  return { canvas, stored: new Uint8Array(row!.state) };
}

/** Keeps `state` as a version; an hourly one only if the last is an hour old. */
async function takeVersion(
  tx: CanvasWriteTx,
  canvasId: string,
  state: Uint8Array,
  reason: VersionReason,
  now: Date,
): Promise<boolean> {
  if (reason === "hourly") {
    const [latest] = await tx
      .select({ takenAt: canvasDocVersions.takenAt })
      .from(canvasDocVersions)
      .where(and(eq(canvasDocVersions.docKind, "canvas"), eq(canvasDocVersions.docId, canvasId)))
      .orderBy(desc(canvasDocVersions.takenAt))
      .limit(1);
    if (latest && now.getTime() - latest.takenAt.getTime() < VERSION_INTERVAL_MS) return false;
  }
  await tx.insert(canvasDocVersions).values({
    docKind: "canvas",
    docId: canvasId,
    takenAt: now,
    reason,
    state: bytea(state),
    byteSize: state.length,
  });
  return true;
}

export interface MergeResult {
  next: Uint8Array;
  nodeCount?: number;
  /**
   * The version to keep before `next` lands. Left out, what was stored is
   * kept hourly, unless nothing was stored yet.
   */
  version?: { state: Uint8Array; reason: VersionReason };
}

export interface WriteInput {
  canvasId: string;
  /** Null for a write nobody in particular made. */
  editorId: string | null;
  /** Read under the lock when left out, so versions sort in write order. */
  now?: Date;
  snapshot: SnapshotMode;
  /** Runs once the locks are held; throws to refuse the write. */
  recheck?: (tx: CanvasWriteTx, canvas: LockedCanvas) => Promise<void>;
  /** Builds the next state from what's stored. Every write is a merge. */
  merge: (stored: Uint8Array) => MergeResult;
}

export type WriteOutcome =
  | { kind: "gone" }
  | { kind: "refused"; reason: "too-large" | "too-many-nodes"; bytes: number; nodes: number }
  | { kind: "unchanged"; state: Uint8Array; snapshot: boolean; snapshotMs: number }
  | {
      kind: "stored";
      state: Uint8Array;
      teamId: string | null;
      snapshot: boolean;
      snapshotMs: number;
      versioned: boolean;
    };

/**
 * The whole write inside the caller's transaction. A missing or trashed
 * canvas is `gone`, read under the lock so a delete that landed while this
 * waited is seen; over a cap is `refused`. Neither writes anything.
 */
export async function writeCanvasState(
  tx: CanvasWriteTx,
  input: WriteInput,
): Promise<WriteOutcome> {
  const { canvasId } = input;
  const locked = await lockCanvasState(tx, canvasId);
  if (!locked) return { kind: "gone" };
  await input.recheck?.(tx, locked.canvas);
  if (locked.canvas.deletedAt) return { kind: "gone" };

  const { stored } = locked;
  const merged = input.merge(stored);
  const prepared = prepareState(stored, merged.next, {
    nodeCount: merged.nodeCount,
    snapshot: input.snapshot,
  });
  if (prepared.kind === "refused") return prepared;
  const { snapshot, snapshotMs } = prepared;
  const snapshotColumns = snapshot ? { snapshot, nodeCount: snapshot.nodes.length } : {};

  if (prepared.kind === "unchanged") {
    if (snapshot) {
      await tx.update(canvases).set(snapshotColumns).where(eq(canvases.id, canvasId));
    }
    return { kind: "unchanged", state: stored, snapshot: snapshot != null, snapshotMs };
  }

  const now = input.now ?? new Date();
  const version =
    merged.version ??
    (stored.length > EMPTY_STATE.length ? { state: stored, reason: "hourly" as const } : null);
  const versioned = version
    ? await takeVersion(tx, canvasId, version.state, version.reason, now)
    : false;

  const next = merged.next;
  await tx
    .update(canvasDocs)
    .set({ state: bytea(next), updatedAt: now })
    .where(eq(canvasDocs.canvasId, canvasId));
  await tx
    .update(canvases)
    .set({
      byteSize: next.length,
      lastEditedAt: now,
      updatedAt: now,
      // An account deleted mid-session leaves its edits but not its name.
      ...(input.editorId
        ? {
            lastEditedById: sql`coalesce((select ${user.id} from ${user} where ${user.id} = ${input.editorId}), ${canvases.lastEditedById})`,
          }
        : {}),
      ...snapshotColumns,
    })
    .where(eq(canvases.id, canvasId));

  return {
    kind: "stored",
    state: next,
    teamId: locked.canvas.teamId,
    snapshot: snapshot != null,
    snapshotMs,
    versioned,
  };
}

/** Rebuilds the snapshot from what's stored, for a live doc leaving memory with a stale one. */
export async function refreshCanvasSnapshot(tx: CanvasWriteTx, canvasId: string): Promise<void> {
  const locked = await lockCanvasState(tx, canvasId);
  if (!locked) return;
  const snapshot = snapshotOfState(locked.stored);
  await tx
    .update(canvases)
    .set({ snapshot, nodeCount: snapshot.nodes.length })
    .where(eq(canvases.id, canvasId));
}
