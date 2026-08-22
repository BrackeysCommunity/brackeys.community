import { Queue } from "bullmq";

import { createBullRedis } from "../../../src/lib/bull-redis.ts";
import { NOTIFICATIONS_QUEUE } from "../../../src/lib/notify-core.ts";
import { config } from "./config.ts";

export const redis = createBullRedis(config.REDIS_URL);

// Dedicated publisher socket — sharing the subscriber/blocking connection
// with publish() leads to "Connection in subscriber mode" errors when
// bullmq holds a blocking command.
export const publisher = createBullRedis(config.REDIS_URL);

export { NOTIFICATIONS_QUEUE };
export const EMAIL_QUEUE = "email";

export const emailQueue = new Queue(EMAIL_QUEUE, { connection: redis });

export type NotificationSideEffectsJob = { notificationId: number };
export type SendEmailJob =
  | { kind: "transactional"; notificationId: number }
  | { kind: "digest"; userId: string; since: string };

export const presenceChannel = (userId: string) => `notifications:user:${userId}`;
export const presenceKey = (userId: string) => `sse:online:${userId}`;

export async function isUserOnline(userId: string): Promise<boolean> {
  const n = await redis.scard(presenceKey(userId));
  return n > 0;
}
