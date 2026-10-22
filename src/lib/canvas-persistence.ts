/**
 * The web app's writes of canvas state: the solo `save`, `create` with an
 * initial state, imports into an open canvas, and version restores, all
 * through the write path `canvas-sync` shares (`lib/canvas/state-write`).
 */
import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import { canvasAttachments, canvasDocs } from "@/db/schema";
import { mergeStates } from "@/lib/canvas/doc-state";
import { CANVAS_LIMITS } from "@/lib/canvas/limits";
import { repairPath } from "@/lib/canvas/paths";
import {
  type CanvasWriteTx,
  EMPTY_STATE,
  type LockedCanvas,
  type MergeResult,
  sameBytes,
  type VersionReason,
  writeCanvasState,
} from "@/lib/canvas/state-write";
import { isUniqueViolation } from "@/lib/pg-errors";

export { bytea, EMPTY_STATE } from "@/lib/canvas/state-write";

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

/** The canvas was deleted, or trashed, before the write got its lock. */
export class CanvasGoneError extends Error {
  constructor() {
    super("This canvas is gone.");
  }
}

/**
 * Runs once the row locks are held and throws to refuse the write: what the
 * caller checked before it waited (a delete, hide or lost access) may have
 * changed meanwhile.
 */
export type Recheck = (tx: CanvasWriteTx, canvas: LockedCanvas) => Promise<void>;

interface CapRefusals {
  tooLarge: (bytes: number) => CanvasStateError;
  tooManyNodes: (nodes: number) => CanvasStateError;
}

const SAVE_REFUSALS: CapRefusals = {
  tooLarge: () => new CanvasStateError("too-large"),
  tooManyNodes: () => new CanvasStateError("too-many-nodes"),
};

/** One write in its own transaction; anything but a store or a no-op throws and rolls back. */
async function write(
  canvasId: string,
  userId: string,
  refusals: CapRefusals,
  options: { now?: Date; recheck?: Recheck },
  merge: (stored: Uint8Array) => MergeResult,
): Promise<{ state: Uint8Array; changed: boolean }> {
  return db.transaction(async (tx) => {
    const outcome = await writeCanvasState(tx, {
      canvasId,
      editorId: userId,
      now: options.now,
      snapshot: "when-changed",
      recheck: options.recheck,
      merge,
    });
    switch (outcome.kind) {
      case "gone":
        throw new CanvasGoneError();
      case "refused":
        throw outcome.reason === "too-large"
          ? refusals.tooLarge(outcome.bytes)
          : refusals.tooManyNodes(outcome.nodes);
      default:
        return { state: outcome.state, changed: outcome.kind === "stored" };
    }
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
 * `recheck` refuses the write once the lock is held; nothing is stored then.
 */
export async function updateCanvasState(
  canvasId: string,
  userId: string,
  change: (stored: Uint8Array) => Uint8Array,
  options: { versionReason?: VersionReason; now?: Date; recheck?: Recheck } = {},
): Promise<Uint8Array> {
  const { state } = await write(canvasId, userId, SAVE_REFUSALS, options, (stored) => ({
    next: change(stored),
    version:
      options.versionReason && stored.length > EMPTY_STATE.length
        ? { state: stored, reason: options.versionReason }
        : undefined,
  }));
  return state;
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
  return write(canvasId, userId, IMPORT_REFUSALS, options, (stored) => {
    let before: Uint8Array;
    let next: Uint8Array;
    try {
      before = mergeStates(stored, base);
      next = mergeStates(before, imported);
    } catch {
      throw new CanvasUpdateError();
    }
    // Even of an empty canvas: restoring it is how an import is taken back.
    return {
      next,
      version: !sameBytes(next, before) ? { state: before, reason: "pre-import" } : undefined,
    };
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
