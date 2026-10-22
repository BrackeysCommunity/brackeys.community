import { Redis as RedisExtension } from "@hocuspocus/extension-redis";
import type {
  afterLoadDocumentPayload,
  afterUnloadDocumentPayload,
  beforeBroadcastStatelessPayload,
  beforeUnloadDocumentPayload,
  Document,
  Extension,
  Hocuspocus,
  onAwarenessUpdatePayload,
  onChangePayload,
  onConfigurePayload,
} from "@hocuspocus/server";
import IORedis, { type RedisOptions } from "ioredis";

import {
  applyChannel,
  type ApplyMessage,
  parseApplyMessage,
  parseRevokeMessage,
  PRESENCE_REFRESH_MS,
  PRESENCE_TTL_SECONDS,
  presenceInstancesKey,
  presenceKey,
  revokeChannel,
  type RevokeMessage,
  revokeTombstoneKeys,
} from "../../../src/lib/canvas/sync-channels.ts";
import type { UserConnectionLedger } from "./limits.ts";
import type { RevocationTombstones } from "./revoke.ts";
import type { PresenceRoster } from "./roster.ts";

/**
 * Fail fast while Redis is down: a command issued then rejects instead of
 * buffering forever, so a connect never hangs on the per-user cap.
 */
const FAST: RedisOptions = {
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
  connectTimeout: 2000,
  commandTimeout: 1000,
  retryStrategy: (times) => Math.min(times * 500, 30_000),
};

function quietErrors(client: IORedis, name: string): IORedis {
  let last = "";
  client.on("error", (err: Error) => {
    if (err.message === last) return;
    last = err.message;
    console.warn(`[redis:${name}] ${err.message}`);
  });
  return client;
}

/** How long a relay hook may hold up a document before it goes on without Redis. */
export const RELAY_HOOK_TIMEOUT_MS = 3000;

async function within(ms: number, work: Promise<unknown>, what: string): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settled = work.then(
    () => true,
    (error: Error) => {
      console.warn(`[redis:relay] ${what} failed: ${error.message}`);
      return false;
    },
  );
  const result = await Promise.race([
    settled,
    new Promise<false>((resolve) => {
      timer = setTimeout(() => {
        console.warn(`[redis:relay] ${what} timed out after ${ms}ms`);
        resolve(false);
      }, ms);
    }),
  ]);
  clearTimeout(timer);
  return result;
}

/**
 * extension-redis, made optional. It relays live updates and awareness
 * between instances, so two processes holding the same canvas during a
 * deploy converge in memory; nothing else depends on it. While Redis is
 * unreachable a document loads and edits as if this were the only
 * instance, and once Redis is back every loaded document announces its
 * state again so instances catch up.
 *
 * Its store lock is left out: every store merges with what's stored under
 * a row lock, so two instances storing one canvas can't lose each other's
 * edits, and a lock held elsewhere (or a Redis outage) never skips a store.
 */
export class ResilientRelay implements Extension {
  readonly extensionName = "redis-relay";
  readonly priority = 1000;
  private instance: Hocuspocus | null = null;
  /** Documents the relay has subscribed for. */
  private readonly attached = new Set<string>();

  constructor(
    readonly relay: RedisExtension,
    private readonly hookTimeoutMs = RELAY_HOOK_TIMEOUT_MS,
  ) {
    relay.sub.on("ready", () => this.resync());
  }

  private ready(): boolean {
    return this.relay.pub.status === "ready" && this.relay.sub.status === "ready";
  }

  private attach(documentName: string, document: Document): Promise<boolean> {
    const work = this.relay
      .afterLoadDocument({ documentName, document } as afterLoadDocumentPayload)
      .then(() => void this.attached.add(documentName));
    return within(this.hookTimeoutMs, work, `subscribe ${documentName}`);
  }

  /** Redis came (back) up: subscribe what loaded without it, and re-announce the rest. */
  private resync(): void {
    if (!this.instance) return;
    for (const [documentName, document] of this.instance.documents) {
      if (!this.attached.has(documentName)) void this.attach(documentName, document);
      else {
        // A state vector out; peers answer with what this instance lacks and ask for theirs.
        void this.relay.onChange({ documentName, document } as onChangePayload);
      }
    }
  }

  async onConfigure(payload: onConfigurePayload): Promise<void> {
    this.instance = payload.instance;
    await this.relay.onConfigure(payload);
  }

  async afterLoadDocument({ documentName, document }: afterLoadDocumentPayload): Promise<void> {
    if (!this.ready()) return;
    await this.attach(documentName, document);
  }

  async onChange(payload: onChangePayload): Promise<void> {
    if (this.ready()) await this.relay.onChange(payload);
  }

  async onAwarenessUpdate(payload: onAwarenessUpdatePayload): Promise<void> {
    if (this.ready()) await this.relay.onAwarenessUpdate(payload);
  }

  async beforeBroadcastStateless(payload: beforeBroadcastStatelessPayload): Promise<void> {
    if (this.ready())
      await within(this.hookTimeoutMs, this.relay.beforeBroadcastStateless(payload), "broadcast");
  }

  async beforeUnloadDocument(payload: beforeUnloadDocumentPayload): Promise<void> {
    // Lets the last relayed updates arrive before the doc goes.
    if (this.attached.has(payload.documentName)) await this.relay.beforeUnloadDocument(payload);
  }

  async afterUnloadDocument(payload: afterUnloadDocumentPayload): Promise<void> {
    if (payload.instance.documents.has(payload.documentName)) return;
    if (!this.attached.delete(payload.documentName)) return;
    await within(this.hookTimeoutMs, this.relay.afterUnloadDocument(payload), "unsubscribe");
  }

  async onDestroy(): Promise<void> {
    await within(this.hookTimeoutMs, this.relay.onDestroy(), "shutdown");
    // Its own teardown stops at the first failed command while Redis is down.
    this.relay.pub.disconnect(false);
    this.relay.sub.disconnect(false);
  }
}

export function createRedisExtension(
  url: string,
  prefix: string,
  identifier: string,
): ResilientRelay {
  let clients = 0;
  const relay = new RedisExtension({
    // The first client publishes (and fails fast while Redis is down); the
    // second subscribes, and keeps its queue so subscriptions resume.
    createClient: () =>
      clients++ === 0
        ? quietErrors(new IORedis(url, FAST), "relay")
        : quietErrors(new IORedis(url, { retryStrategy: FAST.retryStrategy }), "relay-sub"),
    prefix,
    identifier,
  });
  return new ResilientRelay(relay);
}

export interface SyncChannelHandlers {
  revoke(message: RevokeMessage): void;
  apply(message: ApplyMessage): void;
}

/** Where revoke and apply messages come from: Redis in production, a fake in tests. */
export interface SyncChannelSource {
  start(handlers: SyncChannelHandlers): Promise<() => Promise<void>>;
}

export function redisChannels(url: string, prefix: string): SyncChannelSource {
  return {
    async start(handlers) {
      const client = quietErrors(
        new IORedis(url, { retryStrategy: FAST.retryStrategy }),
        "channels",
      );
      const revoke = revokeChannel(prefix);
      const apply = applyChannel(prefix);
      client.on("message", (channel: string, raw: string) => {
        if (channel === revoke) {
          const message = parseRevokeMessage(raw);
          if (message) handlers.revoke(message);
        } else if (channel === apply) {
          const message = parseApplyMessage(raw);
          if (message) handlers.apply(message);
        }
      });
      // Subscriptions don't survive a reconnect on their own.
      const subscribe = () =>
        void client.subscribe(revoke, apply).catch((err: Error) => {
          console.warn(`[redis:channels] subscribe failed: ${err.message}`);
        });
      client.on("ready", subscribe);
      return async () => {
        client.disconnect();
      };
    },
  };
}

/** Each instance's per-user count lives this long unless refreshed, so a dead instance's seats free up. */
export const LEDGER_TTL_SECONDS = 90;
const LEDGER_REFRESH_MS = 30_000;

/**
 * The per-user connection cap across instances: one key per (user,
 * instance) holding that instance's count, with a TTL, plus a set of the
 * instances that have one. Any error reads as zero (fail open), since
 * refusing editors because Redis blinked is worse than a soft cap.
 */
export function redisLedger(url: string, prefix: string, instanceId: string): UserConnectionLedger {
  const client = quietErrors(new IORedis(url, FAST), "ledger");
  const counts = new Map<string, number>();
  const countKey = (userId: string, instance: string) => `${prefix}:conns:${userId}:${instance}`;
  const instancesKey = (userId: string) => `${prefix}:conn-instances:${userId}`;

  async function write(userId: string, count: number): Promise<void> {
    if (count > 0) {
      await client
        .multi()
        .set(countKey(userId, instanceId), String(count), "EX", LEDGER_TTL_SECONDS)
        .sadd(instancesKey(userId), instanceId)
        .expire(instancesKey(userId), LEDGER_TTL_SECONDS)
        .exec();
    } else {
      await client
        .multi()
        .del(countKey(userId, instanceId))
        .srem(instancesKey(userId), instanceId)
        .exec();
    }
  }

  const refresh = setInterval(() => {
    for (const [userId, count] of counts) void write(userId, count).catch(() => {});
  }, LEDGER_REFRESH_MS);
  refresh.unref?.();

  return {
    async othersCount(userId) {
      try {
        const instances = (await client.smembers(instancesKey(userId))).filter(
          (id) => id !== instanceId,
        );
        if (instances.length === 0) return 0;
        const values = await client.mget(...instances.map((id) => countKey(userId, id)));
        return values.reduce((sum, value) => sum + (Number(value) || 0), 0);
      } catch (error) {
        console.warn(`[ledger] count failed, allowing: ${(error as Error).message}`);
        return 0;
      }
    },
    async record(userId, count) {
      if (count > 0) counts.set(userId, count);
      else counts.delete(userId);
      await write(userId, count).catch(() => {});
    },
    async close() {
      clearInterval(refresh);
      await Promise.all([...counts.keys()].map((userId) => write(userId, 0).catch(() => {})));
      client.disconnect();
    },
  };
}

/**
 * The roster in Redis, as the web app reads it (`readPresence`). Best
 * effort: with Redis down "Live now" is empty, and nothing else depends on it.
 */
export function redisRoster(url: string, prefix: string, instanceId: string): PresenceRoster {
  const client = quietErrors(new IORedis(url, FAST), "roster");
  const current = new Map<string, string[]>();

  async function write(documentName: string, userIds: string[]): Promise<void> {
    const key = presenceKey(prefix, documentName, instanceId);
    const instances = presenceInstancesKey(prefix, documentName);
    if (userIds.length > 0) {
      await client
        .multi()
        .set(key, JSON.stringify(userIds), "EX", PRESENCE_TTL_SECONDS)
        .sadd(instances, instanceId)
        .expire(instances, PRESENCE_TTL_SECONDS)
        .exec();
    } else {
      await client.multi().del(key).srem(instances, instanceId).exec();
    }
  }

  const refresh = setInterval(() => {
    for (const [name, userIds] of current) void write(name, userIds).catch(() => {});
  }, PRESENCE_REFRESH_MS);
  refresh.unref?.();

  return {
    record(documentName, userIds) {
      if (userIds.length > 0) current.set(documentName, userIds);
      else current.delete(documentName);
      void write(documentName, userIds).catch(() => {});
    },
    async close() {
      clearInterval(refresh);
      const names = [...current.keys()];
      current.clear();
      await Promise.all(names.map((name) => write(name, []).catch(() => {})));
      client.disconnect();
    },
  };
}

/** Resolves once `client` is ready, or after `ms`; with the offline queue off a command sent sooner just fails. */
function whenReady(client: IORedis, ms: number): Promise<void> {
  if (client.status === "ready") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      client.off("ready", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    client.once("ready", done);
  });
}

/**
 * The web app's revoke tombstones. Fails open like the ledger: an instance
 * that can't read them falls back to the revokes it heard live. The first
 * connects after a boot wait briefly for the client, since a deploy
 * overlap is exactly when a tombstone matters.
 */
export function redisTombstones(url: string, prefix: string): RevocationTombstones {
  const client = quietErrors(new IORedis(url, FAST), "tombstones");
  return {
    async latest(canvasId, userId) {
      try {
        await whenReady(client, FAST.commandTimeout!);
        const values = await client.mget(...revokeTombstoneKeys(prefix, canvasId, userId));
        const times = values.map(Number).filter((at) => Number.isFinite(at) && at > 0);
        return times.length > 0 ? Math.max(...times) : null;
      } catch (error) {
        console.warn(`[tombstones] read failed, allowing: ${(error as Error).message}`);
        return null;
      }
    },
    async close() {
      client.disconnect();
    },
  };
}
