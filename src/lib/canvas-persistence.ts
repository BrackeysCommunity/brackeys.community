/**
 * The web app's writes of canvas state: the solo `save`, `create` with an
 * initial state, and version restores. `canvas-sync` keeps its own copy of
 * this sequence (it can't import `@/db`); the rules are the same.
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import * as Y from "yjs";

import { db } from "@/db";
import { canvasAttachments, canvasDocs, canvasDocVersions, canvases } from "@/db/schema";
import { docFromState } from "@/lib/canvas/doc-state";
import { canvasNodes, deriveSnapshot } from "@/lib/canvas/json-canvas";
import { CANVAS_LIMITS, VERSION_INTERVAL_MS } from "@/lib/canvas/limits";
import { repairPath } from "@/lib/canvas/paths";
import { isUniqueViolation } from "@/lib/pg-errors";

export const EMPTY_STATE = Y.encodeStateAsUpdate(new Y.Doc());

type VersionReason = "hourly" | "pre-restore" | "pre-link" | "pre-import" | "staff";

export class CanvasStateError extends Error {
  constructor(readonly reason: "too-large" | "too-many-nodes") {
    super(
      reason === "too-large"
        ? "This canvas is too large to save."
        : "This canvas has too many cards.",
    );
  }
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Drizzle types `bytea` as Node's Buffer; this is a view, not a copy. */
export function bytea(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

async function takeVersion(
  tx: Tx,
  canvasId: string,
  state: Uint8Array,
  reason: VersionReason,
  now: Date,
): Promise<void> {
  if (reason === "hourly") {
    const [latest] = await tx
      .select({ takenAt: canvasDocVersions.takenAt })
      .from(canvasDocVersions)
      .where(and(eq(canvasDocVersions.docKind, "canvas"), eq(canvasDocVersions.docId, canvasId)))
      .orderBy(desc(canvasDocVersions.takenAt))
      .limit(1);
    if (latest && now.getTime() - latest.takenAt.getTime() < VERSION_INTERVAL_MS) return;
  }
  await tx.insert(canvasDocVersions).values({
    docKind: "canvas",
    docId: canvasId,
    takenAt: now,
    reason,
    state: bytea(state),
    byteSize: state.length,
  });
}

/**
 * Locks the stored state, hands it to `change`, and writes back what comes
 * out with a fresh snapshot. Every write is a merge (the caller's `change`
 * applies onto what's stored), so two tabs or a stale client can't lose an
 * edit.
 *
 * Before a change lands, the stored state becomes a version: always under
 * `versionReason`, otherwise hourly. Returns the stored state after the write.
 */
export async function updateCanvasState(
  canvasId: string,
  userId: string,
  change: (stored: Uint8Array) => Uint8Array,
  options: { versionReason?: VersionReason; now?: Date } = {},
): Promise<Uint8Array> {
  const now = options.now ?? new Date();
  return db.transaction(async (tx) => {
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
    const stored = new Uint8Array(row!.state);

    const next = change(stored);
    if (sameBytes(next, stored)) return stored;
    if (next.length > CANVAS_LIMITS.maxStateBytes) throw new CanvasStateError("too-large");

    const doc = docFromState(next);
    try {
      if (canvasNodes(doc).size > CANVAS_LIMITS.maxNodes) {
        throw new CanvasStateError("too-many-nodes");
      }
      const snapshot = deriveSnapshot(doc);

      if (stored.length > EMPTY_STATE.length) {
        await takeVersion(tx, canvasId, stored, options.versionReason ?? "hourly", now);
      }
      await tx
        .update(canvasDocs)
        .set({ state: bytea(next), updatedAt: now })
        .where(eq(canvasDocs.canvasId, canvasId));
      await tx
        .update(canvases)
        .set({
          snapshot,
          nodeCount: snapshot.nodes.length,
          byteSize: next.length,
          lastEditedById: userId,
          lastEditedAt: now,
          updatedAt: now,
        })
        .where(eq(canvases.id, canvasId));
      return next;
    } finally {
      doc.destroy();
    }
  });
}

export async function readCanvasState(canvasId: string): Promise<Uint8Array> {
  const [row] = await db
    .select({ state: canvasDocs.state })
    .from(canvasDocs)
    .where(eq(canvasDocs.canvasId, canvasId));
  return row ? new Uint8Array(row.state) : EMPTY_STATE;
}

/**
 * Records an uploaded image in a scope at the first free path under
 * `wanted`, retrying past a path someone took in the meantime.
 */
export async function insertCanvasAttachment(values: {
  id: string;
  scope: { ownerId: string; teamId: string | null };
  wanted: string;
  imageKey: string;
  sha256: string;
  byteSize: number;
}): Promise<{ id: string; path: string }> {
  const { ownerId, teamId } = values.scope;
  const scopeWhere = teamId
    ? eq(canvasAttachments.teamId, teamId)
    : and(isNull(canvasAttachments.teamId), eq(canvasAttachments.ownerId, ownerId));

  for (let attempt = 0; ; attempt++) {
    const taken = new Set(
      (
        await db
          .select({ key: canvasAttachments.pathKey })
          .from(canvasAttachments)
          .where(and(scopeWhere, isNull(canvasAttachments.deletedAt)))
      ).map((row) => row.key),
    );
    const path = repairPath(values.wanted, "image", (key) => taken.has(key));
    try {
      await db.insert(canvasAttachments).values({
        id: values.id,
        ownerId,
        teamId,
        path,
        imageKey: values.imageKey,
        sha256: values.sha256,
        byteSize: values.byteSize,
      });
      return { id: values.id, path };
    } catch (error) {
      if (!isUniqueViolation(error) || attempt >= 3) throw error;
    }
  }
}
