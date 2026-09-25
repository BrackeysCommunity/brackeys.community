import { ORPCError } from "@orpc/client";
import { os } from "@orpc/server";
import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import * as z from "zod";

import { db } from "@/db";
import {
  forumCategories,
  forumFollows,
  forumPosts,
  forumSeries,
  teamMembers,
  teams,
  user,
} from "@/db/schema";
import { forumPostSlug } from "@/lib/forum-posts";
import { loadSeries, seriesRights, writeSeriesOrder } from "@/lib/forum-series";
import { checkProfanity } from "@/lib/profanity";
import { forumRead, forumWrite } from "@/orpc/middleware/forum";

import { listableWhere } from "./forum";

const SERIES_TITLE_MAX = 80;
const SERIES_DESCRIPTION_MAX = 500;
const SERIES_PER_OWNER_MAX = 50;

/** Published entries a reader can see, in order. */
function seriesEntriesQuery(seriesId: number, viewerId: string | null) {
  return db
    .select({
      id: forumPosts.id,
      title: forumPosts.title,
      slug: forumPosts.slug,
      seriesIndex: forumPosts.seriesIndex,
      publishedAt: forumPosts.publishedAt,
    })
    .from(forumPosts)
    .innerJoin(forumCategories, eq(forumPosts.categoryId, forumCategories.id))
    .leftJoin(teams, eq(forumPosts.teamId, teams.id))
    .leftJoin(user, eq(forumPosts.authorId, user.id))
    .where(and(eq(forumPosts.seriesId, seriesId), ...listableWhere(viewerId)))
    .orderBy(asc(forumPosts.seriesIndex), asc(forumPosts.id));
}

/**
 * A team's or a member's series, with how many entries each has — the
 * composer's picker and the team's Devlog tab.
 */
export const listForumSeries = os
  .use(forumRead)
  .input(
    z.union([z.object({ teamId: z.string().max(64) }), z.object({ userId: z.string().max(64) })]),
  )
  .handler(async ({ input }) => {
    const owner =
      "teamId" in input
        ? eq(forumSeries.teamId, input.teamId)
        : eq(forumSeries.ownerUserId, input.userId);
    return db
      .select({
        id: forumSeries.id,
        title: forumSeries.title,
        slug: forumSeries.slug,
        description: forumSeries.description,
        teamId: forumSeries.teamId,
        ownerUserId: forumSeries.ownerUserId,
        // Spelled out: inside a one-table select drizzle leaves column
        // names unqualified, and `id` would resolve to the post's own.
        entryCount: sql<number>`(
          SELECT count(*)::int FROM forum.posts p
          WHERE p.series_id = "forum"."series"."id"
            AND p.status = 'published' AND p.deleted_at IS NULL AND p.hidden_at IS NULL
        )`,
      })
      .from(forumSeries)
      .where(owner)
      .orderBy(asc(forumSeries.title));
  });

/** One series and its entries, for the post page's sidebar. */
export const getForumSeries = os
  .use(forumRead)
  .input(z.object({ seriesId: z.number().int().positive() }))
  .handler(async ({ input, context }) => {
    const viewerId = context.user?.id ?? null;
    const [series] = await db
      .select()
      .from(forumSeries)
      .where(eq(forumSeries.id, input.seriesId))
      .limit(1);
    if (!series) return null;
    const [entries, rights, following] = await Promise.all([
      seriesEntriesQuery(series.id, viewerId),
      viewerId ? seriesRights(series, viewerId) : { canManage: false, canDelete: false },
      viewerId
        ? db
            .select({ id: forumFollows.targetId })
            .from(forumFollows)
            .where(
              and(
                eq(forumFollows.followerId, viewerId),
                eq(forumFollows.targetType, "series"),
                eq(forumFollows.targetId, String(series.id)),
              ),
            )
            .limit(1)
            .then((r) => r.length > 0)
        : false,
    ]);
    return {
      id: series.id,
      title: series.title,
      slug: series.slug,
      description: series.description,
      teamId: series.teamId,
      ownerUserId: series.ownerUserId,
      entries,
      viewer: { ...rights, following },
    };
  });

/** Title → a slug unique among this owner's series. */
async function freeSeriesSlug(
  title: string,
  owner: { teamId: string | null; ownerUserId: string | null },
  exceptId?: number,
): Promise<string> {
  const base = forumPostSlug(title) || "series";
  const taken = await db
    .select({ slug: forumSeries.slug, id: forumSeries.id })
    .from(forumSeries)
    .where(
      owner.teamId
        ? eq(forumSeries.teamId, owner.teamId)
        : eq(forumSeries.ownerUserId, owner.ownerUserId!),
    );
  const used = new Set(taken.filter((s) => s.id !== exceptId).map((s) => s.slug));
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
  }
}

const seriesFields = {
  title: z.string().trim().min(1).max(SERIES_TITLE_MAX),
  description: z.string().trim().max(SERIES_DESCRIPTION_MAX).nullish(),
};

/** A new series for yourself, or for a team you're on. */
export const createForumSeries = os
  .use(forumWrite)
  .input(z.object({ ...seriesFields, teamId: z.string().max(64).nullish() }))
  .handler(async ({ input, context }) => {
    const userId = context.user.id;
    checkProfanity(input.title, "Series title");
    checkProfanity(input.description, "Series description");
    const teamId = input.teamId ?? null;
    if (teamId) {
      const [member] = await db
        .select({ id: teamMembers.id })
        .from(teamMembers)
        .innerJoin(teams, eq(teamMembers.teamId, teams.id))
        .where(
          and(
            eq(teamMembers.teamId, teamId),
            eq(teamMembers.userId, userId),
            eq(teams.status, "active"),
            isNull(teams.hiddenAt),
          ),
        )
        .limit(1);
      if (!member) {
        throw new ORPCError("FORBIDDEN", { message: "You can only start a series for your team." });
      }
    }
    const owner = { teamId, ownerUserId: teamId ? null : userId };
    const [existing] = await db
      .select({ value: count() })
      .from(forumSeries)
      .where(teamId ? eq(forumSeries.teamId, teamId) : eq(forumSeries.ownerUserId, userId));
    if ((existing?.value ?? 0) >= SERIES_PER_OWNER_MAX) {
      throw new ORPCError("BAD_REQUEST", { message: "That's a lot of series — reuse one." });
    }

    const [series] = await db
      .insert(forumSeries)
      .values({
        ...owner,
        title: input.title,
        slug: await freeSeriesSlug(input.title, owner),
        description: input.description || null,
      })
      .returning({ id: forumSeries.id, title: forumSeries.title, slug: forumSeries.slug });
    return series!;
  });

async function loadManagedSeries(seriesId: number, userId: string) {
  const series = await loadSeries(seriesId);
  const rights = await seriesRights(series, userId);
  if (!rights.canManage) {
    throw new ORPCError("FORBIDDEN", { message: "You can't change this series." });
  }
  return { series, rights };
}

export const updateForumSeries = os
  .use(forumWrite)
  .input(z.object({ seriesId: z.number().int().positive(), ...seriesFields }))
  .handler(async ({ input, context }) => {
    const { series } = await loadManagedSeries(input.seriesId, context.user.id);
    checkProfanity(input.title, "Series title");
    checkProfanity(input.description, "Series description");
    const slug =
      input.title === series.title
        ? series.slug
        : await freeSeriesSlug(input.title, series, series.id);
    await db
      .update(forumSeries)
      .set({ title: input.title, slug, description: input.description || null })
      .where(eq(forumSeries.id, series.id));
    return { id: series.id, title: input.title, slug };
  });

/**
 * The entries stay; they just stop being numbered. Follows of the series
 * go with it, since nothing else points at the id.
 */
export const deleteForumSeries = os
  .use(forumWrite)
  .input(z.object({ seriesId: z.number().int().positive() }))
  .handler(async ({ input, context }) => {
    const { series, rights } = await loadManagedSeries(input.seriesId, context.user.id);
    if (!rights.canDelete) {
      throw new ORPCError("FORBIDDEN", { message: "Only the team's owner can delete its series." });
    }
    await db.transaction(async (tx) => {
      await tx
        .update(forumPosts)
        .set({ seriesId: null, seriesIndex: null })
        .where(eq(forumPosts.seriesId, series.id));
      await tx
        .delete(forumFollows)
        .where(
          and(eq(forumFollows.targetType, "series"), eq(forumFollows.targetId, String(series.id))),
        );
      await tx.delete(forumSeries).where(eq(forumSeries.id, series.id));
    });
    return { success: true };
  });

/** Every numbered entry, in the new order. Hidden ones keep their place. */
export const reorderForumSeries = os
  .use(forumWrite)
  .input(
    z.object({
      seriesId: z.number().int().positive(),
      postIds: z.array(z.number().int().positive()).max(500),
    }),
  )
  .handler(async ({ input, context }) => {
    const { series } = await loadManagedSeries(input.seriesId, context.user.id);
    const current = await db
      .select({ id: forumPosts.id })
      .from(forumPosts)
      .where(
        and(
          eq(forumPosts.seriesId, series.id),
          eq(forumPosts.status, "published"),
          isNull(forumPosts.deletedAt),
        ),
      );
    const wanted = new Set(input.postIds);
    if (
      wanted.size !== input.postIds.length ||
      current.length !== wanted.size ||
      current.some((p) => !wanted.has(p.id))
    ) {
      throw new ORPCError("BAD_REQUEST", {
        message: "The series changed while you were sorting — reload and try again.",
      });
    }
    await db.transaction((tx) => writeSeriesOrder(tx, series.id, input.postIds));
    return { success: true };
  });
