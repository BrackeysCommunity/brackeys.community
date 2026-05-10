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

function getRedis(): IORedis {
  if (!globalThis.__brackeysRedis) globalThis.__brackeysRedis = makeRedis();
  return globalThis.__brackeysRedis;
}

function getQueues(): { notifications: Queue; email: Queue } {
  if (!globalThis.__brackeysQueues) {
    const connection = getRedis();
    globalThis.__brackeysQueues = {
      notifications: new Queue("notifications", { connection }),
      email: new Queue("email", { connection }),
    };
  }
  return globalThis.__brackeysQueues;
}

// Lazy proxies: importing this module must not require REDIS_URL — the
// connection is only opened when a queue method is actually invoked. This
// keeps client-bundled paths (and tests that transitively import this file
// without mocking it) from crashing at module-eval time.
function lazyQueue(name: "notifications" | "email"): Queue {
  return new Proxy({} as Queue, {
    get(_target, prop, receiver) {
      const q = getQueues()[name] as unknown as Record<PropertyKey, unknown>;
      const value = Reflect.get(q, prop, receiver);
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(q) : value;
    },
  });
}

export const redis: IORedis = new Proxy({} as IORedis, {
  get(_target, prop, receiver) {
    const r = getRedis() as unknown as Record<PropertyKey, unknown>;
    const value = Reflect.get(r, prop, receiver);
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(r) : value;
  },
});

export const notificationsQueue: Queue = lazyQueue("notifications");
export const emailQueue: Queue = lazyQueue("email");

export type NotificationJobName = "side_effects" | "weekly_digests";
export type NotificationSideEffectsJob = { notificationId: number };
