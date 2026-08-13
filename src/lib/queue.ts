import type { Queue } from "bullmq";
import type IORedis from "ioredis";

import { createRedisClient } from "@/lib/redis";

declare global {
  // eslint-disable-next-line no-var
  var __brackeysRedis: IORedis | undefined;
  // eslint-disable-next-line no-var
  var __brackeysQueues: { notifications: Queue } | undefined;
}

// Dynamic imports keep bullmq + ioredis out of the SSR static graph entirely.
// Nitro's tracer was producing a partial `.output/server/node_modules/bullmq/`
// (ESM files present, CJS `main` missing), so any static `import` from the
// router would 500 at runtime. Loading the modules only when an enqueue
// actually happens sidesteps the tracer and keeps the client/server bundles
// free of redis client code.
async function getRedis(): Promise<IORedis> {
  if (globalThis.__brackeysRedis) return globalThis.__brackeysRedis;
  globalThis.__brackeysRedis = await createRedisClient("queue", {
    // bullmq requirement: blocking commands must be allowed to retry indefinitely.
    maxRetriesPerRequest: null,
  });
  return globalThis.__brackeysRedis;
}

// The `email` queue is produced and consumed entirely inside
// services/notifications-worker; the app only ever enqueues notification
// side-effects.
async function getQueues(): Promise<{ notifications: Queue }> {
  if (globalThis.__brackeysQueues) return globalThis.__brackeysQueues;
  const connection = await getRedis();
  const { Queue: QueueCtor } = await import("bullmq");
  globalThis.__brackeysQueues = {
    notifications: new QueueCtor("notifications", { connection }),
  };
  return globalThis.__brackeysQueues;
}

export async function getNotificationsQueue(): Promise<Queue> {
  return (await getQueues()).notifications;
}

export type NotificationSideEffectsJob = { notificationId: number };
