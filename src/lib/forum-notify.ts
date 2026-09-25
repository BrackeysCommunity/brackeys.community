import { and, eq, inArray, or } from "drizzle-orm";

import { db } from "@/db";
import { forumFollows, forumPostAuthors, profileUrlStubs, teams, userBlocks } from "@/db/schema";
import { forumPostTitle } from "@/lib/forum-posts";
import { notify } from "@/lib/notifications";
import { bestEffort } from "@/lib/posthog-server";

/** A week of likes on one post reads as one line in the digest. */
const LIKE_FOLD_MS = 7 * 86_400_000;

type PostSnapshot = {
  id: number;
  title: string | null;
  excerpt: string | null;
};

function snapshot(post: PostSnapshot) {
  return { subjectTitle: forumPostTitle(post), subjectUrl: `/forum/${post.id}` };
}

/** Everyone on either side of a block with `userId`. */
async function blockedWith(userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ blockerId: userBlocks.blockerId, blockedId: userBlocks.blockedId })
    .from(userBlocks)
    .where(or(eq(userBlocks.blockerId, userId), eq(userBlocks.blockedId, userId)));
  return new Set(rows.map((r) => (r.blockerId === userId ? r.blockedId : r.blockerId)));
}

/**
 * A devlog went out: tell whoever follows its team, its author or its
 * series. The people who wrote it and anyone across a block with the
 * author are left out; each follower hears once however many of the
 * three they follow.
 */
export async function notifyDevlogFollowers(
  post: PostSnapshot & {
    authorId: string | null;
    teamId: string | null;
    seriesId: number | null;
  },
): Promise<void> {
  if (!post.authorId) return;
  const authorId = post.authorId;
  const targets = [
    and(eq(forumFollows.targetType, "user"), eq(forumFollows.targetId, authorId)),
    post.teamId
      ? and(eq(forumFollows.targetType, "team"), eq(forumFollows.targetId, post.teamId))
      : undefined,
    post.seriesId
      ? and(eq(forumFollows.targetType, "series"), eq(forumFollows.targetId, String(post.seriesId)))
      : undefined,
  ].filter((t) => t !== undefined);

  const [followers, writers, blocked, team] = await Promise.all([
    db
      .selectDistinct({ id: forumFollows.followerId })
      .from(forumFollows)
      .where(or(...targets)),
    db
      .select({ id: forumPostAuthors.userId })
      .from(forumPostAuthors)
      .where(eq(forumPostAuthors.postId, post.id)),
    blockedWith(authorId),
    post.teamId
      ? db
          .select({ name: teams.name })
          .from(teams)
          .where(eq(teams.id, post.teamId))
          .then(([t]) => t ?? null)
      : null,
  ]);
  const skip = new Set([authorId, ...writers.map((w) => w.id), ...blocked]);
  const data = { ...snapshot(post), ...(team ? { teamName: team.name } : {}) };

  for (const { id } of followers) {
    if (skip.has(id)) continue;
    await bestEffort("forum.devlog_published", { post_id: post.id }, () =>
      notify({
        userId: id,
        type: "forum_devlog_published",
        actorId: authorId,
        entityType: "forum_post",
        entityId: String(post.id),
        data,
        dedupeWithin: { ms: LIKE_FOLD_MS },
      }),
    );
  }
}

/** One more like, folded into the author's running line for this post. */
export async function notifyPostLiked(
  post: PostSnapshot & { authorId: string | null },
  likerId: string,
): Promise<void> {
  if (!post.authorId || post.authorId === likerId) return;
  const authorId = post.authorId;
  await bestEffort("forum.post_liked", { post_id: post.id }, () =>
    notify({
      userId: authorId,
      type: "forum_post_liked",
      actorId: likerId,
      entityType: "forum_post",
      entityId: String(post.id),
      data: { ...snapshot(post), likers: 1 },
      coalesceWithin: {
        ms: LIKE_FOLD_MS,
        by: "entity",
        merge: (existing) => ({
          ...existing,
          ...snapshot(post),
          likers: (typeof existing.likers === "number" ? existing.likers : 1) + 1,
        }),
      },
    }),
  );
}

/**
 * People named with `@handle` who should hear about it: real, not the
 * writer, not across a block with them. `handles` are profile url stubs.
 */
export async function notifyMentions(opts: {
  handles: string[];
  actorId: string;
  post: PostSnapshot;
  /** Deep link; a comment passes its `#comment-<id>` anchor. */
  url: string;
  exclude?: string[];
}): Promise<void> {
  if (opts.handles.length === 0) return;
  const rows = await db
    .select({ id: profileUrlStubs.profileId })
    .from(profileUrlStubs)
    .where(
      inArray(
        profileUrlStubs.stub,
        opts.handles.map((h) => h.toLowerCase()),
      ),
    );
  const blocked = await blockedWith(opts.actorId);
  const skip = new Set([opts.actorId, ...(opts.exclude ?? []), ...blocked]);
  const recipients = [...new Set(rows.map((r) => r.id))].filter((id) => !skip.has(id));
  for (const userId of recipients) {
    await bestEffort("forum.mention", { post_id: opts.post.id }, () =>
      notify({
        userId,
        type: "forum_mention",
        actorId: opts.actorId,
        entityType: "forum_post",
        entityId: String(opts.post.id),
        data: { subjectTitle: forumPostTitle(opts.post), subjectUrl: opts.url },
        dedupeWithin: { ms: 15 * 60_000 },
      }),
    );
  }
}
