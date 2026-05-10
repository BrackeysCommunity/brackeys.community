import { and, eq, gte } from "drizzle-orm";

import { db } from "@/db";
import { notifications, type NotificationEntityType, type NotificationType } from "@/db/schema";
import { notificationsQueue } from "@/lib/queue";

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
   * still surfaces it as unread, but no side-effect job is enqueued (no
   * duplicate emails / pushes).
   */
  dedupeWithin?: { ms: number };
};

type InsertResult = { id: number; deduped: boolean } | null;

async function insertNotification(params: NotifyParams): Promise<InsertResult> {
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
      return { id: existing.id, deduped: true };
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

  return row ? { id: row.id, deduped: false } : null;
}

/**
 * Records an in-app notification and enqueues async side-effects (email,
 * push, SSE broadcast) for the worker. The DB write is synchronous so the
 * bell badge reflects the new row on next poll; the enqueue is best-effort
 * and never fails the caller if Redis is unreachable.
 */
export async function notify(params: NotifyParams): Promise<void> {
  if (params.actorId && params.actorId === params.userId) return;
  if (process.env.DISABLE_NOTIFICATIONS === "1") return;

  const result = await insertNotification(params);
  if (!result) return;
  if (result.deduped) return;

  try {
    await notificationsQueue.add(
      "side_effects",
      { notificationId: result.id },
      {
        attempts: 3,
        backoff: { type: "exponential", delay: 1000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    );
  } catch (err) {
    console.warn("[notify] failed to enqueue side-effects", { id: result.id, err });
  }
}
