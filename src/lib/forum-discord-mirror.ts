import { asc, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  developerProfiles,
  forumPostDiscordShares,
  forumPosts,
  forumPostTags,
  forumSeries,
  forumTags,
  profileUrlStubs,
  teams,
} from "@/db/schema";
import {
  buildDevlogFeedMessage,
  deleteDevlogFeedMessage,
  devlogFeedConfig,
  devlogFeedEnabled,
  devlogFeedMessageUrl,
  editDevlogFeedMessage,
  postDevlogFeedMessage,
  type DevlogFeedPost,
} from "@/lib/forum-discord-feed";
import { forumPostParam } from "@/lib/forum-posts";
import { markdownToPlainText } from "@/lib/markdown-text";
import { memberName } from "@/lib/member-name";
import { profileSlug } from "@/lib/profile-links";
import {
  getProfileProjectImageUrl,
  resolveTeamAvatarUrl,
} from "@/lib/profile-project-image-storage";
import { teamSlug } from "@/lib/team-links";

/**
 * The bookkeeping half of the `#devlogs` mirror. The invariant is the
 * collab feed's: a mirror exists only while its devlog is live. An edit
 * rewrites it; a delete or a staff hide takes it down, and the row stays
 * behind with a null message id to remember that it was once shared.
 */

async function loadShareRow(postId: number) {
  const [row] = await db
    .select()
    .from(forumPostDiscordShares)
    .where(eq(forumPostDiscordShares.postId, postId))
    .limit(1);
  return row ?? null;
}

/** A live, published devlog as the embed draws it; null for anything else. */
async function loadDevlogFeedPost(postId: number): Promise<DevlogFeedPost | null> {
  const [post] = await db
    .select({
      id: forumPosts.id,
      kind: forumPosts.kind,
      title: forumPosts.title,
      slug: forumPosts.slug,
      excerpt: forumPosts.excerpt,
      body: forumPosts.body,
      status: forumPosts.status,
      deletedAt: forumPosts.deletedAt,
      hiddenAt: forumPosts.hiddenAt,
      publishedAt: forumPosts.publishedAt,
      coverImageKey: forumPosts.coverImageKey,
      coverImageUrl: forumPosts.coverImageUrl,
      seriesIndex: forumPosts.seriesIndex,
      seriesTitle: forumSeries.title,
      authorId: forumPosts.authorId,
      discordUsername: developerProfiles.discordUsername,
      guildNickname: developerProfiles.guildNickname,
      authorAvatarUrl: developerProfiles.avatarUrl,
      urlStub: profileUrlStubs.stub,
      teamId: teams.id,
      teamSlug: teams.slug,
      teamName: teams.name,
      teamAvatarUrl: teams.avatarUrl,
      teamAvatarKey: teams.avatarKey,
      teamHiddenAt: teams.hiddenAt,
    })
    .from(forumPosts)
    .leftJoin(forumSeries, eq(forumPosts.seriesId, forumSeries.id))
    .leftJoin(developerProfiles, eq(forumPosts.authorId, developerProfiles.id))
    .leftJoin(profileUrlStubs, eq(profileUrlStubs.profileId, developerProfiles.id))
    .leftJoin(teams, eq(forumPosts.teamId, teams.id))
    .where(eq(forumPosts.id, postId))
    .limit(1);
  if (
    !post ||
    post.kind !== "devlog" ||
    post.status !== "published" ||
    post.deletedAt ||
    post.hiddenAt ||
    post.teamHiddenAt ||
    !post.title
  ) {
    return null;
  }
  const tags = await db
    .select({ slug: forumTags.slug })
    .from(forumPostTags)
    .innerJoin(forumTags, eq(forumPostTags.tagId, forumTags.id))
    .where(eq(forumPostTags.postId, postId))
    .orderBy(asc(forumTags.slug));

  return {
    id: post.id,
    title: post.title,
    slugPath: `/forum/${forumPostParam(post)}`,
    // From the body rather than the stored excerpt, which spells guild
    // emojis out as `:name:`; Discord draws the tokens itself.
    excerpt: markdownToPlainText(post.body, 480, { keepEmojiTokens: true }) ?? post.excerpt,
    coverUrl: (await getProfileProjectImageUrl(post.coverImageKey)) ?? post.coverImageUrl,
    publishedAt: post.publishedAt,
    tags: tags.map((t) => t.slug),
    series: post.seriesTitle ? { title: post.seriesTitle, index: post.seriesIndex } : null,
    team:
      post.teamId && post.teamName
        ? {
            name: post.teamName,
            path: `/teams/${teamSlug({ id: post.teamId, slug: post.teamSlug })}`,
            avatarUrl: await resolveTeamAvatarUrl({
              avatarKey: post.teamAvatarKey,
              avatarUrl: post.teamAvatarUrl,
            }),
          }
        : null,
    author: post.authorId
      ? {
          name: memberName(post, "A member"),
          path: `/profile/${profileSlug({ id: post.authorId, urlStub: post.urlStub })}`,
          avatarUrl: post.authorAvatarUrl,
        }
      : null,
  };
}

/**
 * Post the devlog to `#devlogs`, or rewrite the message already there.
 * Throws on a Discord refusal so the caller can decide whether it matters —
 * the share button reports it, a share ticked at publish time shrugs.
 */
export async function shareDevlogToDiscord(
  postId: number,
  sharedById: string,
): Promise<{ messageUrl: string } | null> {
  const config = devlogFeedConfig();
  if (!config || !devlogFeedEnabled()) return null;
  const post = await loadDevlogFeedPost(postId);
  if (!post) return null;
  const payload = buildDevlogFeedMessage(post);
  const share = await loadShareRow(postId);

  if (share?.messageId) {
    const outcome = await editDevlogFeedMessage(config, share.channelId, share.messageId, payload);
    if (outcome === "edited") {
      await db
        .update(forumPostDiscordShares)
        .set({ updatedAt: new Date() })
        .where(eq(forumPostDiscordShares.postId, postId));
      return { messageUrl: devlogFeedMessageUrl(config, share.channelId, share.messageId) };
    }
  }

  const messageId = await postDevlogFeedMessage(config, payload);
  const now = new Date();
  await db
    .insert(forumPostDiscordShares)
    .values({ postId, channelId: config.channelId, messageId, sharedById, sharedAt: now })
    .onConflictDoUpdate({
      target: forumPostDiscordShares.postId,
      set: { channelId: config.channelId, messageId, sharedById, sharedAt: now, updatedAt: now },
    });
  return { messageUrl: devlogFeedMessageUrl(config, config.channelId, messageId) };
}

/**
 * After an edit, a delete or a hide: rewrite the mirror if the devlog is
 * still live, take it down if it isn't. A message someone already removed
 * in Discord is forgotten rather than put back.
 */
export async function refreshDevlogMirror(postId: number): Promise<void> {
  const config = devlogFeedConfig();
  if (!config) return;
  const share = await loadShareRow(postId);
  if (!share?.messageId) return;
  const post = await loadDevlogFeedPost(postId);
  if (!post) {
    await forgetMessage(postId);
    await deleteDevlogFeedMessage(config, share.channelId, share.messageId);
    return;
  }
  const outcome = await editDevlogFeedMessage(
    config,
    share.channelId,
    share.messageId,
    buildDevlogFeedMessage(post),
  );
  if (outcome === "gone") await forgetMessage(postId);
}

async function forgetMessage(postId: number): Promise<void> {
  await db
    .update(forumPostDiscordShares)
    .set({ messageId: null, updatedAt: new Date() })
    .where(eq(forumPostDiscordShares.postId, postId));
}

/** What the post page tells a devlog's editors about its mirror. */
export async function devlogShareState(postId: number) {
  const config = devlogFeedConfig();
  const share = config ? await loadShareRow(postId) : null;
  return {
    available: devlogFeedEnabled(),
    live: Boolean(share?.messageId),
    sharedAt: share?.sharedAt ?? null,
    messageUrl:
      config && share?.messageId
        ? devlogFeedMessageUrl(config, share.channelId, share.messageId)
        : null,
  };
}
