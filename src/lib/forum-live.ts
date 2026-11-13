import { createBroadcast } from "@/lib/live-broadcast";

/**
 * "N new posts": every published forum post is announced on one Redis
 * channel, and each app instance fans it out to its open
 * `/api/forum/stream` connections.
 */

export type ForumLiveEvent = {
  id: number;
  kind: string;
  category: string;
  authorId: string | null;
};

/** A forum announcement off the channel, or null when it isn't one. */
export function parseForumLiveEvent(raw: unknown): ForumLiveEvent | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { id, kind, category, authorId } = raw as Record<string, unknown>;
  if (typeof id !== "number" || typeof kind !== "string" || typeof category !== "string") {
    return null;
  }
  if (authorId !== null && typeof authorId !== "string") return null;
  return { id, kind, category, authorId };
}

const forumLive = createBroadcast<ForumLiveEvent>({
  name: "forum-live",
  channel: "forum:new-posts",
  parse: parseForumLiveEvent,
  context: (event) => ({ post_id: event.id }),
});

/** Best-effort: with Redis down the pill just doesn't light up. */
export function announceForumPost(event: ForumLiveEvent): Promise<void> {
  return forumLive.announce(event);
}

/** Listen for new posts on this instance; returns the unsubscribe. */
export function onForumPost(listener: (event: ForumLiveEvent) => void): Promise<() => void> {
  return forumLive.listen(listener);
}
