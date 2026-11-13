import type IORedis from "ioredis";

import { bestEffort } from "@/lib/posthog-server";
import { createRedisClient } from "@/lib/redis";

export type BroadcastOptions<T> = {
  /** Names the broadcast's Redis clients and its telemetry, and keys its per-instance state. */
  name: string;
  /** The Redis channel. */
  channel: string;
  /** An announcement as it arrives, or null to drop it. */
  parse(raw: unknown): T | null;
  /** Without `REDIS_URL`, fan announcements out on this instance; otherwise they go nowhere. */
  localWithoutRedis?: boolean;
  /** Fields a failed announce reports with. */
  context?(event: T): Record<string, unknown>;
};

export type Broadcast<T> = {
  /** Best effort: with Redis down nobody hears it, so listeners keep a fallback (a poll, a refetch). */
  announce(event: T): Promise<void>;
  /** Listen on this instance; answers the unsubscribe. */
  listen(fn: (event: T) => void): Promise<() => void>;
};

type BroadcastSlot = {
  publisher?: Promise<IORedis>;
  subscriber?: Promise<IORedis>;
  listeners: Set<(event: unknown) => void>;
};

declare global {
  // Survives HMR, so a reload keeps one subscriber per broadcast instead of leaking one per edit.
  // eslint-disable-next-line no-var
  var __appLiveBroadcasts: Map<string, BroadcastSlot> | undefined;
}

function slotFor(name: string): BroadcastSlot {
  globalThis.__appLiveBroadcasts ??= new Map();
  let slot = globalThis.__appLiveBroadcasts.get(name);
  if (!slot) {
    slot = { listeners: new Set() };
    globalThis.__appLiveBroadcasts.set(name, slot);
  }
  return slot;
}

function fanOut(slot: BroadcastSlot, event: unknown, name: string): void {
  for (const listener of slot.listeners) {
    try {
      listener(event);
    } catch (err) {
      console.warn(`[${name}] listener failed`, err);
    }
  }
}

/**
 * One Redis channel, one publisher and one subscriber per app instance,
 * fanned out in-process to every listener. With Redis, announcements reach
 * listeners only through the subscriber, this instance's included; without
 * `REDIS_URL` they reach this instance's listeners when `localWithoutRedis`
 * is set, and nobody otherwise.
 */
export function createBroadcast<T>(opts: BroadcastOptions<T>): Broadcast<T> {
  const { name, channel } = opts;
  const scope = `${name.replaceAll("-", "_")}.publish`;

  const deliver = (raw: unknown) => {
    const event = opts.parse(raw);
    if (event !== null) fanOut(slotFor(name), event, name);
  };

  const ensureSubscriber = async (): Promise<void> => {
    const slot = slotFor(name);
    slot.subscriber ??= createRedisClient(`${name}-subscriber`).then((client) => {
      client.on("message", (from: string, message: string) => {
        if (from !== channel) return;
        let raw: unknown;
        try {
          raw = JSON.parse(message);
        } catch {
          return;
        }
        deliver(raw);
      });
      // Re-subscribe on every `ready`: with the offline queue off, a
      // subscribe issued during a reconnect rejects.
      const subscribe = () => void client.subscribe(channel).catch(() => {});
      client.on("ready", subscribe);
      if (client.status === "ready") subscribe();
      return client;
    });
    try {
      await slot.subscriber;
    } catch (err) {
      slot.subscriber = undefined;
      throw err;
    }
  };

  return {
    async announce(event) {
      if (!process.env.REDIS_URL) {
        if (opts.localWithoutRedis) deliver(event);
        return;
      }
      await bestEffort(scope, { channel, ...opts.context?.(event) }, async () => {
        const slot = slotFor(name);
        slot.publisher ??= createRedisClient(name).catch((err: unknown) => {
          slot.publisher = undefined;
          throw err;
        });
        await (await slot.publisher).publish(channel, JSON.stringify(event));
      });
    },
    async listen(fn) {
      const listener = (event: unknown) => fn(event as T);
      const slot = slotFor(name);
      slot.listeners.add(listener);
      if (process.env.REDIS_URL) await ensureSubscriber().catch(() => {});
      return () => {
        slot.listeners.delete(listener);
      };
    },
  };
}
