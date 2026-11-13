import type IORedis from "ioredis";

import { bestEffort } from "@/lib/posthog-server";
import { createRedisClient } from "@/lib/redis";

/** How announcements travel: JSON through `parse`, or a wire format of the broadcast's own. */
type BroadcastWire<T> =
  | {
      /** An announcement as it arrives, JSON-decoded, or null to drop it. */
      parse(raw: unknown): T | null;
      encode?: undefined;
      decode?: undefined;
    }
  | {
      parse?: undefined;
      /** An announcement as the channel carries it. */
      encode(event: T): string;
      /** A channel message, or null to drop it. */
      decode(message: string): T | null;
    };

export type BroadcastOptions<T> = BroadcastWire<T> & {
  /** Names the broadcast's Redis clients and its telemetry, and keys its per-instance state. */
  name: string;
  /** The Redis channel. */
  channel: string;
  /** Without `REDIS_URL`, fan announcements out on this instance; otherwise they go nowhere. */
  localWithoutRedis?: boolean;
  /**
   * `announce` hands the event to this instance's listeners at once, then
   * publishes it; with Redis they hear it again through the subscriber, so
   * their listeners must take an event twice.
   */
  deliverHere?: boolean;
  /** Fields a failed announce reports with. */
  context?(event: T): Record<string, unknown>;
};

/** The part of an ioredis client a broadcast's subscriber uses. */
export type BroadcastSubscriber = {
  status: string;
  // biome-ignore lint/suspicious/noExplicitAny: ioredis types each event's listener separately
  on(event: "message" | "ready", listener: (...args: any[]) => void): unknown;
  subscribe(channel: string): Promise<unknown>;
};

/**
 * Subscribes `client` to `channel` now if it is ready and again on every
 * `ready`, not once up front: with the offline queue off, a subscribe issued
 * while the socket is connecting rejects, and ioredis re-subscribes only
 * channels that had already succeeded. Answers the stop, after which a
 * reconnect subscribes nothing.
 */
export function subscribeOnReady(
  client: BroadcastSubscriber,
  channel: string,
  onError: (err: unknown) => void = () => {},
): () => void {
  let stopped = false;
  const subscribe = () => {
    if (!stopped) void client.subscribe(channel).catch(onError);
  };
  client.on("ready", subscribe);
  if (client.status === "ready") subscribe();
  return () => {
    stopped = true;
  };
}

/** Redis clients in place of the broadcast's own, which it opens only when `REDIS_URL` is set. */
export type BroadcastRedis = {
  subscriber?: () => Promise<BroadcastSubscriber>;
  publish?: (channel: string, message: string) => Promise<unknown>;
};

export type Broadcast<T> = {
  /** Best effort: with Redis down nobody hears it, so listeners keep a fallback (a poll, a refetch). */
  announce(event: T, redis?: BroadcastRedis): Promise<void>;
  /** Only publishes, whatever `deliverHere` and `localWithoutRedis` say. Best effort. */
  publish(event: T, redis?: BroadcastRedis): Promise<void>;
  /** Listen on this instance; answers the unsubscribe. */
  listen(fn: (event: T) => void, redis?: BroadcastRedis): Promise<() => void>;
};

type BroadcastSlot = {
  publisher?: Promise<IORedis>;
  subscriber?: Promise<BroadcastSubscriber>;
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
 * listeners through the subscriber, this instance's included, and also at
 * once with `deliverHere`; without `REDIS_URL` they reach this instance's
 * listeners when `localWithoutRedis` or `deliverHere` is set, and nobody
 * otherwise.
 */
export function createBroadcast<T>(opts: BroadcastOptions<T>): Broadcast<T> {
  const { name, channel } = opts;
  const scope = `${name.replaceAll("-", "_")}.publish`;

  const encode = (event: T): string => (opts.encode ? opts.encode(event) : JSON.stringify(event));
  const decode = (message: string): T | null => {
    if (opts.decode) return opts.decode(message);
    let raw: unknown;
    try {
      raw = JSON.parse(message);
    } catch {
      return null;
    }
    return opts.parse(raw);
  };
  /** What a listener here gets: the event as another instance would read it. */
  const deliverHere = (event: T) => {
    const heard = opts.decode ? opts.decode(encode(event)) : opts.parse(event);
    if (heard !== null) fanOut(slotFor(name), heard, name);
  };

  const ensureSubscriber = async (connect: () => Promise<BroadcastSubscriber>): Promise<void> => {
    const slot = slotFor(name);
    slot.subscriber ??= connect().then((client) => {
      client.on("message", (from: string, message: string) => {
        if (from !== channel) return;
        const event = decode(message);
        if (event !== null) fanOut(slotFor(name), event, name);
      });
      subscribeOnReady(client, channel);
      return client;
    });
    try {
      await slot.subscriber;
    } catch (err) {
      slot.subscriber = undefined;
      throw err;
    }
  };

  const defaultPublish = async (to: string, message: string): Promise<unknown> => {
    const slot = slotFor(name);
    slot.publisher ??= createRedisClient(name).catch((err: unknown) => {
      slot.publisher = undefined;
      throw err;
    });
    return (await slot.publisher).publish(to, message);
  };
  const publisherOf = (redis: BroadcastRedis) =>
    redis.publish ?? (process.env.REDIS_URL ? defaultPublish : null);

  const publish = async (
    event: T,
    send: (channel: string, message: string) => Promise<unknown>,
  ): Promise<void> => {
    await bestEffort(scope, { channel, ...opts.context?.(event) }, async () => {
      await send(channel, encode(event));
    });
  };

  return {
    async announce(event, redis = {}) {
      const send = publisherOf(redis);
      if (opts.deliverHere || (!send && opts.localWithoutRedis)) deliverHere(event);
      if (send) await publish(event, send);
    },
    async publish(event, redis = {}) {
      const send = publisherOf(redis);
      if (send) await publish(event, send);
    },
    async listen(fn, redis = {}) {
      const listener = (event: unknown) => fn(event as T);
      const slot = slotFor(name);
      slot.listeners.add(listener);
      const connect =
        redis.subscriber ??
        (process.env.REDIS_URL ? () => createRedisClient(`${name}-subscriber`) : null);
      if (connect) await ensureSubscriber(connect).catch(() => {});
      return () => {
        slot.listeners.delete(listener);
      };
    },
  };
}
