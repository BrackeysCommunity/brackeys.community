import { Queue } from "bullmq";

import { createBullRedis } from "../../../src/lib/bull-redis.ts";
import {
  NOTIFICATIONS_QUEUE,
  recordNotification,
  SIDE_EFFECTS_JOB_OPTIONS,
  type NotifyParams,
} from "../../../src/lib/notify-core.ts";
import { config } from "./config.ts";
import { db } from "./db/client.ts";

const redis = createBullRedis(config.REDIS_URL);

const notificationsQueue = new Queue(NOTIFICATIONS_QUEUE, { connection: redis });

/**
 * The service-side `notify()` — same shared write path (`notify-core.ts`)
 * and the same `side_effects` job options as the app, so the resident
 * worker handles email/SSE for sweep notifications exactly like any
 * other. No dedupe window: the lifecycle stamps (`expiry_notified_at`,
 * `archive_warned_at`, the status flips) are what keep re-runs from
 * double-sending.
 */
export async function notify(
  params: Omit<NotifyParams, "actorId" | "dedupeWithin">,
): Promise<void> {
  const result = await recordNotification(db, { ...params, actorId: null });
  if (!result) return;

  try {
    await notificationsQueue.add(
      "side_effects",
      { notificationId: result.id },
      SIDE_EFFECTS_JOB_OPTIONS,
    );
  } catch (err) {
    console.warn("[notify] failed to enqueue side-effects", { id: result.id, err });
  }
}

export async function closeQueue(): Promise<void> {
  await notificationsQueue.close();
  redis.disconnect();
}
