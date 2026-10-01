/**
 * Canvas retention, a step of the notifications worker's lifecycle sweep.
 * Same import-graph-neutral shape as `notification-retention.ts`: relative
 * imports, schema + drizzle only, the caller's own drizzle handle.
 */
import { and, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";

import { canvasDocVersions, canvases } from "../db/schema";
import { SOFT_DELETE_DAYS, VERSION_RETENTION_DAYS } from "./canvas/limits";

// biome-ignore lint/suspicious/noExplicitAny: drizzle builder shape changes per env
type DbHandle = any;

const DAY_MS = 86_400_000;

export async function sweepCanvases(
  db: DbHandle,
  now: Date,
): Promise<{ canvasesPurged: number; versionsPruned: number }> {
  // Past the "Recently deleted" window: gone for good. Docs, members and
  // opens cascade; versions are polymorphic, so they go by hand first.
  const purgeBefore = new Date(now.getTime() - SOFT_DELETE_DAYS * DAY_MS);
  const expired = db
    .select({ id: canvases.id })
    .from(canvases)
    .where(and(isNotNull(canvases.deletedAt), lt(canvases.deletedAt, purgeBefore)));
  await db
    .delete(canvasDocVersions)
    .where(and(eq(canvasDocVersions.docKind, "canvas"), inArray(canvasDocVersions.docId, expired)));
  const purged = await db
    .delete(canvases)
    .where(and(isNotNull(canvases.deletedAt), lt(canvases.deletedAt, purgeBefore)))
    .returning({ id: canvases.id });

  // Old versions, except each document's newest: a canvas nobody has touched
  // in a month still keeps one version to go back to.
  const pruneBefore = new Date(now.getTime() - VERSION_RETENTION_DAYS * DAY_MS);
  const pruned = await db
    .delete(canvasDocVersions)
    .where(
      and(
        lt(canvasDocVersions.takenAt, pruneBefore),
        sql`${canvasDocVersions.id} <> (
          SELECT newest.id FROM ${canvasDocVersions} AS newest
          WHERE newest.doc_kind = ${canvasDocVersions.docKind}
            AND newest.doc_id = ${canvasDocVersions.docId}
          ORDER BY newest.taken_at DESC, newest.id DESC
          LIMIT 1
        )`,
      ),
    )
    .returning({ id: canvasDocVersions.id });

  return { canvasesPurged: purged.length, versionsPruned: pruned.length };
}
