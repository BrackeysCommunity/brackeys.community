/**
 * Retention for read notifications — step 6 of the notifications worker's
 * lifecycle sweep. Same import-graph-neutral shape as `jam-watch-sweep.ts`:
 * relative imports, schema + drizzle only, the caller's own drizzle handle.
 *
 * Read rows are the ones nobody is owed a look at any more; unread rows
 * stay until the reader deals with them, however old. The window is wider
 * than the weekly digest looks back, so a read row is never taken from
 * under a digest that would still have listed it.
 */
import { and, isNotNull, lt } from "drizzle-orm";

import { notifications } from "../db/schema";

// biome-ignore lint/suspicious/noExplicitAny: drizzle builder shape changes per env
type DbHandle = any;

export const READ_NOTIFICATION_RETENTION_DAYS = 30;

export async function sweepReadNotifications(db: DbHandle, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - READ_NOTIFICATION_RETENTION_DAYS * 86_400_000);
  const gone = await db
    .delete(notifications)
    .where(and(isNotNull(notifications.readAt), lt(notifications.readAt, cutoff)))
    .returning({ id: notifications.id });
  return gone.length;
}
