import { Queue } from "bullmq";
import IORedis from "ioredis";

import { config } from "./config.ts";

export const redis = new IORedis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
});

// Dedicated publisher socket — sharing the subscriber/blocking connection
// with publish() leads to "Connection in subscriber mode" errors when
// bullmq holds a blocking command.
export const publisher = new IORedis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
});

export const NOTIFICATIONS_QUEUE = "notifications";
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
