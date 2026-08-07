import { Queue } from "bullmq";
import IORedis from "ioredis";

import type { NotificationEntityType, NotificationType } from "../../../src/db/schema.ts";
import { notifications } from "../../../src/db/schema.ts";
import { config } from "./config.ts";
import { db } from "./db/client.ts";

const redis = new IORedis(config.REDIS_URL, {
  // bullmq requirement: blocking commands must be allowed to retry
  // indefinitely.
  maxRetriesPerRequest: null,
});

const notificationsQueue = new Queue("notifications", { connection: redis });

/**
 * The service-side mirror of the app's `notify()` — same row shape, same
 * `side_effects` job with the same options, so the resident worker
 * handles email/SSE for sweep notifications exactly like any other. No
 * dedupe window: the lifecycle stamps (`expiry_notified_at`,
 * `archive_warned_at`, the status flips) are what keep re-runs from
 * double-sending.
 */
export async function notify(params: {
  userId: string;
  type: NotificationType;
  entityType?: NotificationEntityType;
  entityId?: string;
  data?: Record<string, unknown>;
}): Promise<void> {
  const [row] = await db
    .insert(notifications)
    .values({
      userId: params.userId,
      type: params.type,
      actorId: null,
      entityType: params.entityType,
      entityId: params.entityId,
      data: params.data ?? {},
    })
    .returning({ id: notifications.id });
  if (!row) return;

  try {
    await notificationsQueue.add(
      "side_effects",
      { notificationId: row.id },
      {
        attempts: 3,
        backoff: { type: "exponential", delay: 1000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    );
  } catch (err) {
    console.warn("[notify] failed to enqueue side-effects", { id: row.id, err });
  }
}

export async function closeQueue(): Promise<void> {
  await notificationsQueue.close();
  redis.disconnect();
}
