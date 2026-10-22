/**
 * The web app's writes of canvas state: the solo `save`, `create` with an
 * initial state, imports into an open canvas, and version restores. `canvas-sync` keeps its own copy of
 * this sequence (it can't import `@/db`); the rules are the same.
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import * as Y from "yjs";

import { db } from "@/db";
import { canvasAttachments, canvasDocs, canvasDocVersions, canvases } from "@/db/schema";
import { docFromState, mergeStates } from "@/lib/canvas/doc-state";
import { canvasNodes, deriveSnapshot } from "@/lib/canvas/json-canvas";
import { CANVAS_LIMITS, VERSION_INTERVAL_MS } from "@/lib/canvas/limits";
import { repairPath } from "@/lib/canvas/paths";
import { isUniqueViolation } from "@/lib/pg-errors";

export const EMPTY_STATE = Y.encodeStateAsUpdate(new Y.Doc());

type VersionReason = "hourly" | "pre-restore" | "pre-link" | "pre-import" | "staff";

export class CanvasStateError extends Error {
  constructor(
    readonly reason: "too-large" | "too-many-nodes",
    message?: string,
  ) {
    super(
      message ??
        (reason === "too-large"
          ? "This canvas is too large to save."
          : "This canvas has too many cards."),
    );
  }
}

/** Bytes that don't decode as a Yjs update. */
export class CanvasUpdateError extends Error {
  constructor() {
    super("That update couldn't be read.");
  }
}

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Runs once the row lock is held and throws to refuse the write: what the
 * caller checked before it waited (a delete, hide or lost access) may have
 * changed meanwhile.
 */
export type Recheck = (tx: Tx) => Promise<void>;

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

/** The stored state, locked for the rest of `tx`. */
async function lockedState(tx: Tx, canvasId: string, recheck?: Recheck): Promise<Uint8Array> {
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
  await recheck?.(tx);
  return new Uint8Array(row!.state);
}

interface CapRefusals {
  tooLarge: (bytes: number) => CanvasStateError;
  tooManyNodes: (nodes: number) => CanvasStateError;
}

const SAVE_REFUSALS: CapRefusals = {
  tooLarge: () => new CanvasStateError("too-large"),
  tooManyNodes: () => new CanvasStateError("too-many-nodes"),
};

/** Writes `next` with a fresh snapshot, refusing it over a cap. */
async function writeState(
  tx: Tx,
  input: {
    canvasId: string;
    userId: string;
    next: Uint8Array;
    now: Date;
    refusals: CapRefusals;
    version?: { state: Uint8Array; reason: VersionReason };
  },
): Promise<void> {
  const { canvasId, next, now, refusals } = input;
  if (next.length > CANVAS_LIMITS.maxStateBytes) throw refusals.tooLarge(next.length);
  const doc = docFromState(next);
  try {
    const nodes = canvasNodes(doc).size;
    if (nodes > CANVAS_LIMITS.maxNodes) throw refusals.tooManyNodes(nodes);
    const snapshot = deriveSnapshot(doc);
    if (input.version) {
      await takeVersion(tx, canvasId, input.version.state, input.version.reason, now);
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
        lastEditedById: input.userId,
        lastEditedAt: now,
        updatedAt: now,
      })
      .where(eq(canvases.id, canvasId));
  } finally {
    doc.destroy();
  }
}

/**
 * Locks the stored state, hands it to `change`, and writes back what comes
 * out with a fresh snapshot. Every write is a merge (the caller's `change`
 * applies onto what's stored), so two tabs or a stale client can't lose an
 * edit.
 *
 * Before a change lands, the stored state becomes a version: always under
 * `versionReason`, otherwise hourly. Returns the stored state after the write.
 * `recheck` refuses the write once the lock is held; nothing is stored then.
 */
export async function updateCanvasState(
  canvasId: string,
  userId: string,
  change: (stored: Uint8Array) => Uint8Array,
  options: { versionReason?: VersionReason; now?: Date; recheck?: Recheck } = {},
): Promise<Uint8Array> {
  return db.transaction(async (tx) => {
    const stored = await lockedState(tx, canvasId, options.recheck);
    const next = change(stored);
    if (sameBytes(next, stored)) return stored;
    // Taken under the lock, so versions sort in the order they were written.
    const now = options.now ?? new Date();
    await writeState(tx, {
      canvasId,
      userId,
      next,
      now,
      refusals: SAVE_REFUSALS,
      version:
        stored.length > EMPTY_STATE.length
          ? { state: stored, reason: options.versionReason ?? "hourly" }
          : undefined,
    });
    return next;
  });
}

function formatMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const IMPORT_REFUSALS: CapRefusals = {
  tooLarge: (bytes) =>
    new CanvasStateError(
      "too-large",
      `This import would make the canvas ${formatMb(bytes)}; a canvas holds ${formatMb(CANVAS_LIMITS.maxStateBytes)}. Nothing was imported.`,
    ),
  tooManyNodes: (nodes) =>
    new CanvasStateError(
      "too-many-nodes",
      `This import would bring the canvas to ${nodes.toLocaleString("en-US")} cards; a canvas holds ${CANVAS_LIMITS.maxNodes.toLocaleString("en-US")}. Nothing was imported.`,
    ),
};

/**
 * An import into an open canvas, as one write under the row lock:
 * `base` (what the importing tab holds, which may be ahead of what's
 * stored while the canvas is live) is merged first and kept as a
 * `pre-import` version, then `imported` on top. The caps are checked
 * against that final state, so concurrent imports can't add up past them;
 * over a cap, nothing is written and the error names the numbers. An
 * import that adds nothing beyond the tab's own edits is written like a
 * save (with the usual hourly version); one that changes nothing writes
 * nothing, and `changed` is false.
 */
export async function importIntoCanvasState(
  canvasId: string,
  userId: string,
  base: Uint8Array,
  imported: Uint8Array,
  options: { now?: Date; recheck?: Recheck } = {},
): Promise<{ state: Uint8Array; changed: boolean }> {
  return db.transaction(async (tx) => {
    const stored = await lockedState(tx, canvasId, options.recheck);
    let before: Uint8Array;
    let next: Uint8Array;
    try {
      before = mergeStates(stored, base);
      next = mergeStates(before, imported);
    } catch {
      throw new CanvasUpdateError();
    }
    if (sameBytes(next, stored)) return { state: stored, changed: false };
    const now = options.now ?? new Date();
    const added = !sameBytes(next, before);
    await writeState(tx, {
      canvasId,
      userId,
      next,
      now,
      refusals: IMPORT_REFUSALS,
      version: added
        ? // Even of an empty canvas: restoring it is how an import is taken back.
          { state: before, reason: "pre-import" }
        : stored.length > EMPTY_STATE.length
          ? { state: stored, reason: "hourly" }
          : undefined,
    });
    return { state: next, changed: true };
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
