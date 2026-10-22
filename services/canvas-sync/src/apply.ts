import { eq } from "drizzle-orm";
import * as Y from "yjs";

import { canvasDocs } from "../../../src/db/schema.ts";
import { documentName } from "../../../src/lib/canvas/sync-channels.ts";
import type { ServiceDb } from "./db.ts";

/**
 * The origin of a server-side write applied to a live doc: not anyone's
 * edit, and already stored, so it skips the store debounce.
 */
export const SERVER_APPLY_ORIGIN = {
  source: "local",
  skipStoreHooks: true,
  context: { serverApply: true },
} as const;

/**
 * The web app wrote this canvas's stored state (a version restore, a solo
 * save) while it may be open here: load what's stored into the live doc so
 * connected editors see it. Stored state only ever grows by merges, so
 * applying it is idempotent and loses nothing live.
 */
export async function applyStoredState(
  documents: ReadonlyMap<string, Y.Doc>,
  db: ServiceDb,
  canvasId: string,
): Promise<boolean> {
  const live = documents.get(documentName("canvas", canvasId));
  if (!live) return false;
  const [row] = await db
    .select({ state: canvasDocs.state })
    .from(canvasDocs)
    .where(eq(canvasDocs.canvasId, canvasId));
  if (!row) return false;
  // Bytes only: the shared modules hold their own Yjs, so no Doc crosses over.
  Y.applyUpdate(live, new Uint8Array(row.state), SERVER_APPLY_ORIGIN);
  return true;
}
