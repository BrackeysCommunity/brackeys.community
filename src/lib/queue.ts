import type { Queue } from "bullmq";
import type IORedis from "ioredis";

import { MEDIA_SCAN_QUEUE } from "@/lib/media-scan-queue";
import { NOTIFICATIONS_QUEUE } from "@/lib/notify-core";
import { createRedisClient } from "@/lib/redis";

type Queues = { notifications: Queue; mediaScan: Queue };

declare global {
  // eslint-disable-next-line no-var
  var __brackeysRedis: IORedis | undefined;
  // eslint-disable-next-line no-var
  var __brackeysQueues: Queues | undefined;
}

// Dynamic imports keep bullmq + ioredis out of the SSR static graph, so the
// client/server bundles carry no redis client code. They do not affect what
// the tracer emits: bullmq is force-externalised and its traced copy is only
// loadable because `inlineRuntimeClosure` in vite.config.ts replaces it.
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
// side-effects and upload scans.
async function getQueues(): Promise<Queues> {
  if (globalThis.__brackeysQueues) return globalThis.__brackeysQueues;
  const connection = await getRedis();
  const { Queue: QueueCtor } = await import("bullmq");
  globalThis.__brackeysQueues = {
    notifications: new QueueCtor(NOTIFICATIONS_QUEUE, { connection }),
    mediaScan: new QueueCtor(MEDIA_SCAN_QUEUE, { connection }),
  };
  return globalThis.__brackeysQueues;
}

export async function getNotificationsQueue(): Promise<Queue> {
  return (await getQueues()).notifications;
}

/** Consumed by services/media-scan; the app only ever enqueues `upload` jobs. */
export async function getMediaScanQueue(): Promise<Queue> {
  return (await getQueues()).mediaScan;
}

export type NotificationSideEffectsJob = { notificationId: number };
