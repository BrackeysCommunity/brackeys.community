import {
  ENGINE_RELEASE_NOTICE_CHANNEL,
  formatEngineReleaseNotice,
  parseEngineReleaseNotice,
  type EngineReleaseNotice,
} from "@/lib/image-quarantine";
import { bestEffort } from "@/lib/posthog-server";
import { createRedisClient } from "@/lib/redis";

/**
 * Hosted releases whose hidden state changed, across processes: the
 * media-scan worker and every web instance publish on one Redis channel,
 * and each web instance keeps a single subscriber that hands every notice
 * to its frame cache. Best effort both ways; a process that misses one
 * reads the release again when its cache entry's TTL runs out.
 */

/** The part of an ioredis client the subscriber uses. */
export type NoticeSubscriber = {
  status: string;
  // biome-ignore lint/suspicious/noExplicitAny: ioredis types each event's listener separately
  on(event: "message" | "ready", listener: (...args: any[]) => void): unknown;
  subscribe(channel: string): Promise<unknown>;
};

export type FrameCacheNoticeDeps = {
  /** Default a Redis client of its own, when `REDIS_URL` is set. */
  subscriber?: () => Promise<NoticeSubscriber>;
  /** Default the shared publisher, when `REDIS_URL` is set. */
  publish?: (channel: string, message: string) => Promise<unknown>;
};

type Listener = (notice: EngineReleaseNotice) => void;

declare global {
  // eslint-disable-next-line no-var
  var __appReleaseNoticePublisher:
    | Promise<{ publish(channel: string, message: string): Promise<unknown> }>
    | undefined;
  // eslint-disable-next-line no-var
  var __appReleaseNoticeSubscriber: Promise<NoticeSubscriber> | undefined;
  // eslint-disable-next-line no-var
  var __appReleaseNoticeListeners: Set<Listener> | undefined;
}

function listeners(): Set<Listener> {
  globalThis.__appReleaseNoticeListeners ??= new Set();
  return globalThis.__appReleaseNoticeListeners;
}

const defaultSubscriber = (): Promise<NoticeSubscriber> =>
  createRedisClient("engine-release-notice-subscriber");

async function defaultPublish(channel: string, message: string): Promise<unknown> {
  globalThis.__appReleaseNoticePublisher ??= createRedisClient("engine-release-notice");
  return (await globalThis.__appReleaseNoticePublisher).publish(channel, message);
}

/** Hands a notice to this process's listeners at once, then to every other process's. Never throws. */
export async function announceReleaseChange(
  notice: EngineReleaseNotice,
  deps: FrameCacheNoticeDeps = {},
): Promise<void> {
  deliverHere(notice);
  await publishReleaseNotice(notice, deps);
}

/** Announces a change to every process's frame cache, this one's through Redis too. Never throws. */
export async function publishReleaseNotice(
  notice: EngineReleaseNotice,
  deps: FrameCacheNoticeDeps = {},
): Promise<void> {
  if (notice.releaseIds.length === 0 && notice.projectIds.length === 0) return;
  const publish = deps.publish ?? (process.env.REDIS_URL ? defaultPublish : null);
  if (!publish) return;
  await bestEffort(
    "engine_release_notice.publish",
    { releases: notice.releaseIds.length, projects: notice.projectIds.length },
    async () => {
      await publish(ENGINE_RELEASE_NOTICE_CHANNEL, formatEngineReleaseNotice(notice));
    },
  );
}

function deliverHere(notice: EngineReleaseNotice): void {
  for (const listener of listeners()) {
    try {
      listener(notice);
    } catch (error) {
      console.error("[frame-cache-notice] listener failed", error);
    }
  }
}

function deliver(channel: string, message: string): void {
  if (channel !== ENGINE_RELEASE_NOTICE_CHANNEL) return;
  const notice = parseEngineReleaseNotice(message);
  if (notice) deliverHere(notice);
}

async function ensureSubscriber(deps: FrameCacheNoticeDeps): Promise<void> {
  const connect = deps.subscriber ?? (process.env.REDIS_URL ? defaultSubscriber : null);
  if (!connect) return;
  globalThis.__appReleaseNoticeSubscriber ??= connect().then((client) => {
    client.on("message", deliver);
    // With the offline queue off a subscribe during a reconnect rejects, so
    // every `ready` subscribes again.
    const subscribe = () => void client.subscribe(ENGINE_RELEASE_NOTICE_CHANNEL).catch(() => {});
    client.on("ready", subscribe);
    if (client.status === "ready") subscribe();
    return client;
  });
  try {
    await globalThis.__appReleaseNoticeSubscriber;
  } catch {
    // Retried by the next caller; until then the cache's TTL bounds staleness.
    globalThis.__appReleaseNoticeSubscriber = undefined;
  }
}

/** Hears every notice published on this channel, from any process; returns the unsubscribe. */
export async function onReleaseNotice(
  listener: Listener,
  deps: FrameCacheNoticeDeps = {},
): Promise<() => void> {
  listeners().add(listener);
  await ensureSubscriber(deps);
  return () => {
    listeners().delete(listener);
  };
}
