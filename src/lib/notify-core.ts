/**
 * Shared write path for notifications — consumed by the app's `notify()`
 * (src/lib/notifications.ts) and the lifecycle-sweep service's mirror.
 * Import-graph neutral, same contract as `unsubscribe.ts`: relative
 * imports only, schema + drizzle only, and the caller passes its own
 * drizzle handle so this module works in both environments.
 */
import { and, eq, gte } from "drizzle-orm";

import {
  notificationPreferences,
  notifications,
  type NotificationEntityType,
  type NotificationType,
} from "../db/schema";
import { NOTIFICATION_DEFAULTS } from "./notification-copy";

/**
 * Both the web app and the worker pass in their own drizzle handle —
 * see `unsubscribe.ts` for the precedent and rationale.
 */
// biome-ignore lint/suspicious/noExplicitAny: drizzle builder shape changes per env
type DbHandle = any;

export type NotifyParams = {
  userId: string;
  type: NotificationType;
  actorId?: string | null;
  entityType?: NotificationEntityType;
  entityId?: string;
  data?: Record<string, unknown>;
  /**
   * If set, suppresses creating a new row when an equivalent notification
   * (same userId+type+actorId+entityId) already exists within the window.
   * The existing row's createdAt is bumped and readAt cleared so the inbox
   * still surfaces it as unread, but no side-effect job should be enqueued
   * (no duplicate emails / pushes) — `recordNotification` returns null.
   */
  dedupeWithin?: { ms: number };
};

/** bullmq options every producer of `side_effects` jobs shares. */
export const SIDE_EFFECTS_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: "exponential", delay: 1000 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
} as const;

/**
 * Writes the notification row, honoring the user's channel preferences
 * and the dedupe window. Returns the new row's id when a side-effects job
 * should be enqueued, or null when nothing further should happen (all
 * channels off, deduped, or the insert produced no row).
 */
export async function recordNotification(
  db: DbHandle,
  params: NotifyParams,
): Promise<{ id: number } | null> {
  // A row is only worth writing if some channel will ever consume it. The
  // inbox filters on the resolved inApp flag at read time and the worker
  // gates email/digest per type, so an all-channels-off row would be pure
  // dead weight. Anything less than all-off still inserts: the worker
  // needs the row even when the inbox will never show it.
  const [pref] = await db
    .select({
      inApp: notificationPreferences.inApp,
      email: notificationPreferences.email,
      digest: notificationPreferences.digest,
    })
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.userId, params.userId),
        eq(notificationPreferences.type, params.type),
      ),
    )
    .limit(1);
  const fallback = NOTIFICATION_DEFAULTS[params.type];
  const inApp = pref?.inApp ?? fallback.inApp;
  const email = pref?.email ?? fallback.email;
  const digest = pref?.digest ?? fallback.digest;
  if (!inApp && !email && !digest) return null;

  if (params.dedupeWithin) {
    const cutoff = new Date(Date.now() - params.dedupeWithin.ms);
    const conditions = [
      eq(notifications.userId, params.userId),
      eq(notifications.type, params.type),
      gte(notifications.createdAt, cutoff),
    ];
    if (params.actorId) conditions.push(eq(notifications.actorId, params.actorId));
    if (params.entityId) conditions.push(eq(notifications.entityId, params.entityId));

    const [existing] = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(...conditions))
      .limit(1);

    if (existing) {
      await db
        .update(notifications)
        .set({ createdAt: new Date(), readAt: null })
        .where(eq(notifications.id, existing.id));
      return null;
    }
  }

  const [row] = await db
    .insert(notifications)
    .values({
      userId: params.userId,
      type: params.type,
      actorId: params.actorId ?? null,
      entityType: params.entityType,
      entityId: params.entityId,
      data: params.data ?? {},
    })
    .returning({ id: notifications.id });

  return row ? { id: row.id } : null;
}
