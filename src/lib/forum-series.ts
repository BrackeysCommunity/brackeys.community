import { ORPCError } from "@orpc/client";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { forumPosts, forumSeries, teamMembers } from "@/db/schema";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Runner = typeof db | Tx;

export type ForumSeriesRow = typeof forumSeries.$inferSelect;

/**
 * Entry numbers count published, undeleted devlogs only, so a draft waits
 * for its number until it goes out and a deleted entry closes its gap.
 */
const numbered = (seriesId: number) =>
  and(
    eq(forumPosts.seriesId, seriesId),
    eq(forumPosts.status, "published"),
    isNull(forumPosts.deletedAt),
  );

export async function nextSeriesIndex(runner: Runner, seriesId: number): Promise<number> {
  const [row] = await runner
    .select({ last: sql<number>`coalesce(max(${forumPosts.seriesIndex}), 0)::int` })
    .from(forumPosts)
    .where(numbered(seriesId));
  return (row?.last ?? 0) + 1;
}

/**
 * Renumber a series 1..n in its current order. Two passes through negative
 * numbers, because the `(seriesId, seriesIndex)` unique index is checked
 * row by row and a straight renumber collides with itself mid-update.
 */
export async function compactSeries(runner: Runner, seriesId: number): Promise<void> {
  await runner.execute(sql`
    UPDATE ${forumPosts} AS p SET series_index = -r.rn
    FROM (
      SELECT id, row_number() OVER (ORDER BY series_index NULLS LAST, published_at, id) AS rn
      FROM ${forumPosts}
      WHERE series_id = ${seriesId} AND status = 'published' AND deleted_at IS NULL
    ) AS r
    WHERE p.id = r.id`);
  await runner.execute(sql`
    UPDATE ${forumPosts} SET series_index = -series_index
    WHERE series_id = ${seriesId} AND series_index < 0`);
}

/** Put the given entries in this order, 1..n. */
export async function writeSeriesOrder(tx: Tx, seriesId: number, postIds: number[]) {
  for (const [i, id] of postIds.entries()) {
    await tx
      .update(forumPosts)
      .set({ seriesIndex: -(i + 1) })
      .where(and(eq(forumPosts.id, id), eq(forumPosts.seriesId, seriesId)));
  }
  await tx.execute(sql`
    UPDATE ${forumPosts} SET series_index = -series_index
    WHERE series_id = ${seriesId} AND series_index < 0`);
}

export async function loadSeries(seriesId: number): Promise<ForumSeriesRow> {
  const [series] = await db.select().from(forumSeries).where(eq(forumSeries.id, seriesId)).limit(1);
  if (!series) throw new ORPCError("NOT_FOUND", { message: "Series not found." });
  return series;
}

/**
 * What a member may do with a series. A team's series belongs to the whole
 * crew like its devlogs do (D4): any member adds to it, renames or reorders
 * it; only the owner deletes it. A solo series is its owner's alone.
 */
export async function seriesRights(
  series: Pick<ForumSeriesRow, "teamId" | "ownerUserId">,
  userId: string,
): Promise<{ canManage: boolean; canDelete: boolean }> {
  if (series.ownerUserId) {
    const own = series.ownerUserId === userId;
    return { canManage: own, canDelete: own };
  }
  if (!series.teamId) return { canManage: false, canDelete: false };
  const [member] = await db
    .select({ role: teamMembers.role })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, series.teamId), eq(teamMembers.userId, userId)))
    .limit(1);
  return { canManage: Boolean(member), canDelete: member?.role === "owner" };
}

/**
 * A devlog joins a series owned by whoever it is posted as: its team's
 * series for a team devlog, the author's own for a solo one.
 */
export function assertSeriesMatchesPost(
  series: Pick<ForumSeriesRow, "teamId" | "ownerUserId">,
  post: { teamId: string | null; authorId: string | null },
): void {
  const matches = post.teamId
    ? series.teamId === post.teamId
    : series.ownerUserId != null && series.ownerUserId === post.authorId;
  if (!matches) {
    throw new ORPCError("BAD_REQUEST", {
      message: post.teamId ? "Pick one of this team's series." : "Pick one of your own series.",
    });
  }
}

/** Close the gaps in every series these posts belonged to. */
export async function compactSeriesOf(seriesIds: (number | null)[]): Promise<void> {
  const ids = [...new Set(seriesIds.filter((id): id is number => id != null))];
  if (ids.length === 0) return;
  const live = await db
    .select({ id: forumSeries.id })
    .from(forumSeries)
    .where(inArray(forumSeries.id, ids));
  for (const { id } of live) await compactSeries(db, id);
}
