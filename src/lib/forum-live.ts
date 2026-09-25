import type IORedis from "ioredis";

import { bestEffort } from "@/lib/posthog-server";
import { createRedisClient } from "@/lib/redis";

/**
 * "N new posts": every published forum post is announced on one Redis
 * channel, and each app instance keeps a single subscriber that fans the
 * announcement out to its open `/api/forum/stream` connections. One socket
 * per instance rather than per reader, since every reader wants the same
 * broadcast.
 */

const CHANNEL = "forum:new-posts";

export type ForumLiveEvent = {
  id: number;
  kind: string;
  category: string;
  authorId: string | null;
};

declare global {
  // eslint-disable-next-line no-var
  var __brackeysForumLivePublisher: IORedis | undefined;
  // eslint-disable-next-line no-var
  var __brackeysForumLiveSubscriber: Promise<IORedis> | undefined;
  // eslint-disable-next-line no-var
  var __brackeysForumLiveListeners: Set<(event: ForumLiveEvent) => void> | undefined;
}

async function publisher(): Promise<IORedis> {
  globalThis.__brackeysForumLivePublisher ??= await createRedisClient("forum-live");
  return globalThis.__brackeysForumLivePublisher;
}

/** Best-effort: with Redis down the pill just doesn't light up. */
export async function announceForumPost(event: ForumLiveEvent): Promise<void> {
  if (!process.env.REDIS_URL) return;
  await bestEffort("forum_live.publish", { post_id: event.id }, async () => {
    await (await publisher()).publish(CHANNEL, JSON.stringify(event));
  });
}

function listeners(): Set<(event: ForumLiveEvent) => void> {
  globalThis.__brackeysForumLiveListeners ??= new Set();
  return globalThis.__brackeysForumLiveListeners;
}

async function ensureSubscriber(): Promise<void> {
  globalThis.__brackeysForumLiveSubscriber ??= createRedisClient("forum-live-subscriber").then(
    (client) => {
      client.on("message", (_channel, message) => {
        let event: ForumLiveEvent;
        try {
          event = JSON.parse(message) as ForumLiveEvent;
        } catch {
          return;
        }
        for (const listener of listeners()) listener(event);
      });
      // Re-subscribe on every `ready`, as the notification stream does:
      // with the offline queue off a subscribe during a reconnect rejects.
      const subscribe = () => void client.subscribe(CHANNEL).catch(() => {});
      client.on("ready", subscribe);
      if (client.status === "ready") subscribe();
      return client;
    },
  );
  await globalThis.__brackeysForumLiveSubscriber;
}

/** Listen for new posts on this instance; returns the unsubscribe. */
export async function onForumPost(listener: (event: ForumLiveEvent) => void): Promise<() => void> {
  listeners().add(listener);
  await ensureSubscriber().catch(() => {});
  return () => {
    listeners().delete(listener);
  };
}
