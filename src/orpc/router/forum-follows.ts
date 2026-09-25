import { ORPCError } from "@orpc/client";
import { os } from "@orpc/server";
import { and, eq, inArray, isNull } from "drizzle-orm";
import * as z from "zod";

import { db } from "@/db";
import {
  developerProfiles,
  forumCategories,
  forumFollows,
  forumSeries,
  forumTags,
  profileUrlStubs,
  teams,
  type ForumFollowTarget,
} from "@/db/schema";
import { EVENTS } from "@/lib/event-taxonomy";
import { normalizeTagSlug } from "@/lib/forum-posts";
import { captureServerEvent } from "@/lib/posthog-server";
import { resolveTeamAvatarUrl } from "@/lib/profile-project-image-storage";
import { assertRateLimit } from "@/lib/rate-limit";
import { forumSignedIn, forumWrite } from "@/orpc/middleware/forum";
import { profileIdentityColumns, profileStubJoin } from "@/orpc/profile-projection";

const FOLLOW_TARGETS = ["team", "user", "tag", "category", "series"] as const;

/**
 * The client names a target the way its page does — a tag or category by
 * slug, the rest by id. Stored ids are what the feed's follow join compares
 * against, so a tag or category slug is turned into its id here, and a
 * merged tag follows its target.
 */
async function resolveTarget(type: ForumFollowTarget, target: string): Promise<string> {
  switch (type) {
    case "team": {
      const [team] = await db
        .select({ id: teams.id })
        .from(teams)
        .where(and(eq(teams.id, target), isNull(teams.hiddenAt)))
        .limit(1);
      if (team) return team.id;
      break;
    }
    case "user": {
      const [profile] = await db
        .select({ id: developerProfiles.id })
        .from(developerProfiles)
        .where(eq(developerProfiles.id, target))
        .limit(1);
      if (profile) return profile.id;
      break;
    }
    case "tag": {
      const slug = normalizeTagSlug(target);
      if (!slug) break;
      const [tag] = await db.select().from(forumTags).where(eq(forumTags.slug, slug)).limit(1);
      if (!tag || tag.status === "banned") break;
      return String(tag.mergedIntoId ?? tag.id);
    }
    case "category": {
      const [category] = await db
        .select({ id: forumCategories.id })
        .from(forumCategories)
        .where(and(eq(forumCategories.slug, target), isNull(forumCategories.archivedAt)))
        .limit(1);
      if (category) return String(category.id);
      break;
    }
    case "series": {
      const id = Number(target);
      if (!Number.isSafeInteger(id) || id <= 0) break;
      const [series] = await db
        .select({ id: forumSeries.id })
        .from(forumSeries)
        .where(eq(forumSeries.id, id))
        .limit(1);
      if (series) return String(series.id);
      break;
    }
  }
  throw new ORPCError("NOT_FOUND", { message: "There's nothing there to follow." });
}

export const setForumFollow = os
  .use(forumWrite)
  .input(
    z.object({
      targetType: z.enum(FOLLOW_TARGETS),
      target: z.string().min(1).max(64),
      following: z.boolean(),
    }),
  )
  .handler(async ({ input, context }) => {
    const userId = context.user.id;
    const targetId = await resolveTarget(input.targetType, input.target);
    if (input.targetType === "user" && targetId === userId) {
      throw new ORPCError("BAD_REQUEST", { message: "You can't follow yourself." });
    }
    if (input.following) {
      await assertRateLimit("forum-follow", userId, 60, "Easy there — try again in a bit.");
      const added = await db
        .insert(forumFollows)
        .values({ followerId: userId, targetType: input.targetType, targetId })
        .onConflictDoNothing()
        .returning({ targetId: forumFollows.targetId });
      if (added.length > 0) {
        captureServerEvent(EVENTS.forumFollowAdded, userId, { target_type: input.targetType });
      }
    } else {
      await db
        .delete(forumFollows)
        .where(
          and(
            eq(forumFollows.followerId, userId),
            eq(forumFollows.targetType, input.targetType),
            eq(forumFollows.targetId, targetId),
          ),
        );
    }
    return { following: input.following };
  });

/**
 * Everything the viewer follows, named — the Follow buttons read their
 * state from it and the Following tab lists it when the feed is empty.
 */
export const listMyForumFollows = os.use(forumSignedIn).handler(async ({ context }) => {
  const rows = await db
    .select({ targetType: forumFollows.targetType, targetId: forumFollows.targetId })
    .from(forumFollows)
    .where(eq(forumFollows.followerId, context.user.id));
  const ids = (type: ForumFollowTarget) =>
    rows.filter((r) => r.targetType === type).map((r) => r.targetId);
  const numeric = (type: ForumFollowTarget) => ids(type).map(Number).filter(Number.isSafeInteger);

  const [teamRows, userRows, tagRows, categoryRows, seriesRows] = await Promise.all([
    ids("team").length
      ? db
          .select({
            id: teams.id,
            slug: teams.slug,
            name: teams.name,
            avatarUrl: teams.avatarUrl,
            avatarKey: teams.avatarKey,
          })
          .from(teams)
          .where(inArray(teams.id, ids("team")))
      : [],
    ids("user").length
      ? db
          .select({ id: developerProfiles.id, ...profileIdentityColumns })
          .from(developerProfiles)
          .leftJoin(profileUrlStubs, profileStubJoin)
          .where(inArray(developerProfiles.id, ids("user")))
      : [],
    numeric("tag").length
      ? db
          .select({ id: forumTags.id, slug: forumTags.slug })
          .from(forumTags)
          .where(inArray(forumTags.id, numeric("tag")))
      : [],
    numeric("category").length
      ? db
          .select({
            id: forumCategories.id,
            slug: forumCategories.slug,
            name: forumCategories.name,
            color: forumCategories.color,
          })
          .from(forumCategories)
          .where(inArray(forumCategories.id, numeric("category")))
      : [],
    numeric("series").length
      ? db
          .select({ id: forumSeries.id, title: forumSeries.title })
          .from(forumSeries)
          .where(inArray(forumSeries.id, numeric("series")))
      : [],
  ]);

  return {
    teams: await Promise.all(
      teamRows.map(async ({ avatarKey, avatarUrl, ...team }) => ({
        ...team,
        avatarUrl: await resolveTeamAvatarUrl({ avatarKey, avatarUrl }),
      })),
    ),
    users: userRows,
    tags: tagRows.map((t) => t.slug),
    categories: categoryRows,
    series: seriesRows,
  };
});
