import { Queue } from "bullmq";
import IORedis from "ioredis";

declare global {
  // eslint-disable-next-line no-var
  var __brackeysRedis: IORedis | undefined;
  // eslint-disable-next-line no-var
  var __brackeysQueues: { notifications: Queue; email: Queue } | undefined;
}

function makeRedis(): IORedis {
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error("REDIS_URL is not set");
  }
  return new IORedis(url, {
    // bullmq requirement: blocking commands must be allowed to retry indefinitely.
    maxRetriesPerRequest: null,
  });
}

export const redis: IORedis = globalThis.__brackeysRedis ?? makeRedis();
if (!globalThis.__brackeysRedis) globalThis.__brackeysRedis = redis;

function makeQueues() {
  return {
    notifications: new Queue("notifications", { connection: redis }),
    email: new Queue("email", { connection: redis }),
  };
}

const queues = globalThis.__brackeysQueues ?? makeQueues();
if (!globalThis.__brackeysQueues) globalThis.__brackeysQueues = queues;

export const notificationsQueue: Queue = queues.notifications;
export const emailQueue: Queue = queues.email;

export type NotificationJobName = "side_effects" | "weekly_digests";
export type NotificationSideEffectsJob = { notificationId: number };
