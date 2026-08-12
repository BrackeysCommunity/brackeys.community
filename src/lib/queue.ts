import type { Queue } from "bullmq";
import type IORedis from "ioredis";

declare global {
  // eslint-disable-next-line no-var
  var __brackeysRedis: IORedis | undefined;
  // eslint-disable-next-line no-var
  var __brackeysQueues: { notifications: Queue; email: Queue } | undefined;
}

// Dynamic imports keep bullmq + ioredis out of the SSR static graph entirely.
// Nitro's tracer was producing a partial `.output/server/node_modules/bullmq/`
// (ESM files present, CJS `main` missing), so any static `import` from the
// router would 500 at runtime. Loading the modules only when an enqueue
// actually happens sidesteps the tracer and keeps the client/server bundles
// free of redis client code.
async function getRedis(): Promise<IORedis> {
  if (globalThis.__brackeysRedis) return globalThis.__brackeysRedis;
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error("REDIS_URL is not set");
  }
  const { default: IORedisCtor } = await import("ioredis");
  globalThis.__brackeysRedis = new IORedisCtor(url, {
    // bullmq requirement: blocking commands must be allowed to retry indefinitely.
    maxRetriesPerRequest: null,
    // Producer-side connection only (workers hold their own): reject enqueues
    // immediately while disconnected instead of buffering them forever, so
    // callers' best-effort try/catch actually gets an error to catch.
    enableOfflineQueue: false,
    // Back off to 30s between reconnect attempts so a dead Redis doesn't
    // spam the logs on every retry (bullmq logs each connection error).
    retryStrategy: (times) => Math.min(times * 500, 30_000),
  });
  let lastError = "";
  globalThis.__brackeysRedis.on("error", (err) => {
    if (err.message === lastError) return;
    lastError = err.message;
    console.warn("[queue] redis error", err.message);
  });
  return globalThis.__brackeysRedis;
}

async function getQueues(): Promise<{ notifications: Queue; email: Queue }> {
  if (globalThis.__brackeysQueues) return globalThis.__brackeysQueues;
  const connection = await getRedis();
  const { Queue: QueueCtor } = await import("bullmq");
  globalThis.__brackeysQueues = {
    notifications: new QueueCtor("notifications", { connection }),
    email: new QueueCtor("email", { connection }),
  };
  return globalThis.__brackeysQueues;
}

export async function getNotificationsQueue(): Promise<Queue> {
  return (await getQueues()).notifications;
}

export async function getEmailQueue(): Promise<Queue> {
  return (await getQueues()).email;
}

export type NotificationJobName = "side_effects" | "weekly_digests";
export type NotificationSideEffectsJob = { notificationId: number };
