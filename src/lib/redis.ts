import type IORedis from "ioredis";
import type { RedisOptions } from "ioredis";

/**
 * Shared constructor for every server-side Redis client. The defaults make
 * commands fail fast while the connection is down: with ioredis's offline
 * queue on, a command issued while disconnected buffers and never settles,
 * which hangs the request handler awaiting it (degrade-open try/catch never
 * fires on a promise that never rejects). Callers are expected to treat
 * Redis as best-effort and catch rejections.
 *
 * The dynamic import keeps ioredis out of the SSR static graph (see the
 * note in queue.ts about Nitro's tracer).
 */
export async function createRedisClient(
  name: string,
  options: RedisOptions = {},
): Promise<IORedis> {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL is not set");
  const { default: IORedisCtor } = await import("ioredis");
  const client = new IORedisCtor(url, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 2000,
    // Back off to 30s between reconnect attempts so a dead Redis doesn't
    // spam the logs on every retry.
    retryStrategy: (times) => Math.min(times * 500, 30_000),
    ...options,
  });
  let lastError = "";
  client.on("error", (err) => {
    if (err.message === lastError) return;
    lastError = err.message;
    console.warn(`[redis:${name}] ${err.message}`);
  });
  // A just-created client is still connecting, and with the offline queue
  // off any command issued before "ready" rejects immediately. Give the
  // healthy path a moment to establish; an unreachable Redis pays this
  // wait once per client, then every command fails fast.
  await new Promise<void>((resolve) => {
    if (client.status === "ready") {
      resolve();
      return;
    }
    const onReady = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      client.off("ready", onReady);
      resolve();
    }, 3000);
    timer.unref();
    client.once("ready", onReady);
  });
  return client;
}
