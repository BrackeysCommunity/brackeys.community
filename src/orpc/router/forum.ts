import { ORPCError } from "@orpc/client";
import { os } from "@orpc/server";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  notInArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import * as z from "zod";

import { db } from "@/db";
import {
  collabPosts,
  developerProfiles,
  forumBookmarks,
  forumCategories,
  forumPostAuthors,
  forumPostImages,
  forumPostReports,
  forumPosts,
  forumPostTags,
  forumReactions,
  forumTags,
  itchJams,
  profileUrlStubs,
  projects,
  teamMembers,
  teams,
  threads,
  user,
  userBlocks,
  type ForumPostKind,
} from "@/db/schema";
import { isStaffMember } from "@/lib/discord";
import { EVENTS } from "@/lib/event-taxonomy";
import {
  FORUM_DEFAULT_CATEGORY,
  FORUM_LIMITS,
  FORUM_MAX_TAGS,
  FORUM_POST_KINDS,
  FORUM_RESERVED_TAGS,
  forumPostSlug,
  forumPostTitle,
  normalizeTagSlug,
} from "@/lib/forum-posts";
import { markdownToPlainText } from "@/lib/markdown-text";
import { memberName } from "@/lib/member-name";
import { recordModerationAction } from "@/lib/moderation-audit";
import type { ModOverride } from "@/lib/moderation-policy";
import { notify } from "@/lib/notifications";
import { bestEffort, captureServerEvent } from "@/lib/posthog-server";
import { checkProfanity } from "@/lib/profanity";
import {
  getProfileProjectImageUrl,
  removeProfileProjectImageFromStorage,
  resolveTeamAvatarUrl,
} from "@/lib/profile-project-image-storage";
import { assertRateLimit } from "@/lib/rate-limit";
import { notifyReporters, resolveReportsForSubject } from "@/lib/report-resolution";
import { resolveUserRoles } from "@/lib/staff-roles";
import { isForumPostImageKey } from "@/lib/stored-image-keys";
import { uploadedImageUrlSchema } from "@/lib/stored-image-urls";
import { touchTeamActivity } from "@/lib/team-activity";
import { requireStaff } from "@/orpc/middleware/auth";
import { forumEnabledForUser, forumRead, forumSignedIn, forumWrite } from "@/orpc/middleware/forum";
import { profileIdentityColumns, profileStubJoin } from "@/orpc/profile-projection";

/** Unpublished drafts one member may hold at once. */
const MAX_DRAFTS = 20;
const FEED_PAGE_MAX = 50;
/** Images a feed card carries; the post page gets them all. */
const CARD_IMAGES = 4;

const TOP_WINDOWS = { day: 1, week: 7, month: 30 } as const;

const kindSchema = z.enum(FORUM_POST_KINDS);

async function viewerIsStaff(viewerId: string | null): Promise<boolean> {
  if (!viewerId) return false;
  return isStaffMember(await resolveUserRoles(viewerId));
}

// ── Visibility ───────────────────────────────────────────────────────────────

/** A ban in force on the joined author row; a deleted author has none. */
const authorBanned = sql`(${user.bannedAt} IS NOT NULL AND ${user.unbannedAt} IS NULL
  AND (${user.bannedUntil} IS NULL OR ${user.bannedUntil} > now()))`;

/**
 * What any reader may see in a listing: published, not deleted or hidden,
 * not under a hidden team, not by a banned author, and not across a block
 * with the viewer in either direction. Needs `teams` and `user` joined.
 */
function listableWhere(viewerId: string | null): SQL[] {
  const where: SQL[] = [
    eq(forumPosts.status, "published"),
    isNull(forumPosts.deletedAt),
    isNull(forumPosts.hiddenAt),
    isNull(teams.hiddenAt),
    sql`NOT ${authorBanned}`,
  ];
  if (viewerId) {
    where.push(sql`NOT EXISTS (
      SELECT 1 FROM ${userBlocks}
      WHERE (${userBlocks.blockerId} = ${viewerId} AND ${userBlocks.blockedId} = ${forumPosts.authorId})
         OR (${userBlocks.blockerId} = ${forumPosts.authorId} AND ${userBlocks.blockedId} = ${viewerId})
    )`);
  }
  return where;
}

// ── Card shaping ─────────────────────────────────────────────────────────────

const cardColumns = {
  id: forumPosts.id,
  kind: forumPosts.kind,
  title: forumPosts.title,
  slug: forumPosts.slug,
  body: forumPosts.body,
  excerpt: forumPosts.excerpt,
  coverImageKey: forumPosts.coverImageKey,
  coverImageUrl: forumPosts.coverImageUrl,
  seriesIndex: forumPosts.seriesIndex,
  publishedAt: forumPosts.publishedAt,
  editedAt: forumPosts.editedAt,
  pinnedAt: forumPosts.pinnedAt,
  pinnedScope: forumPosts.pinnedScope,
  likeCount: forumPosts.likeCount,
  solved: sql<boolean>`${forumPosts.solvedCommentId} IS NOT NULL`,
  commentCount: sql<number>`coalesce(${threads.commentCount}, 0)`,
  category: {
    slug: forumCategories.slug,
    name: forumCategories.name,
    color: forumCategories.color,
  },
  authorId: forumPosts.authorId,
  authorProfileId: developerProfiles.id,
  author: { ...profileIdentityColumns },
  teamId: forumPosts.teamId,
  teamHiddenAt: teams.hiddenAt,
  teamSlug: teams.slug,
  teamName: teams.name,
  teamAvatarUrl: teams.avatarUrl,
  teamAvatarKey: teams.avatarKey,
};

/** The joins every card query shares; `user` is the author's auth row. */
function cardQuery() {
  return db
    .select(cardColumns)
    .from(forumPosts)
    .innerJoin(forumCategories, eq(forumPosts.categoryId, forumCategories.id))
    .leftJoin(teams, eq(forumPosts.teamId, teams.id))
    .leftJoin(user, eq(forumPosts.authorId, user.id))
    .leftJoin(developerProfiles, eq(forumPosts.authorId, developerProfiles.id))
    .leftJoin(profileUrlStubs, profileStubJoin)
    .leftJoin(threads, eq(threads.forumPostId, forumPosts.id));
}

type CardRow = Awaited<ReturnType<typeof cardQuery>>[number];

async function tagsByPost(postIds: number[]): Promise<Map<number, string[]>> {
  const out = new Map<number, string[]>();
  if (postIds.length === 0) return out;
  const rows = await db
    .select({ postId: forumPostTags.postId, slug: forumTags.slug })
    .from(forumPostTags)
    .innerJoin(forumTags, eq(forumPostTags.tagId, forumTags.id))
    .where(inArray(forumPostTags.postId, postIds))
    .orderBy(asc(forumTags.slug));
  for (const row of rows) {
    const list = out.get(row.postId) ?? [];
    list.push(row.slug);
    out.set(row.postId, list);
  }
  return out;
}

async function imagesByPost(
  postIds: number[],
  perPost: number,
): Promise<Map<number, { id: number; url: string; alt: string | null }[]>> {
  const out = new Map<number, { id: number; url: string; alt: string | null }[]>();
  if (postIds.length === 0) return out;
  const rows = await db
    .select()
    .from(forumPostImages)
    .where(inArray(forumPostImages.postId, postIds))
    .orderBy(asc(forumPostImages.postId), asc(forumPostImages.sortOrder), asc(forumPostImages.id));
  for (const row of rows) {
    const list = out.get(row.postId) ?? [];
    if (list.length >= perPost) continue;
    list.push({
      id: row.id,
      url: (await getProfileProjectImageUrl(row.imageKey)) ?? row.url,
      alt: row.alt,
    });
    out.set(row.postId, list);
  }
  return out;
}

async function viewerMarks(viewerId: string | null, postIds: number[]) {
  if (!viewerId || postIds.length === 0) {
    return { liked: new Set<number>(), saved: new Set<number>() };
  }
  const [likes, saves] = await Promise.all([
    db
      .select({ postId: forumReactions.postId })
      .from(forumReactions)
      .where(and(eq(forumReactions.userId, viewerId), inArray(forumReactions.postId, postIds))),
    db
      .select({ postId: forumBookmarks.postId })
      .from(forumBookmarks)
      .where(and(eq(forumBookmarks.userId, viewerId), inArray(forumBookmarks.postId, postIds))),
  ]);
  return {
    liked: new Set(likes.map((r) => r.postId)),
    saved: new Set(saves.map((r) => r.postId)),
  };
}

/**
 * Rows → cards. Only a `post` carries its body (it *is* the card); devlogs
 * and questions show the excerpt and leave the body to the post page.
 */
async function serializeCards(rows: CardRow[], viewerId: string | null) {
  const ids = rows.map((r) => r.id);
  const shortIds = rows.filter((r) => r.kind === "post").map((r) => r.id);
  const [tags, images, marks] = await Promise.all([
    tagsByPost(ids),
    imagesByPost(shortIds, CARD_IMAGES),
    viewerMarks(viewerId, ids),
  ]);

  return Promise.all(
    rows.map(async (row) => {
      const {
        body,
        coverImageKey,
        coverImageUrl,
        teamId,
        teamSlug,
        teamName,
        teamAvatarUrl,
        teamAvatarKey,
        teamHiddenAt: _teamHiddenAt,
        authorId,
        authorProfileId,
        author,
        ...rest
      } = row;
      return {
        ...rest,
        body: row.kind === "post" ? body : null,
        coverUrl: (await getProfileProjectImageUrl(coverImageKey)) ?? coverImageUrl,
        author: authorId && authorProfileId ? { id: authorId, ...author } : null,
        team:
          teamId && teamSlug && teamName
            ? {
                id: teamId,
                slug: teamSlug,
                name: teamName,
                avatarUrl: await resolveTeamAvatarUrl({
                  avatarKey: teamAvatarKey,
                  avatarUrl: teamAvatarUrl,
                }),
              }
            : null,
        tags: tags.get(row.id) ?? [],
        images: images.get(row.id) ?? [],
        viewer: { liked: marks.liked.has(row.id), saved: marks.saved.has(row.id) },
      };
    }),
  );
}

export type ForumPostCard = Awaited<ReturnType<typeof serializeCards>>[number];

// ── Reads ────────────────────────────────────────────────────────────────────

export const listForumCategories = os.use(forumRead).handler(async () => {
  return db
    .select({
      id: forumCategories.id,
      slug: forumCategories.slug,
      name: forumCategories.name,
      description: forumCategories.description,
      color: forumCategories.color,
      postingPolicy: forumCategories.postingPolicy,
    })
    .from(forumCategories)
    .where(isNull(forumCategories.archivedAt))
    .orderBy(asc(forumCategories.sortOrder), asc(forumCategories.id));
});

const latestCursorSchema = z.object({ publishedAt: z.coerce.date(), id: z.number().int() });

/**
 * The feed. `latest` pages by keyset on `(publishedAt, id)` — the feed is
 * append-heavy, so offsets would skip and repeat rows as posts land.
 * `top` ranks by `likes + 2·comments` inside a window and pages by offset,
 * since a score has no stable keyset.
 *
 * Pins come back separately on the first page and are left out of the
 * stream: global pins on the main feed, category pins on a category board.
 */
export const listForumPosts = os
  .use(forumRead)
  .input(
    z.object({
      sort: z.enum(["latest", "top"]).default("latest"),
      window: z.enum(["day", "week", "month", "all"]).default("week"),
      kind: kindSchema.optional(),
      category: z.string().max(64).optional(),
      tag: z.string().max(32).optional(),
      teamId: z.string().max(64).optional(),
      authorId: z.string().max(64).optional(),
      cursor: z.string().max(200).optional(),
      limit: z.number().int().min(1).max(FEED_PAGE_MAX).default(20),
    }),
  )
  .handler(async ({ input, context }) => {
    const viewerId = context.user?.id ?? null;
    const where = listableWhere(viewerId);
    if (input.kind) where.push(eq(forumPosts.kind, input.kind));
    if (input.category) where.push(eq(forumCategories.slug, input.category));
    if (input.teamId) where.push(eq(forumPosts.teamId, input.teamId));
    if (input.authorId) where.push(eq(forumPosts.authorId, input.authorId));
    if (input.tag) {
      where.push(
        inArray(
          forumPosts.id,
          db
            .select({ id: forumPostTags.postId })
            .from(forumPostTags)
            .innerJoin(forumTags, eq(forumPostTags.tagId, forumTags.id))
            .where(eq(forumTags.slug, input.tag)),
        ),
      );
    }

    // Pins only frame the two browsing views, never a tag, team or author list.
    const pinScope =
      input.sort === "latest" && !input.tag && !input.teamId && !input.authorId
        ? input.category
          ? ("category" as const)
          : ("global" as const)
        : null;
    let pinnedRows: CardRow[] = [];
    if (pinScope) {
      pinnedRows = await cardQuery()
        .where(and(...where, eq(forumPosts.pinnedScope, pinScope)))
        .orderBy(desc(forumPosts.pinnedAt))
        .limit(10);
      if (pinnedRows.length > 0) {
        where.push(
          notInArray(
            forumPosts.id,
            pinnedRows.map((r) => r.id),
          ),
        );
      }
    }

    let rows: CardRow[];
    let nextCursor: string | null = null;
    if (input.sort === "latest") {
      if (input.cursor) {
        const parsed = latestCursorSchema.safeParse(safeJson(input.cursor));
        if (!parsed.success) throw new ORPCError("BAD_REQUEST", { message: "Bad cursor." });
        const { publishedAt, id } = parsed.data;
        where.push(
          or(
            lt(forumPosts.publishedAt, publishedAt),
            and(eq(forumPosts.publishedAt, publishedAt), lt(forumPosts.id, id)),
          )!,
        );
      }
      rows = await cardQuery()
        .where(and(...where))
        .orderBy(desc(forumPosts.publishedAt), desc(forumPosts.id))
        .limit(input.limit + 1);
      if (rows.length > input.limit) {
        rows = rows.slice(0, input.limit);
        const last = rows[rows.length - 1]!;
        nextCursor = JSON.stringify({ publishedAt: last.publishedAt, id: last.id });
      }
    } else {
      if (input.window !== "all") {
        const days = TOP_WINDOWS[input.window];
        where.push(gte(forumPosts.publishedAt, new Date(Date.now() - days * 86_400_000)));
      }
      const offset = input.cursor ? Number(input.cursor) : 0;
      if (!Number.isSafeInteger(offset) || offset < 0) {
        throw new ORPCError("BAD_REQUEST", { message: "Bad cursor." });
      }
      rows = await cardQuery()
        .where(and(...where))
        .orderBy(
          desc(sql`${forumPosts.likeCount} + 2 * coalesce(${threads.commentCount}, 0)`),
          desc(forumPosts.publishedAt),
          desc(forumPosts.id),
        )
        .limit(input.limit + 1)
        .offset(offset);
      if (rows.length > input.limit) {
        rows = rows.slice(0, input.limit);
        nextCursor = String(offset + input.limit);
      }
    }

    const [pinned, posts] = await Promise.all([
      input.cursor ? Promise.resolve([]) : serializeCards(pinnedRows, viewerId),
      serializeCards(rows, viewerId),
    ]);
    return { pinned, posts, nextCursor };
  });

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Who may edit and delete a post: its author, its co-authors, and — for a
 *  team devlog — the team's owner. Staff powers are separate. */
export async function forumPostRights(
  post: { id: number; authorId: string | null; teamId: string | null },
  viewerId: string,
): Promise<{ canEdit: boolean; canDelete: boolean }> {
  const isAuthor = post.authorId === viewerId;
  const [coAuthor, owner] = await Promise.all([
    isAuthor
      ? Promise.resolve(false)
      : db
          .select({ userId: forumPostAuthors.userId })
          .from(forumPostAuthors)
          .where(and(eq(forumPostAuthors.postId, post.id), eq(forumPostAuthors.userId, viewerId)))
          .limit(1)
          .then((r) => r.length > 0),
    post.teamId
      ? db
          .select({ id: teamMembers.id })
          .from(teamMembers)
          .where(
            and(
              eq(teamMembers.teamId, post.teamId),
              eq(teamMembers.userId, viewerId),
              eq(teamMembers.role, "owner"),
            ),
          )
          .limit(1)
          .then((r) => r.length > 0)
      : Promise.resolve(false),
  ]);
  return { canEdit: isAuthor || coAuthor || owner, canDelete: isAuthor || owner };
}

/**
 * One post, for its page. Never null for a post that exists and was
 * published: a hidden or deleted post still answers, with `visibility`
 * saying why and the content stripped, so the page can render the notice
 * and keep the thread underneath readable. Staff and the post's own editors
 * see a hidden post's content; a draft answers only to its editors.
 */
export const getForumPost = os
  .use(forumRead)
  .input(z.object({ postId: z.number().int().positive() }))
  .handler(async ({ input, context }) => {
    const viewerId = context.user?.id ?? null;
    const [row] = await cardQuery().where(eq(forumPosts.id, input.postId)).limit(1);
    if (!row) return null;

    const [post] = await db
      .select()
      .from(forumPosts)
      .where(eq(forumPosts.id, input.postId))
      .limit(1);
    if (!post) return null;

    const [isStaff, rights] = await Promise.all([
      viewerIsStaff(viewerId),
      viewerId
        ? forumPostRights(post, viewerId)
        : Promise.resolve({ canEdit: false, canDelete: false }),
    ]);

    if (post.status === "draft" && !rights.canEdit) return null;

    const visibility = post.deletedAt
      ? ("deleted" as const)
      : post.hiddenAt || row.teamHiddenAt
        ? ("hidden" as const)
        : ("visible" as const);
    const showContent =
      visibility === "visible" || isStaff || (visibility === "hidden" && rights.canEdit);

    const [[card], images, links] = await Promise.all([
      serializeCards([row], viewerId),
      showContent ? imagesByPost([post.id], FORUM_LIMITS.devlog.images) : Promise.resolve(null),
      showContent ? loadLinks(post) : Promise.resolve(null),
    ]);

    return {
      ...card!,
      title: showContent ? card!.title : null,
      excerpt: showContent ? card!.excerpt : null,
      coverUrl: showContent ? card!.coverUrl : null,
      tags: showContent ? card!.tags : [],
      body: showContent ? post.body : null,
      images: images?.get(post.id) ?? [],
      status: post.status,
      visibility,
      hiddenReason: isStaff || rights.canEdit ? post.hiddenReason : null,
      links: links ?? { project: null, jam: null, collabPost: null },
      viewer: {
        ...card!.viewer,
        canEdit: rights.canEdit && !post.deletedAt,
        canDelete: rights.canDelete && !post.deletedAt,
        isStaff,
      },
    };
  });

async function loadLinks(post: {
  projectId: string | null;
  jamId: number | null;
  collabPostId: number | null;
}) {
  const [project, jam, collabPost] = await Promise.all([
    post.projectId
      ? db
          .select({
            id: projects.id,
            slug: projects.slug,
            title: projects.title,
            imageKey: projects.imageKey,
            imageUrl: projects.imageUrl,
          })
          .from(projects)
          .where(eq(projects.id, post.projectId))
          .limit(1)
          .then(async ([p]) => {
            if (!p) return null;
            const { imageKey, ...rest } = p;
            return {
              ...rest,
              imageUrl: (await getProfileProjectImageUrl(imageKey)) ?? rest.imageUrl,
            };
          })
      : null,
    post.jamId
      ? db
          .select({ jamId: itchJams.jamId, title: itchJams.title, slug: itchJams.slug })
          .from(itchJams)
          .where(eq(itchJams.jamId, post.jamId))
          .limit(1)
          .then(([j]) => j ?? null)
      : null,
    post.collabPostId
      ? db
          .select({ id: collabPosts.id, title: collabPosts.title, status: collabPosts.status })
          .from(collabPosts)
          .where(eq(collabPosts.id, post.collabPostId))
          .limit(1)
          .then(([c]) => c ?? null)
      : null,
  ]);
  return { project, jam, collabPost };
}

/**
 * Tag autocomplete: active tags by prefix, most used first. An empty query
 * is the trending list.
 */
export const searchForumTags = os
  .use(forumRead)
  .input(
    z.object({
      query: z.string().max(40).default(""),
      limit: z.number().int().min(1).max(20).default(10),
    }),
  )
  .handler(async ({ input }) => {
    const where: SQL[] = [
      eq(forumTags.status, "active"),
      isNull(forumTags.mergedIntoId),
      sql`${forumTags.usageCount} > 0`,
    ];
    const prefix = normalizeTagSlug(input.query) ?? input.query.trim().replace(/^#+/, "");
    if (prefix) where.push(ilike(forumTags.slug, `${prefix.replace(/[%_\\]/g, "\\$&")}%`));
    return db
      .select({ slug: forumTags.slug, name: forumTags.name, usageCount: forumTags.usageCount })
      .from(forumTags)
      .where(and(...where))
      .orderBy(desc(forumTags.usageCount), asc(forumTags.slug))
      .limit(input.limit);
  });

// ── Writes ───────────────────────────────────────────────────────────────────

const linkFields = {
  projectId: z.string().max(64).nullish(),
  jamId: z.number().int().positive().nullish(),
  collabPostId: z.number().int().positive().nullish(),
};

const contentFields = {
  title: z.string().trim().max(FORUM_LIMITS.devlog.title).nullish(),
  body: z.string().trim().min(1).max(FORUM_LIMITS.devlog.body),
  category: z.string().max(64).optional(),
  tags: z.array(z.string().max(40)).max(FORUM_MAX_TAGS).default([]),
  ...linkFields,
};

type ContentInput = {
  title?: string | null;
  body: string;
  tags: string[];
};

/** Kind-specific limits the shared schema can't express. */
function checkContent(kind: ForumPostKind, input: ContentInput): string | null {
  const limits = FORUM_LIMITS[kind];
  const title = input.title?.trim() || null;
  if (kind === "post" && title) {
    throw new ORPCError("BAD_REQUEST", { message: "Short posts don't take a title." });
  }
  if (kind !== "post" && !title) {
    throw new ORPCError("BAD_REQUEST", { message: "Give it a title." });
  }
  if (title && title.length > limits.title) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Keep the title under ${limits.title} characters.`,
    });
  }
  if (input.body.length > limits.body) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Keep it under ${limits.body.toLocaleString("en-US")} characters.`,
    });
  }
  checkProfanity(title, "Title");
  return title;
}

async function resolveCategory(slug: string, userId: string): Promise<number> {
  const [category] = await db
    .select()
    .from(forumCategories)
    .where(and(eq(forumCategories.slug, slug), isNull(forumCategories.archivedAt)))
    .limit(1);
  if (!category) {
    throw new ORPCError("BAD_REQUEST", { message: "That category doesn't exist." });
  }
  if (category.postingPolicy === "staff" && !(await viewerIsStaff(userId))) {
    throw new ORPCError("FORBIDDEN", { message: `Only staff post in ${category.name}.` });
  }
  return category.id;
}

/** Posting as a team: an active, visible team the poster belongs to. */
async function assertCanPostAsTeam(teamId: string, userId: string): Promise<void> {
  const [row] = await db
    .select({ status: teams.status, hiddenAt: teams.hiddenAt, memberId: teamMembers.id })
    .from(teams)
    .leftJoin(teamMembers, and(eq(teamMembers.teamId, teams.id), eq(teamMembers.userId, userId)))
    .where(eq(teams.id, teamId))
    .limit(1);
  if (!row) throw new ORPCError("BAD_REQUEST", { message: "That team no longer exists." });
  if (!row.memberId) {
    throw new ORPCError("FORBIDDEN", { message: "You can only post as a team you're on." });
  }
  if (row.status !== "active") {
    throw new ORPCError("BAD_REQUEST", { message: "That team has been archived." });
  }
  if (row.hiddenAt) {
    throw new ORPCError("BAD_REQUEST", { message: "That team is unavailable right now." });
  }
}

async function assertLinksExist(input: {
  projectId?: string | null;
  jamId?: number | null;
  collabPostId?: number | null;
}): Promise<void> {
  const [project, jam, collabPost] = await Promise.all([
    input.projectId
      ? db.select({ id: projects.id }).from(projects).where(eq(projects.id, input.projectId))
      : [true],
    input.jamId
      ? db.select({ id: itchJams.jamId }).from(itchJams).where(eq(itchJams.jamId, input.jamId))
      : [true],
    input.collabPostId
      ? db
          .select({ id: collabPosts.id })
          .from(collabPosts)
          .where(eq(collabPosts.id, input.collabPostId))
      : [true],
  ]);
  if (project.length === 0) throw new ORPCError("BAD_REQUEST", { message: "Unknown project." });
  if (jam.length === 0) throw new ORPCError("BAD_REQUEST", { message: "Unknown jam." });
  if (collabPost.length === 0) {
    throw new ORPCError("BAD_REQUEST", { message: "Unknown collab post." });
  }
}

/**
 * Free-text tags → tag ids, creating the ones that don't exist yet. A
 * banned tag refuses the post; a merged one resolves to its target.
 */
async function resolveTags(raw: string[], userId: string): Promise<number[]> {
  const slugs = [...new Set(raw.map(normalizeTagSlug))];
  if (slugs.some((s) => s == null)) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Tags are 2–32 letters, numbers or dashes.",
    });
  }
  const wanted = slugs as string[];
  if (wanted.length === 0) return [];
  const reserved = wanted.find((slug) => FORUM_RESERVED_TAGS[slug]);
  if (reserved) throw new ORPCError("BAD_REQUEST", { message: FORUM_RESERVED_TAGS[reserved] });
  for (const slug of wanted) checkProfanity(slug, `#${slug}`);

  const existing = await db.select().from(forumTags).where(inArray(forumTags.slug, wanted));
  const bySlug = new Map(existing.map((t) => [t.slug, t]));

  const mergeTargets = existing.map((t) => t.mergedIntoId).filter((id): id is number => id != null);
  const targets = mergeTargets.length
    ? await db.select().from(forumTags).where(inArray(forumTags.id, mergeTargets))
    : [];
  const targetById = new Map(targets.map((t) => [t.id, t]));

  const ids: number[] = [];
  const missing: string[] = [];
  for (const slug of wanted) {
    const tag = bySlug.get(slug);
    if (!tag) {
      missing.push(slug);
      continue;
    }
    const resolved = tag.mergedIntoId ? targetById.get(tag.mergedIntoId) : tag;
    if (!resolved || tag.status === "banned" || resolved.status === "banned") {
      throw new ORPCError("BAD_REQUEST", { message: `#${slug} can't be used.` });
    }
    ids.push(resolved.id);
  }

  for (const slug of missing) {
    await assertRateLimit(
      "forum-tag",
      userId,
      20,
      "You've made a lot of new tags today — pick from the existing ones.",
      86400,
    );
    await db
      .insert(forumTags)
      .values({ slug, name: slug, createdById: userId })
      .onConflictDoNothing();
  }
  if (missing.length > 0) {
    const created = await db
      .select({ id: forumTags.id })
      .from(forumTags)
      .where(inArray(forumTags.slug, missing));
    ids.push(...created.map((t) => t.id));
  }
  return [...new Set(ids)];
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Replace a post's tag links and recount only the tags that moved. */
async function writeTags(tx: Tx, postId: number, tagIds: number[]): Promise<void> {
  const before = await tx
    .select({ tagId: forumPostTags.tagId })
    .from(forumPostTags)
    .where(eq(forumPostTags.postId, postId));
  const beforeIds = new Set(before.map((r) => r.tagId));
  const afterIds = new Set(tagIds);
  const removed = [...beforeIds].filter((id) => !afterIds.has(id));
  const added = tagIds.filter((id) => !beforeIds.has(id));

  if (removed.length > 0) {
    await tx
      .delete(forumPostTags)
      .where(and(eq(forumPostTags.postId, postId), inArray(forumPostTags.tagId, removed)));
  }
  if (added.length > 0) {
    await tx.insert(forumPostTags).values(added.map((tagId) => ({ postId, tagId })));
  }
  const changed = [...removed, ...added];
  if (changed.length > 0) {
    await tx
      .update(forumTags)
      .set({
        usageCount: sql`(SELECT count(*)::int FROM ${forumPostTags} WHERE ${forumPostTags.tagId} = ${forumTags.id})`,
      })
      .where(inArray(forumTags.id, changed));
  }
}

async function assertPublishAllowed(userId: string, teamId: string | null): Promise<void> {
  await assertRateLimit("forum-post", userId, 10, "You're posting a lot — try again in a bit.");
  if (teamId) {
    await assertRateLimit(
      "forum-devlog-team",
      teamId,
      5,
      "This team has published five devlogs today — save this one as a draft.",
      86400,
    );
  }
}

export const createForumPost = os
  .use(forumWrite)
  .input(
    z.object({
      kind: kindSchema,
      ...contentFields,
      teamId: z.string().max(64).nullish(),
      draft: z.boolean().default(false),
    }),
  )
  .handler(async ({ input, context }) => {
    const userId = context.user.id;
    const title = checkContent(input.kind, input);
    const teamId = input.teamId ?? null;
    if (teamId && input.kind !== "devlog") {
      throw new ORPCError("BAD_REQUEST", { message: "Only devlogs are posted as a team." });
    }
    if (input.draft && input.kind !== "devlog") {
      throw new ORPCError("BAD_REQUEST", { message: "Only devlogs can be saved as drafts." });
    }

    const categoryId = await resolveCategory(
      input.category ?? FORUM_DEFAULT_CATEGORY[input.kind],
      userId,
    );
    if (teamId) await assertCanPostAsTeam(teamId, userId);
    await assertLinksExist(input);

    if (input.draft) {
      const [drafts] = await db
        .select({ value: count() })
        .from(forumPosts)
        .where(
          and(
            eq(forumPosts.authorId, userId),
            eq(forumPosts.status, "draft"),
            isNull(forumPosts.deletedAt),
          ),
        );
      if ((drafts?.value ?? 0) >= MAX_DRAFTS) {
        throw new ORPCError("BAD_REQUEST", {
          message: `You have ${MAX_DRAFTS} drafts — publish or delete one first.`,
        });
      }
    } else {
      await assertPublishAllowed(userId, teamId);
    }

    const tagIds = await resolveTags(input.tags, userId);
    const now = new Date();

    const post = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(forumPosts)
        .values({
          kind: input.kind,
          categoryId,
          authorId: userId,
          teamId,
          title,
          slug: forumPostSlug(title) || null,
          body: input.body,
          excerpt: markdownToPlainText(input.body, 200) ?? null,
          projectId: input.projectId ?? null,
          jamId: input.jamId ?? null,
          collabPostId: input.collabPostId ?? null,
          status: input.draft ? "draft" : "published",
          publishedAt: input.draft ? null : now,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!row) throw new Error("forum post insert returned no row");
      await writeTags(tx, row.id, tagIds);
      return row;
    });

    await touchTeamActivity(teamId);

    if (post.status === "published") {
      captureServerEvent(EVENTS.forumPostCreated, userId, {
        post_id: post.id,
        kind: post.kind,
        as_team: teamId != null,
        category: input.category ?? FORUM_DEFAULT_CATEGORY[input.kind],
        tag_count: tagIds.length,
      });
    }

    return { id: post.id, slug: post.slug, status: post.status };
  });

type ForumPostRow = typeof forumPosts.$inferSelect;

async function loadEditablePost(postId: number, userId: string) {
  const [post] = await db.select().from(forumPosts).where(eq(forumPosts.id, postId)).limit(1);
  if (!post || post.deletedAt) throw new ORPCError("NOT_FOUND", { message: "Post not found." });
  const rights = await forumPostRights(post, userId);
  return { post, rights };
}

/**
 * Edit, and publish a draft. The kind and the posting team are fixed at
 * creation. `editedAt` only moves for posts already public — tidying a
 * draft is not an edit anyone saw.
 */
export const updateForumPost = os
  .use(forumWrite)
  .input(
    z.object({
      postId: z.number().int().positive(),
      ...contentFields,
      publish: z.boolean().default(false),
    }),
  )
  .handler(async ({ input, context }) => {
    const userId = context.user.id;
    const { post, rights } = await loadEditablePost(input.postId, userId);
    if (!rights.canEdit) {
      throw new ORPCError("FORBIDDEN", { message: "You can't edit this post." });
    }
    if (post.hiddenAt) {
      throw new ORPCError("FORBIDDEN", { message: "A hidden post can't be edited." });
    }

    const title = checkContent(post.kind, input);
    const categoryId = input.category
      ? await resolveCategory(input.category, userId)
      : post.categoryId;
    await assertLinksExist(input);

    const publishing = post.status === "draft" && input.publish;
    if (publishing) {
      if (post.teamId) await assertCanPostAsTeam(post.teamId, userId);
      await assertPublishAllowed(userId, post.teamId);
    }

    const tagIds = await resolveTags(input.tags, userId);
    const now = new Date();

    await db.transaction(async (tx) => {
      await tx
        .update(forumPosts)
        .set({
          title,
          slug: forumPostSlug(title) || null,
          body: input.body,
          excerpt: markdownToPlainText(input.body, 200) ?? null,
          categoryId,
          projectId: input.projectId ?? null,
          jamId: input.jamId ?? null,
          collabPostId: input.collabPostId ?? null,
          ...(publishing ? { status: "published" as const, publishedAt: now } : {}),
          ...(post.status === "published" ? { editedAt: now } : {}),
          updatedAt: now,
        })
        .where(eq(forumPosts.id, post.id));
      await writeTags(tx, post.id, tagIds);
    });

    if (publishing) {
      await touchTeamActivity(post.teamId);
      captureServerEvent(EVENTS.forumPostCreated, userId, {
        post_id: post.id,
        kind: post.kind,
        as_team: post.teamId != null,
        category: input.category,
        tag_count: tagIds.length,
      });
    }

    return { id: post.id, slug: forumPostSlug(title) || null };
  });

/**
 * Soft delete. The tombstone keeps the thread readable and the post's tag
 * links counted — usage is a popularity signal, not a moderation surface.
 */
export const deleteForumPost = os
  .use(forumWrite)
  .input(z.object({ postId: z.number().int().positive() }))
  .handler(async ({ input, context }) => {
    const { post, rights } = await loadEditablePost(input.postId, context.user.id);
    if (!rights.canDelete) {
      throw new ORPCError("FORBIDDEN", { message: "You can't delete this post." });
    }
    await softDeleteForumPost(post);
    return { success: true };
  });

/** Tombstone a post: unpinned, images gone, thread and tag links kept. */
async function softDeleteForumPost(post: ForumPostRow): Promise<void> {
  const images = await db
    .delete(forumPostImages)
    .where(eq(forumPostImages.postId, post.id))
    .returning({ imageKey: forumPostImages.imageKey });
  await db
    .update(forumPosts)
    .set({
      deletedAt: new Date(),
      pinnedAt: null,
      pinnedScope: null,
      coverImageKey: null,
      coverImageUrl: null,
      updatedAt: new Date(),
    })
    .where(eq(forumPosts.id, post.id));
  await purgeForumImages(post.id, [...images.map((i) => i.imageKey), post.coverImageKey]);
}

/** Best-effort object cleanup, only for keys in the post's own namespace. */
async function purgeForumImages(postId: number, keys: (string | null)[]): Promise<void> {
  for (const key of keys) {
    if (!key || !isForumPostImageKey(postId, key)) continue;
    await bestEffort("storage.image_cleanup", { key, on: "forum_post_image" }, () =>
      removeProfileProjectImageFromStorage(key),
    );
  }
}

async function loadImageEditablePost(postId: number, userId: string) {
  const { post, rights } = await loadEditablePost(postId, userId);
  if (!rights.canEdit) {
    throw new ORPCError("FORBIDDEN", { message: "Only the post's authors can change images." });
  }
  if (post.hiddenAt) {
    throw new ORPCError("FORBIDDEN", { message: "A hidden post can't be edited." });
  }
  return post;
}

function assertOwnKey(postId: number, imageKey: string): void {
  if (!isForumPostImageKey(postId, imageKey)) {
    throw new ORPCError("BAD_REQUEST", { message: "That image doesn't belong to this post." });
  }
}

/** Attach an image minted by `/api/forum/image`, up to the kind's cap. */
export const addForumPostImage = os
  .use(forumWrite)
  .input(
    z.object({
      postId: z.number().int().positive(),
      imageKey: z.string().max(300),
      url: uploadedImageUrlSchema,
      alt: z.string().trim().max(500).optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    const post = await loadImageEditablePost(input.postId, context.user.id);
    assertOwnKey(post.id, input.imageKey);

    const [existing] = await db
      .select({
        value: count(),
        last: sql<number>`coalesce(max(${forumPostImages.sortOrder}), -1)`,
      })
      .from(forumPostImages)
      .where(eq(forumPostImages.postId, post.id));
    const cap = FORUM_LIMITS[post.kind].images;
    if ((existing?.value ?? 0) >= cap) {
      throw new ORPCError("BAD_REQUEST", {
        message: `A ${post.kind} holds ${cap} images at most.`,
      });
    }

    const [image] = await db
      .insert(forumPostImages)
      .values({
        postId: post.id,
        imageKey: input.imageKey,
        url: input.url,
        alt: input.alt || null,
        sortOrder: Number(existing?.last ?? -1) + 1,
      })
      .returning({ id: forumPostImages.id, url: forumPostImages.url, alt: forumPostImages.alt });
    return image!;
  });

export const removeForumPostImage = os
  .use(forumWrite)
  .input(z.object({ imageId: z.number().int().positive() }))
  .handler(async ({ input, context }) => {
    const [image] = await db
      .select()
      .from(forumPostImages)
      .where(eq(forumPostImages.id, input.imageId))
      .limit(1);
    if (!image) throw new ORPCError("NOT_FOUND", { message: "Image not found." });
    await loadImageEditablePost(image.postId, context.user.id);

    await db.delete(forumPostImages).where(eq(forumPostImages.id, image.id));
    await purgeForumImages(image.postId, [image.imageKey]);
    return { success: true };
  });

/** A devlog's cover; `null` clears it. The replaced object is swept. */
export const setForumPostCover = os
  .use(forumWrite)
  .input(
    z.object({
      postId: z.number().int().positive(),
      imageKey: z.string().max(300).nullable(),
      url: uploadedImageUrlSchema.nullable(),
    }),
  )
  .handler(async ({ input, context }) => {
    const post = await loadImageEditablePost(input.postId, context.user.id);
    if (post.kind !== "devlog") {
      throw new ORPCError("BAD_REQUEST", { message: "Only devlogs have a cover." });
    }
    if (input.imageKey) assertOwnKey(post.id, input.imageKey);

    await db
      .update(forumPosts)
      .set({
        coverImageKey: input.imageKey,
        coverImageUrl: input.imageKey ? input.url : null,
        updatedAt: new Date(),
      })
      .where(eq(forumPosts.id, post.id));
    if (post.coverImageKey && post.coverImageKey !== input.imageKey) {
      await purgeForumImages(post.id, [post.coverImageKey]);
    }
    return { coverUrl: input.imageKey ? input.url : null };
  });

/** A published, live post someone may react to, save or report. */
async function loadInteractablePost(postId: number, viewerId: string) {
  const [row] = await db
    .select({ id: forumPosts.id, authorId: forumPosts.authorId })
    .from(forumPosts)
    .innerJoin(forumCategories, eq(forumPosts.categoryId, forumCategories.id))
    .leftJoin(teams, eq(forumPosts.teamId, teams.id))
    .leftJoin(user, eq(forumPosts.authorId, user.id))
    .where(and(eq(forumPosts.id, postId), ...listableWhere(viewerId)))
    .limit(1);
  if (!row) throw new ORPCError("NOT_FOUND", { message: "Post not found." });
  return row;
}

/**
 * Like or unlike. The count moves only when a row actually changed, in the
 * same transaction, so a double click or a retry can't drift it.
 */
export const setForumReaction = os
  .use(forumWrite)
  .input(z.object({ postId: z.number().int().positive(), liked: z.boolean() }))
  .handler(async ({ input, context }) => {
    const userId = context.user.id;
    await loadInteractablePost(input.postId, userId);
    if (input.liked) {
      await assertRateLimit("forum-like", userId, 120, "Easy there — try again in a bit.");
    }

    const likeCount = await db.transaction(async (tx) => {
      const changed = input.liked
        ? await tx
            .insert(forumReactions)
            .values({ postId: input.postId, userId })
            .onConflictDoNothing()
            .returning({ postId: forumReactions.postId })
        : await tx
            .delete(forumReactions)
            .where(and(eq(forumReactions.postId, input.postId), eq(forumReactions.userId, userId)))
            .returning({ postId: forumReactions.postId });
      const delta = changed.length === 0 ? 0 : input.liked ? 1 : -1;
      const [row] = await tx
        .update(forumPosts)
        .set({ likeCount: sql`greatest(${forumPosts.likeCount} + ${delta}, 0)` })
        .where(eq(forumPosts.id, input.postId))
        .returning({ likeCount: forumPosts.likeCount });
      return { count: row?.likeCount ?? 0, added: delta > 0 };
    });

    if (likeCount.added) {
      captureServerEvent(EVENTS.forumReactionAdded, userId, { post_id: input.postId });
    }
    return { liked: input.liked, likeCount: likeCount.count };
  });

export const setForumBookmark = os
  .use(forumWrite)
  .input(z.object({ postId: z.number().int().positive(), saved: z.boolean() }))
  .handler(async ({ input, context }) => {
    const userId = context.user.id;
    await loadInteractablePost(input.postId, userId);
    if (input.saved) {
      await db
        .insert(forumBookmarks)
        .values({ userId, postId: input.postId })
        .onConflictDoNothing();
    } else {
      await db
        .delete(forumBookmarks)
        .where(and(eq(forumBookmarks.userId, userId), eq(forumBookmarks.postId, input.postId)));
    }
    return { saved: input.saved };
  });

export const reportForumPost = os
  .use(forumSignedIn)
  .input(
    z.object({
      postId: z.number().int().positive(),
      reason: z.string().trim().min(1).max(1000),
    }),
  )
  .handler(async ({ input, context }) => {
    const userId = context.user.id;
    await loadInteractablePost(input.postId, userId);

    const [open] = await db
      .select({ id: forumPostReports.id })
      .from(forumPostReports)
      .where(
        and(
          eq(forumPostReports.postId, input.postId),
          eq(forumPostReports.reporterId, userId),
          isNull(forumPostReports.resolvedAt),
        ),
      )
      .limit(1);
    if (open) {
      throw new ORPCError("BAD_REQUEST", { message: "You've already reported this post." });
    }

    // The shared report bucket, so spam across surfaces is 10/hr in total.
    await assertRateLimit("report", userId, 10, "Too many reports — try again later.");

    await db
      .insert(forumPostReports)
      .values({ postId: input.postId, reporterId: userId, reason: input.reason });
    return { success: true };
  });

// ── Moderation ───────────────────────────────────────────────────────────────

const forumStaff = os.use(requireStaff).use(forumEnabledForUser);

async function loadPostForStaff(postId: number): Promise<ForumPostRow> {
  const [post] = await db.select().from(forumPosts).where(eq(forumPosts.id, postId)).limit(1);
  if (!post) throw new ORPCError("NOT_FOUND", { message: "Post not found." });
  return post;
}

function postSnapshot(post: ForumPostRow) {
  return {
    subjectTitle: forumPostTitle(post),
    subjectUrl: `/forum/${post.id}`,
  };
}

async function notifyForumAuthor(
  post: ForumPostRow,
  type:
    | "forum_post_hidden_by_staff"
    | "forum_post_unhidden_by_staff"
    | "forum_post_deleted_by_staff",
  mod: ModOverride,
): Promise<void> {
  if (!post.authorId || post.authorId === mod.actorId) return;
  const authorId = post.authorId;
  await bestEffort("forum.moderation_notice", { post_id: post.id, type }, () =>
    notify({
      userId: authorId,
      type,
      actorId: mod.actorId,
      entityType: "forum_post",
      entityId: String(post.id),
      data: { ...postSnapshot(post), ...(mod.reason ? { reason: mod.reason } : {}) },
    }),
  );
}

async function applyForumPostHidden(
  post: ForumPostRow,
  hidden: boolean,
  mod: ModOverride,
  extraMetadata: Record<string, unknown> = {},
): Promise<{ changed: boolean }> {
  const [updated] = await db
    .update(forumPosts)
    .set(
      hidden
        ? {
            hiddenAt: new Date(),
            hiddenById: mod.actorId,
            hiddenReason: mod.reason,
            pinnedAt: null,
            pinnedScope: null,
          }
        : { hiddenAt: null, hiddenById: null, hiddenReason: null },
    )
    .where(
      and(
        eq(forumPosts.id, post.id),
        hidden ? isNull(forumPosts.hiddenAt) : sql`${forumPosts.hiddenAt} IS NOT NULL`,
      ),
    )
    .returning({ id: forumPosts.id });
  if (!updated) return { changed: false };

  await recordModerationAction({
    action: hidden ? "forum_post_hidden" : "forum_post_unhidden",
    actorId: mod.actorId,
    targetType: "forum_post",
    targetId: post.id,
    subjectUserId: post.authorId,
    reason: mod.reason,
    metadata: { title: forumPostTitle(post), ...extraMetadata },
  });
  await notifyForumAuthor(
    post,
    hidden ? "forum_post_hidden_by_staff" : "forum_post_unhidden_by_staff",
    mod,
  );
  return { changed: true };
}

async function applyForumPostDeleted(
  post: ForumPostRow,
  mod: ModOverride,
  extraMetadata: Record<string, unknown> = {},
): Promise<void> {
  if (post.deletedAt) return;
  await softDeleteForumPost(post);
  await recordModerationAction({
    action: "forum_post_deleted",
    actorId: mod.actorId,
    targetType: "forum_post",
    targetId: post.id,
    subjectUserId: post.authorId,
    reason: mod.reason,
    metadata: { title: forumPostTitle(post), kind: post.kind, ...extraMetadata },
  });
  await notifyForumAuthor(post, "forum_post_deleted_by_staff", mod);
}

const staffReason = z.string().trim().max(500).optional();

/** Hide or unhide. Hiding needs a reason — it is the author's explanation. */
export const setForumPostHidden = forumStaff
  .input(
    z.object({ postId: z.number().int().positive(), hidden: z.boolean(), reason: staffReason }),
  )
  .handler(async ({ input, context }) => {
    if (input.hidden && !input.reason) {
      throw new ORPCError("BAD_REQUEST", { message: "A reason is required to hide a post." });
    }
    const post = await loadPostForStaff(input.postId);
    return applyForumPostHidden(post, input.hidden, {
      actorId: context.user.id,
      reason: input.reason ?? null,
    });
  });

/** Pin to the whole feed, to the post's category board, or unpin (`null`). */
export const setForumPostPinned = forumStaff
  .input(
    z.object({
      postId: z.number().int().positive(),
      scope: z.enum(["global", "category"]).nullable(),
      reason: staffReason,
    }),
  )
  .handler(async ({ input, context }) => {
    const post = await loadPostForStaff(input.postId);
    if (input.scope && (post.status !== "published" || post.deletedAt || post.hiddenAt)) {
      throw new ORPCError("BAD_REQUEST", { message: "Only a live post can be pinned." });
    }
    if (post.pinnedScope === input.scope) return { changed: false };

    await db
      .update(forumPosts)
      .set({ pinnedAt: input.scope ? new Date() : null, pinnedScope: input.scope })
      .where(eq(forumPosts.id, post.id));
    await recordModerationAction({
      action: input.scope ? "forum_post_pinned" : "forum_post_unpinned",
      actorId: context.user.id,
      targetType: "forum_post",
      targetId: post.id,
      subjectUserId: post.authorId,
      reason: input.reason,
      metadata: { title: forumPostTitle(post), scope: input.scope, previous: post.pinnedScope },
    });
    return { changed: true };
  });

/**
 * Move to another category and/or replace the tags. Not an author edit:
 * `editedAt` stays put, and each half logs separately with before/after.
 */
export const staffUpdateForumPost = forumStaff
  .input(
    z.object({
      postId: z.number().int().positive(),
      category: z.string().max(64).optional(),
      tags: z.array(z.string().max(40)).max(FORUM_MAX_TAGS).optional(),
      reason: staffReason,
    }),
  )
  .handler(async ({ input, context }) => {
    const post = await loadPostForStaff(input.postId);
    const mod = { actorId: context.user.id, reason: input.reason ?? null };

    if (input.category) {
      const categoryId = await resolveCategory(input.category, context.user.id);
      if (categoryId !== post.categoryId) {
        const [from] = await db
          .select({ slug: forumCategories.slug })
          .from(forumCategories)
          .where(eq(forumCategories.id, post.categoryId));
        await db
          .update(forumPosts)
          .set({
            categoryId,
            pinnedAt: post.pinnedScope === "category" ? null : post.pinnedAt,
            pinnedScope: post.pinnedScope === "category" ? null : post.pinnedScope,
          })
          .where(eq(forumPosts.id, post.id));
        await recordModerationAction({
          action: "forum_post_moved",
          actorId: mod.actorId,
          targetType: "forum_post",
          targetId: post.id,
          subjectUserId: post.authorId,
          reason: mod.reason,
          metadata: { title: forumPostTitle(post), from: from?.slug, to: input.category },
        });
      }
    }

    if (input.tags) {
      const before = (await tagsByPost([post.id])).get(post.id) ?? [];
      const tagIds = await resolveTags(input.tags, context.user.id);
      await db.transaction((tx) => writeTags(tx, post.id, tagIds));
      const after = (await tagsByPost([post.id])).get(post.id) ?? [];
      if (before.join() !== after.join()) {
        await recordModerationAction({
          action: "forum_post_retagged",
          actorId: mod.actorId,
          targetType: "forum_post",
          targetId: post.id,
          subjectUserId: post.authorId,
          reason: mod.reason,
          metadata: { title: forumPostTitle(post), before, after },
        });
      }
    }
    return { success: true };
  });

export const staffDeleteForumPost = forumStaff
  .input(z.object({ postId: z.number().int().positive(), reason: staffReason }))
  .handler(async ({ input, context }) => {
    const post = await loadPostForStaff(input.postId);
    await applyForumPostDeleted(post, { actorId: context.user.id, reason: input.reason ?? null });
    return { success: true };
  });

async function profilesById(ids: (string | null)[]) {
  const wanted = [...new Set(ids.filter((id): id is string => id != null))];
  if (wanted.length === 0)
    return new Map<string, { id: string; displayName: string; avatarUrl: string | null }>();
  const rows = await db
    .select({
      id: developerProfiles.id,
      discordUsername: developerProfiles.discordUsername,
      guildNickname: developerProfiles.guildNickname,
      avatarUrl: developerProfiles.avatarUrl,
    })
    .from(developerProfiles)
    .where(inArray(developerProfiles.id, wanted));
  return new Map(
    rows.map((p) => [
      p.id,
      { id: p.id, displayName: memberName(p, "Member"), avatarUrl: p.avatarUrl },
    ]),
  );
}

/** The forum half of the admin report queue, shaped like `listReports`. */
export const listForumReports = forumStaff
  .input(z.object({ includeResolved: z.boolean().default(false) }))
  .handler(async ({ input }) => {
    const rows = await db
      .select({
        id: forumPostReports.id,
        postId: forumPostReports.postId,
        reporterId: forumPostReports.reporterId,
        reason: forumPostReports.reason,
        createdAt: forumPostReports.createdAt,
        resolvedAt: forumPostReports.resolvedAt,
        postKind: forumPosts.kind,
        postTitle: forumPosts.title,
        postExcerpt: forumPosts.excerpt,
        postAuthorId: forumPosts.authorId,
        postHiddenAt: forumPosts.hiddenAt,
        postDeletedAt: forumPosts.deletedAt,
      })
      .from(forumPostReports)
      .innerJoin(forumPosts, eq(forumPostReports.postId, forumPosts.id))
      .where(input.includeResolved ? undefined : isNull(forumPostReports.resolvedAt))
      .orderBy(
        sql`${forumPostReports.resolvedAt} ASC NULLS FIRST`,
        desc(forumPostReports.createdAt),
      );

    const people = await profilesById(rows.flatMap((r) => [r.reporterId, r.postAuthorId]));
    return rows.map(({ postTitle, postExcerpt, ...r }) => ({
      ...r,
      postTitle: forumPostTitle({ title: postTitle, excerpt: postExcerpt }),
      reporter: people.get(r.reporterId) ?? null,
      postAuthor: r.postAuthorId ? (people.get(r.postAuthorId) ?? null) : null,
    }));
  });

/**
 * Dismiss, hide or delete — resolving every open report on the post, and
 * telling each reporter the outcome, the same way the other queues do.
 */
export const resolveForumReport = forumStaff
  .input(
    z.object({
      reportId: z.number().int().positive(),
      action: z.enum(["dismiss", "hide_post", "delete_post"]),
      reason: staffReason,
    }),
  )
  .handler(async ({ input, context }) => {
    const [report] = await db
      .select()
      .from(forumPostReports)
      .where(eq(forumPostReports.id, input.reportId))
      .limit(1);
    if (!report) throw new ORPCError("NOT_FOUND", { message: "Report not found." });
    if (report.resolvedAt) return { success: true };

    const post = await loadPostForStaff(report.postId);
    const mod = { actorId: context.user.id, reason: input.reason ?? null };
    const viaReport = { reportId: report.id, reportReason: report.reason };
    if (input.action === "hide_post") {
      await applyForumPostHidden(post, true, mod, viaReport);
    } else if (input.action === "delete_post") {
      await applyForumPostDeleted(post, mod, viaReport);
    }

    const resolved = await resolveReportsForSubject({
      kind: "forum_post",
      subjectId: post.id,
      actorId: context.user.id,
    });

    if (input.action === "dismiss") {
      await recordModerationAction({
        action: "forum_post_report_dismissed",
        actorId: context.user.id,
        targetType: "forum_post_report",
        targetId: report.id,
        subjectUserId: report.reporterId,
        reason: input.reason,
        metadata: {
          postId: post.id,
          reportReason: report.reason,
          ...(resolved.length > 1
            ? { alsoResolved: resolved.filter((r) => r.id !== report.id).map((r) => r.id) }
            : {}),
        },
      });
    }
    for (const sibling of resolved) {
      if (sibling.id === report.id) continue;
      await recordModerationAction({
        action:
          input.action === "hide_post"
            ? "forum_post_hidden"
            : input.action === "delete_post"
              ? "forum_post_deleted"
              : "forum_post_report_dismissed",
        actorId: context.user.id,
        targetType: "forum_post_report",
        targetId: sibling.id,
        subjectUserId: sibling.reporterId,
        reason: input.reason,
        metadata: { postId: post.id, resolvedVia: report.id },
      });
    }

    await notifyReporters({
      reports: resolved,
      actorId: context.user.id,
      outcome: input.action === "dismiss" ? "no_action" : "actioned",
      entityType: "forum_post",
      entityId: post.id,
      ...postSnapshot(post),
    });
    return { success: true };
  });

/**
 * The newest posts whatever their state — hidden, deleted and drafts
 * included — for the `/admin` sibling of recent comments.
 */
export const listRecentForumPosts = forumStaff
  .input(
    z.object({
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(50).default(15),
    }),
  )
  .handler(async ({ input }) => {
    const [totalRow] = await db.select({ value: count() }).from(forumPosts);
    const total = totalRow?.value ?? 0;
    const rows = await db
      .select({
        id: forumPosts.id,
        kind: forumPosts.kind,
        title: forumPosts.title,
        slug: forumPosts.slug,
        excerpt: forumPosts.excerpt,
        status: forumPosts.status,
        authorId: forumPosts.authorId,
        teamName: teams.name,
        category: forumCategories.name,
        categorySlug: forumCategories.slug,
        createdAt: forumPosts.createdAt,
        publishedAt: forumPosts.publishedAt,
        hiddenAt: forumPosts.hiddenAt,
        hiddenReason: forumPosts.hiddenReason,
        deletedAt: forumPosts.deletedAt,
        pinnedScope: forumPosts.pinnedScope,
        likeCount: forumPosts.likeCount,
        commentCount: sql<number>`coalesce(${threads.commentCount}, 0)`,
        lockedAt: threads.lockedAt,
      })
      .from(forumPosts)
      .innerJoin(forumCategories, eq(forumPosts.categoryId, forumCategories.id))
      .leftJoin(teams, eq(forumPosts.teamId, teams.id))
      .leftJoin(threads, eq(threads.forumPostId, forumPosts.id))
      .orderBy(desc(forumPosts.id))
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize);

    const people = await profilesById(rows.map((r) => r.authorId));
    return {
      posts: rows.map((r) => ({
        ...r,
        displayTitle: forumPostTitle(r),
        author: r.authorId ? (people.get(r.authorId) ?? null) : null,
      })),
      total,
      pageCount: Math.max(1, Math.ceil(total / input.pageSize)),
    };
  });
