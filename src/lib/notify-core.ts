/**
 * Shared write path for notifications — consumed by the app's `notify()`
 * (src/lib/notifications.ts) and the workers' mirrors of it.
 * Import-graph neutral, same contract as `unsubscribe.ts`: relative
 * imports only, schema + drizzle only, and the caller passes its own
 * drizzle handle so this module works in both environments.
 */
import { and, desc, eq, gte } from "drizzle-orm";

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
  /**
   * If set, folds this notification into an existing one of the same
   * (userId, type, actorId) inside the window instead of adding a row:
   * the existing row's `data` becomes `merge(existing.data)`, it is
   * bumped to now and marked unread, and no side-effect job is enqueued.
   * For the case where eleven decisions in one sitting should read as one
   * line, not eleven. Unlike `dedupeWithin`, the entity is ignored — the
   * rows being folded are about different entities by design.
   */
  coalesceWithin?: {
    ms: number;
    merge: (existing: Record<string, unknown>) => Record<string, unknown>;
  };
};

/** bullmq options every producer of `side_effects` jobs shares. */
/**
 * The bullmq queue every producer (the app, the media-scan worker) and the
 * consumer (notifications-worker) meet on. One constant, because a typo'd
 * queue name is a silently-empty queue.
 */
export const NOTIFICATIONS_QUEUE = "notifications";

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

  if (params.coalesceWithin) {
    const cutoff = new Date(Date.now() - params.coalesceWithin.ms);
    const conditions = [
      eq(notifications.userId, params.userId),
      eq(notifications.type, params.type),
      gte(notifications.createdAt, cutoff),
    ];
    if (params.actorId) conditions.push(eq(notifications.actorId, params.actorId));

    const [existing] = await db
      .select({ id: notifications.id, data: notifications.data })
      .from(notifications)
      .where(and(...conditions))
      .orderBy(desc(notifications.createdAt))
      .limit(1);

    if (existing) {
      await db
        .update(notifications)
        .set({
          data: params.coalesceWithin.merge(existing.data ?? {}),
          createdAt: new Date(),
          readAt: null,
        })
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
