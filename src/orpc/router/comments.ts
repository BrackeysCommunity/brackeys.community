import { ORPCError } from "@orpc/client";
import { os } from "@orpc/server";
import { and, asc, count, desc, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import * as z from "zod";

import { db } from "@/db";
import {
  collabPosts,
  commentReports,
  comments,
  developerProfiles,
  profileUrlStubs,
  threads,
  threadSubscriptions,
  userBlocks,
} from "@/db/schema";
import {
  findThread,
  loadSubject,
  resolveThread,
  subjectRefOfThread,
  type SubjectContext,
  type SubjectRef,
} from "@/lib/comment-subjects";
import { isStaffMember } from "@/lib/discord";
import { recordModerationAction } from "@/lib/moderation-audit";
import { notify } from "@/lib/notifications";
import { checkProfanity } from "@/lib/profanity";
import { checkRateLimit } from "@/lib/rate-limit";
import { resolveUserRoles } from "@/lib/staff-roles";
import { blockPairExists } from "@/lib/user-blocks";
import {
  authMiddleware,
  requireAuth,
  requireAuthWithPermissions,
  requireGuildMember,
  requireStaff,
} from "@/orpc/middleware/auth";

const subjectRefSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("collab_post"), id: z.number().int().positive() }),
  z.object({ type: z.literal("profile"), id: z.string().min(1) }),
]) satisfies z.ZodType<SubjectRef>;

/** Replies are flattened for display beyond this depth; storage caps at 8. */
const MAX_DEPTH = 8;
/** Reply rows fetched alongside one top-level page before chains truncate. */
const REPLY_PAGE_CAP = 200;

const NEUTRAL_BLOCK_MESSAGE = "You can't reply to this comment.";

// ── Row shaping ──────────────────────────────────────────────────────────────

type CommentRecord = typeof comments.$inferSelect;

type CommentAuthor = { id: string; name: string; avatarUrl: string | null; urlStub: string | null };

type SerializedComment = {
  id: number;
  parentId: number | null;
  rootId: number | null;
  depth: number;
  /** Null when tombstoned, redacted, or hidden — never shipped. */
  content: string | null;
  tombstone: "author" | "moderator" | null;
  /** Author is blocked by the viewer; UI collapses the row. */
  hidden: boolean;
  createdAt: Date;
  editedAt: Date | null;
  replyCount: number;
  hasMoreReplies?: boolean;
  author: CommentAuthor | null;
  viewer: { isMine: boolean; canEdit: boolean; canDelete: boolean };
};

async function authorsByIds(userIds: string[]): Promise<Map<string, CommentAuthor>> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return new Map();
  const [profiles, stubs] = await Promise.all([
    db
      .select({
        id: developerProfiles.id,
        discordUsername: developerProfiles.discordUsername,
        guildNickname: developerProfiles.guildNickname,
        avatarUrl: developerProfiles.avatarUrl,
      })
      .from(developerProfiles)
      .where(inArray(developerProfiles.id, ids)),
    db
      .select({ profileId: profileUrlStubs.profileId, stub: profileUrlStubs.stub })
      .from(profileUrlStubs)
      .where(inArray(profileUrlStubs.profileId, ids)),
  ]);
  const stubByUser = new Map(stubs.map((s) => [s.profileId, s.stub]));
  return new Map(
    profiles.map((p) => [
      p.id,
      {
        id: p.id,
        name: p.guildNickname ?? p.discordUsername ?? "Member",
        avatarUrl: p.avatarUrl,
        urlStub: stubByUser.get(p.id) ?? null,
      },
    ]),
  );
}

/** User ids the viewer has blocked (one-way: viewer as blocker). */
async function blockedByViewer(viewerId: string | null): Promise<Set<string>> {
  if (!viewerId) return new Set();
  const rows = await db
    .select({ blockedId: userBlocks.blockedId })
    .from(userBlocks)
    .where(eq(userBlocks.blockerId, viewerId));
  return new Set(rows.map((r) => r.blockedId));
}

/**
 * Where a new comment sits in the tree. Replies to a depth-8 parent attach
 * at depth 8 rather than erroring (the UI flattens beyond depth 3 anyway).
 */
export function deriveChildPlacement(
  parent: { id: number; rootId: number | null; depth: number } | null,
): { parentId: number | null; rootId: number | null; depth: number } {
  if (!parent) return { parentId: null, rootId: null, depth: 0 };
  return {
    parentId: parent.id,
    rootId: parent.rootId ?? parent.id,
    depth: Math.min(parent.depth + 1, MAX_DEPTH),
  };
}

export function serializeComments(
  rows: CommentRecord[],
  opts: {
    authors: Map<string, CommentAuthor>;
    blocked: Set<string>;
    viewerId: string | null;
    isStaff: boolean;
    subjectOwnerId: string;
    truncatedRoots?: Set<number>;
  },
): SerializedComment[] {
  return rows.map((row) => {
    const isMine = opts.viewerId != null && row.authorId === opts.viewerId;
    const tombstoned = row.deletedAt != null;
    const hidden = !tombstoned && row.authorId != null && opts.blocked.has(row.authorId);
    const tombstone = tombstoned
      ? row.deletedById != null && row.deletedById === row.authorId
        ? ("author" as const)
        : ("moderator" as const)
      : null;
    return {
      id: row.id,
      parentId: row.parentId,
      rootId: row.rootId,
      depth: row.depth,
      content: tombstoned || hidden ? null : row.content,
      tombstone,
      hidden,
      createdAt: row.createdAt,
      editedAt: row.editedAt,
      replyCount: row.replyCount,
      ...(opts.truncatedRoots?.has(row.id) ? { hasMoreReplies: true } : {}),
      author: row.authorId == null || hidden ? null : (opts.authors.get(row.authorId) ?? null),
      viewer: {
        isMine,
        canEdit: isMine && !tombstoned,
        canDelete: !tombstoned && (isMine || opts.isStaff || opts.viewerId === opts.subjectOwnerId),
      },
    };
  });
}

async function viewerIsStaff(viewerId: string | null): Promise<boolean> {
  if (!viewerId) return false;
  return isStaffMember(await resolveUserRoles(viewerId));
}

async function loadSubjectOrThrow(ref: SubjectRef): Promise<SubjectContext> {
  const ctx = await loadSubject(ref);
  if (!ctx?.exists) {
    throw new ORPCError("NOT_FOUND", { message: "This page can't be commented on." });
  }
  return ctx;
}

// ── Reads ────────────────────────────────────────────────────────────────────

export const listComments = os
  .use(authMiddleware)
  .input(
    z.object({
      subject: subjectRefSchema,
      cursor: z.number().int().positive().optional(),
      limit: z.number().int().min(1).max(50).default(20),
    }),
  )
  .handler(async ({ input, context }) => {
    const viewerId = context.user?.id ?? null;
    const subject = await loadSubject(input.subject);
    if (!subject?.exists) {
      throw new ORPCError("NOT_FOUND", { message: "Not found." });
    }

    // A disabled surface (a wall whose owner turned notes off) stays
    // readable to the owner only — visitors get the same shape as an
    // empty thread rather than the archive.
    if (!subject.commentingEnabled && viewerId !== subject.ownerId) {
      return {
        thread: null,
        commentCount: 0,
        commentingEnabled: false,
        viewerIsStaff: await viewerIsStaff(viewerId),
        comments: [] as SerializedComment[],
        nextCursor: null as number | null,
      };
    }

    const thread = await findThread(input.subject);
    if (!thread) {
      return {
        thread: null,
        commentCount: 0,
        commentingEnabled: subject.commentingEnabled,
        viewerIsStaff: await viewerIsStaff(viewerId),
        comments: [] as SerializedComment[],
        nextCursor: null as number | null,
      };
    }

    const topLevelWhere = [eq(comments.threadId, thread.id), isNull(comments.parentId)];
    if (input.cursor) topLevelWhere.push(lt(comments.id, input.cursor));

    const page = await db
      .select()
      .from(comments)
      .where(and(...topLevelWhere))
      .orderBy(desc(comments.id))
      .limit(input.limit + 1);

    const nextCursor = page.length > input.limit ? (page[input.limit - 1]?.id ?? null) : null;
    const topLevel = page.slice(0, input.limit);
    const rootIds = topLevel.map((c) => c.id);

    let replies: CommentRecord[] = [];
    const truncatedRoots = new Set<number>();
    if (rootIds.length > 0) {
      const [chainTotals, fetched] = await Promise.all([
        db
          .select({ rootId: comments.rootId, total: count() })
          .from(comments)
          .where(inArray(comments.rootId, rootIds))
          .groupBy(comments.rootId),
        db
          .select()
          .from(comments)
          .where(inArray(comments.rootId, rootIds))
          .orderBy(asc(comments.id))
          .limit(REPLY_PAGE_CAP),
      ]);
      replies = fetched;
      const fetchedPerRoot = new Map<number, number>();
      for (const reply of fetched) {
        if (reply.rootId == null) continue;
        fetchedPerRoot.set(reply.rootId, (fetchedPerRoot.get(reply.rootId) ?? 0) + 1);
      }
      for (const { rootId, total } of chainTotals) {
        if (rootId != null && total > (fetchedPerRoot.get(rootId) ?? 0)) {
          truncatedRoots.add(rootId);
        }
      }
    }

    const allRows = [...topLevel, ...replies];
    const [authors, blocked, isStaff, subscription] = await Promise.all([
      authorsByIds(allRows.map((r) => r.authorId).filter((id): id is string => id != null)),
      blockedByViewer(viewerId),
      viewerIsStaff(viewerId),
      viewerId
        ? db
            .select({ muted: threadSubscriptions.muted })
            .from(threadSubscriptions)
            .where(
              and(
                eq(threadSubscriptions.threadId, thread.id),
                eq(threadSubscriptions.userId, viewerId),
              ),
            )
            .limit(1)
            .then((rows) => rows[0] ?? null)
        : Promise.resolve(null),
    ]);

    return {
      thread: {
        id: thread.id,
        lockedAt: thread.lockedAt,
        subscribed: subscription != null,
        muted: subscription?.muted ?? false,
      },
      commentCount: thread.commentCount,
      commentingEnabled: subject.commentingEnabled,
      viewerIsStaff: isStaff,
      comments: serializeComments(allRows, {
        authors,
        blocked,
        viewerId,
        isStaff,
        subjectOwnerId: subject.ownerId,
        truncatedRoots,
      }),
      nextCursor,
    };
  });

export const listReplies = os
  .use(authMiddleware)
  .input(
    z.object({
      rootId: z.number().int().positive(),
      cursor: z.number().int().positive().optional(),
      limit: z.number().int().min(1).max(100).default(50),
    }),
  )
  .handler(async ({ input, context }) => {
    const viewerId = context.user?.id ?? null;
    const [root] = await db.select().from(comments).where(eq(comments.id, input.rootId)).limit(1);
    if (!root || root.parentId != null) {
      throw new ORPCError("NOT_FOUND", { message: "Comment not found." });
    }
    const [thread] = await db.select().from(threads).where(eq(threads.id, root.threadId)).limit(1);
    if (!thread) throw new ORPCError("NOT_FOUND", { message: "Thread not found." });
    const subject = await loadSubjectOrThrow(subjectRefOfThread(thread));

    const where = [eq(comments.rootId, input.rootId)];
    if (input.cursor) where.push(gt(comments.id, input.cursor));
    const page = await db
      .select()
      .from(comments)
      .where(and(...where))
      .orderBy(asc(comments.id))
      .limit(input.limit + 1);

    const nextCursor = page.length > input.limit ? (page[input.limit - 1]?.id ?? null) : null;
    const rows = page.slice(0, input.limit);
    const [authors, blocked, isStaff] = await Promise.all([
      authorsByIds(rows.map((r) => r.authorId).filter((id): id is string => id != null)),
      blockedByViewer(viewerId),
      viewerIsStaff(viewerId),
    ]);

    return {
      comments: serializeComments(rows, {
        authors,
        blocked,
        viewerId,
        isStaff,
        subjectOwnerId: subject.ownerId,
      }),
      nextCursor,
    };
  });

// ── Writes ───────────────────────────────────────────────────────────────────

export const createComment = os
  .use(requireGuildMember)
  .input(
    z.object({
      subject: subjectRefSchema,
      parentId: z.number().int().positive().optional(),
      content: z.string().trim().min(1).max(2000),
    }),
  )
  .handler(async ({ input, context }) => {
    const subject = await loadSubjectOrThrow(input.subject);
    if (!subject.commentingEnabled) {
      throw new ORPCError("FORBIDDEN", { message: "Comments are turned off here." });
    }
    if (input.content.length > subject.maxCommentLength) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Keep it under ${subject.maxCommentLength} characters.`,
      });
    }
    checkProfanity(input.content, "Comment");

    const thread = await resolveThread(input.subject, subject.ownerId);
    if (thread.lockedAt) {
      throw new ORPCError("FORBIDDEN", { message: "This thread is locked." });
    }

    let parent: CommentRecord | null = null;
    if (input.parentId) {
      const [row] = await db
        .select()
        .from(comments)
        .where(eq(comments.id, input.parentId))
        .limit(1);
      if (!row || row.threadId !== thread.id) {
        throw new ORPCError("BAD_REQUEST", { message: "That comment doesn't exist here." });
      }
      if (row.deletedAt) {
        throw new ORPCError("BAD_REQUEST", { message: "You can't reply to a removed comment." });
      }
      if (
        row.authorId &&
        row.authorId !== context.user.id &&
        (await blockPairExists(row.authorId, context.user.id))
      ) {
        throw new ORPCError("FORBIDDEN", { message: NEUTRAL_BLOCK_MESSAGE });
      }
      parent = row;
    }

    if (!(await checkRateLimit("comment", context.user.id, 20))) {
      throw new ORPCError("TOO_MANY_REQUESTS", {
        message: "You're commenting too fast — try again in a bit.",
      });
    }

    const created = await db.transaction(async (tx) => {
      const [comment] = await tx
        .insert(comments)
        .values({
          threadId: thread.id,
          ...deriveChildPlacement(parent),
          authorId: context.user.id,
          content: input.content,
        })
        .returning();
      if (!comment) throw new Error("comment insert returned no row");
      await tx
        .update(threads)
        .set({
          commentCount: sql`${threads.commentCount} + 1`,
          lastCommentAt: new Date(),
        })
        .where(eq(threads.id, thread.id));
      if (parent) {
        await tx
          .update(comments)
          .set({ replyCount: sql`${comments.replyCount} + 1` })
          .where(eq(comments.id, parent.id));
      }
      await tx
        .insert(threadSubscriptions)
        .values({ threadId: thread.id, userId: context.user.id })
        .onConflictDoNothing();
      return comment;
    });

    // Fan-out runs after the response (and never inside the transaction):
    // the caller's result needs nothing from it, and a slow or failed
    // notification pass must not delay or fail the comment itself.
    const writerId = context.user.id;
    const parentAuthorId = parent?.authorId ?? null;
    void (async () => {
      const subjectUrl = `${subject.url}#comment-${created.id}`;
      const notificationData = {
        subjectType: input.subject.type,
        subjectTitle: subject.title,
        subjectUrl,
        commentId: created.id,
        preview: input.content.slice(0, 140),
      };

      const writerBlocks = await db
        .select({ blockerId: userBlocks.blockerId, blockedId: userBlocks.blockedId })
        .from(userBlocks)
        .where(or(eq(userBlocks.blockerId, writerId), eq(userBlocks.blockedId, writerId)));
      const blockPaired = new Set(
        writerBlocks.map((b) => (b.blockerId === writerId ? b.blockedId : b.blockerId)),
      );

      const notified = new Set<string>([writerId]);
      if (parentAuthorId && parentAuthorId !== writerId && !blockPaired.has(parentAuthorId)) {
        notified.add(parentAuthorId);
        await notify({
          userId: parentAuthorId,
          type: "comment_reply",
          actorId: writerId,
          entityType: "thread",
          entityId: String(thread.id),
          dedupeWithin: { ms: 15 * 60_000 },
          data: notificationData,
        });
      }

      const subscribers = await db
        .select({ userId: threadSubscriptions.userId })
        .from(threadSubscriptions)
        .where(
          and(eq(threadSubscriptions.threadId, thread.id), eq(threadSubscriptions.muted, false)),
        );
      for (const { userId } of subscribers) {
        if (notified.has(userId) || blockPaired.has(userId)) continue;
        notified.add(userId);
        await notify({
          userId,
          type: "comment_received",
          actorId: writerId,
          entityType: "thread",
          entityId: String(thread.id),
          dedupeWithin: { ms: 15 * 60_000 },
          data: notificationData,
        });
      }
    })().catch((err: unknown) => {
      console.warn("[comments] notification fan-out failed", { commentId: created.id, err });
    });

    return { id: created.id, rootId: created.rootId, depth: created.depth };
  });

export const editComment = os
  .use(requireAuth)
  .input(
    z.object({
      commentId: z.number().int().positive(),
      content: z.string().trim().min(1).max(2000),
    }),
  )
  .handler(async ({ input, context }) => {
    const [comment] = await db
      .select()
      .from(comments)
      .where(eq(comments.id, input.commentId))
      .limit(1);
    if (!comment) throw new ORPCError("NOT_FOUND", { message: "Comment not found." });
    if (comment.authorId !== context.user.id) {
      throw new ORPCError("FORBIDDEN", { message: "You can only edit your own comments." });
    }
    if (comment.deletedAt) {
      throw new ORPCError("BAD_REQUEST", { message: "This comment was removed." });
    }
    const [thread] = await db
      .select()
      .from(threads)
      .where(eq(threads.id, comment.threadId))
      .limit(1);
    if (thread?.lockedAt) {
      throw new ORPCError("FORBIDDEN", { message: "This thread is locked." });
    }
    const subject = thread ? await loadSubject(subjectRefOfThread(thread)) : null;
    if (subject && input.content.length > subject.maxCommentLength) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Keep it under ${subject.maxCommentLength} characters.`,
      });
    }
    checkProfanity(input.content, "Comment");

    await db
      .update(comments)
      .set({ content: input.content, editedAt: new Date() })
      .where(eq(comments.id, comment.id));
    return { success: true };
  });

export const deleteComment = os
  .use(requireAuthWithPermissions)
  .input(
    z.object({
      commentId: z.number().int().positive(),
      /** Shown to the author in the removal notice. Staff/owner path only —
       * an author deleting their own comment isn't told why they did it. */
      reason: z.string().trim().max(500).optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    const [comment] = await db
      .select()
      .from(comments)
      .where(eq(comments.id, input.commentId))
      .limit(1);
    if (!comment) throw new ORPCError("NOT_FOUND", { message: "Comment not found." });
    if (comment.deletedAt) return { success: true };

    let allowed = comment.authorId === context.user.id || context.isStaff;
    if (!allowed) {
      const [thread] = await db
        .select()
        .from(threads)
        .where(eq(threads.id, comment.threadId))
        .limit(1);
      const subject = thread ? await loadSubject(subjectRefOfThread(thread)) : null;
      allowed = subject?.ownerId === context.user.id;
    }
    if (!allowed) {
      throw new ORPCError("FORBIDDEN", { message: "You can't remove this comment." });
    }

    // Tombstone, never a hard delete: chains below must survive. Counts
    // deliberately include tombstones (display-time filter if ever wanted).
    await db
      .update(comments)
      .set({ deletedAt: new Date(), deletedById: context.user.id })
      .where(eq(comments.id, comment.id));

    if (comment.authorId !== context.user.id) {
      await recordModerationAction({
        action: "comment_removed",
        actorId: context.user.id,
        targetType: "comment",
        targetId: comment.id,
        subjectUserId: comment.authorId,
        reason: input.reason,
        metadata: { threadId: comment.threadId, preview: comment.content.slice(0, 280) },
      });
    }

    await notifyCommentRemoved({
      comment,
      removedById: context.user.id,
      reason: input.reason,
    });
    return { success: true };
  });

/**
 * Tell the author their comment came down, when someone else took it down.
 * Silence here is what makes moderation feel arbitrary — the comment simply
 * isn't there next time they look, with nothing saying who or why.
 *
 * Best-effort and never awaited into the caller's failure path: a removal
 * that succeeded must not report failure because the notify leg did.
 */
async function notifyCommentRemoved(params: {
  comment: { id: number; threadId: number; authorId: string | null; content: string };
  removedById: string;
  reason?: string;
}): Promise<void> {
  const { comment, removedById, reason } = params;
  if (!comment.authorId || comment.authorId === removedById) return;

  try {
    const [thread] = await db
      .select()
      .from(threads)
      .where(eq(threads.id, comment.threadId))
      .limit(1);
    const subject = thread ? await loadSubject(subjectRefOfThread(thread)) : null;

    await notify({
      userId: comment.authorId,
      type: "comment_removed_by_staff",
      // No actorId: which moderator acted is staff's business, and naming
      // them turns a policy decision into a personal one.
      entityType: "comment",
      entityId: String(comment.id),
      data: {
        subjectTitle: subject?.title ?? "a thread",
        subjectUrl: subject?.url ?? null,
        commentId: comment.id,
        preview: comment.content.slice(0, 140),
        ...(reason ? { reason } : {}),
      },
    });
  } catch (err) {
    console.warn("[comments] removal notice failed", { commentId: comment.id, err });
  }
}

export const reportComment = os
  .use(requireAuth)
  .input(
    z.object({
      commentId: z.number().int().positive(),
      reason: z.string().trim().min(1).max(1000),
    }),
  )
  .handler(async ({ input, context }) => {
    const [comment] = await db
      .select({ id: comments.id })
      .from(comments)
      .where(eq(comments.id, input.commentId))
      .limit(1);
    if (!comment) throw new ORPCError("NOT_FOUND", { message: "Comment not found." });
    checkProfanity(input.reason, "Report reason");
    const [open] = await db
      .select({ id: commentReports.id })
      .from(commentReports)
      .where(
        and(
          eq(commentReports.commentId, input.commentId),
          eq(commentReports.reporterId, context.user.id),
          isNull(commentReports.resolvedAt),
        ),
      )
      .limit(1);
    if (open) {
      throw new ORPCError("BAD_REQUEST", { message: "You've already reported this comment." });
    }
    if (!(await checkRateLimit("report", context.user.id, 10))) {
      throw new ORPCError("TOO_MANY_REQUESTS", { message: "Too many reports — try again later." });
    }
    await db.insert(commentReports).values({
      commentId: input.commentId,
      reporterId: context.user.id,
      reason: input.reason,
    });
    return { success: true };
  });

export const setThreadSubscription = os
  .use(requireAuth)
  .input(z.object({ subject: subjectRefSchema, muted: z.boolean() }))
  .handler(async ({ input, context }) => {
    const subject = await loadSubjectOrThrow(input.subject);
    const thread = await resolveThread(input.subject, subject.ownerId);
    // Unlike auto-subscribe, this endpoint IS allowed to flip `muted`.
    await db
      .insert(threadSubscriptions)
      .values({ threadId: thread.id, userId: context.user.id, muted: input.muted })
      .onConflictDoUpdate({
        target: [threadSubscriptions.threadId, threadSubscriptions.userId],
        set: { muted: input.muted },
      });
    return { success: true };
  });

// ── Moderation ───────────────────────────────────────────────────────────────

export const lockThread = os
  .use(requireStaff)
  .input(z.object({ subject: subjectRefSchema, locked: z.boolean() }))
  .handler(async ({ input, context }) => {
    const subject = await loadSubjectOrThrow(input.subject);
    const thread = await resolveThread(input.subject, subject.ownerId);
    await db
      .update(threads)
      .set(
        input.locked
          ? { lockedAt: new Date(), lockedById: context.user.id }
          : { lockedAt: null, lockedById: null },
      )
      .where(eq(threads.id, thread.id));
    return { success: true };
  });

export const listCommentReports = os
  .use(requireStaff)
  .input(z.object({ includeResolved: z.boolean().default(false) }))
  .handler(async ({ input }) => {
    const rows = await db
      .select({
        id: commentReports.id,
        commentId: commentReports.commentId,
        reporterId: commentReports.reporterId,
        reason: commentReports.reason,
        createdAt: commentReports.createdAt,
        resolvedAt: commentReports.resolvedAt,
        resolvedById: commentReports.resolvedById,
        commentContent: comments.content,
        commentAuthorId: comments.authorId,
        commentDeletedAt: comments.deletedAt,
        threadId: comments.threadId,
        // Where the comment lives, so the queue can link to it in situ.
        subjectType: threads.subjectType,
        subjectCollabPostId: threads.collabPostId,
        subjectProfileUserId: threads.profileUserId,
      })
      .from(commentReports)
      .innerJoin(comments, eq(commentReports.commentId, comments.id))
      .innerJoin(threads, eq(comments.threadId, threads.id))
      .where(input.includeResolved ? undefined : isNull(commentReports.resolvedAt))
      .orderBy(sql`${commentReports.resolvedAt} ASC NULLS FIRST`, desc(commentReports.createdAt));
    const authors = await authorsByIds(
      rows
        .flatMap((r) => [r.reporterId, r.commentAuthorId])
        .filter((id): id is string => id != null),
    );
    return rows.map((r) => ({
      ...r,
      reporter: authors.get(r.reporterId) ?? null,
      commentAuthor: r.commentAuthorId ? (authors.get(r.commentAuthorId) ?? null) : null,
    }));
  });

/**
 * Everything said site-wide, newest first. The report queue is reactive —
 * this is the pass staff make when nobody has reported anything yet.
 */
export const listRecentComments = os
  .use(requireStaff)
  .input(
    z.object({
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(50).default(15),
      includeRemoved: z.boolean().default(false),
    }),
  )
  .handler(async ({ input }) => {
    const where = input.includeRemoved ? undefined : isNull(comments.deletedAt);

    const [[totals], rows] = await Promise.all([
      db.select({ total: count() }).from(comments).where(where),
      db
        .select({
          id: comments.id,
          content: comments.content,
          authorId: comments.authorId,
          depth: comments.depth,
          createdAt: comments.createdAt,
          editedAt: comments.editedAt,
          deletedAt: comments.deletedAt,
          subjectType: threads.subjectType,
          subjectCollabPostId: threads.collabPostId,
          subjectProfileUserId: threads.profileUserId,
          postTitle: collabPosts.title,
        })
        .from(comments)
        .innerJoin(threads, eq(comments.threadId, threads.id))
        .leftJoin(collabPosts, eq(threads.collabPostId, collabPosts.id))
        .where(where)
        .orderBy(desc(comments.id))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize),
    ]);

    const people = await authorsByIds(
      rows
        .flatMap((r) => [r.authorId, r.subjectProfileUserId])
        .filter((id): id is string => id != null),
    );

    const total = totals?.total ?? 0;
    return {
      items: rows.map((r) => ({
        ...r,
        author: r.authorId ? (people.get(r.authorId) ?? null) : null,
        subjectOwner: r.subjectProfileUserId ? (people.get(r.subjectProfileUserId) ?? null) : null,
      })),
      total,
      page: input.page,
      pageSize: input.pageSize,
      pageCount: Math.max(1, Math.ceil(total / input.pageSize)),
    };
  });

export const resolveCommentReport = os
  .use(requireStaff)
  .input(
    z.object({
      reportId: z.number().int().positive(),
      action: z.enum(["dismiss", "remove_comment"]),
      /** Shown to the comment's author when the action is a removal. */
      reason: z.string().trim().max(500).optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    const [report] = await db
      .select()
      .from(commentReports)
      .where(eq(commentReports.id, input.reportId))
      .limit(1);
    if (!report) throw new ORPCError("NOT_FOUND", { message: "Report not found." });
    if (report.resolvedAt) return { success: true };

    if (input.action === "remove_comment") {
      const [removed] = await db
        .update(comments)
        .set({
          deletedAt: sql`COALESCE(${comments.deletedAt}, now())`,
          deletedById: context.user.id,
        })
        .where(and(eq(comments.id, report.commentId), isNull(comments.deletedAt)))
        .returning();
      // Only on a real transition — a comment already tombstoned by an
      // earlier report shouldn't notify its author a second time.
      if (removed) {
        await recordModerationAction({
          action: "comment_removed",
          actorId: context.user.id,
          targetType: "comment",
          targetId: removed.id,
          subjectUserId: removed.authorId,
          reason: input.reason,
          metadata: {
            reportId: report.id,
            reportReason: report.reason,
            preview: removed.content.slice(0, 280),
          },
        });
        await notifyCommentRemoved({
          comment: removed,
          removedById: context.user.id,
          reason: input.reason,
        });
      }
    }
    await db
      .update(commentReports)
      .set({ resolvedAt: new Date(), resolvedById: context.user.id })
      .where(eq(commentReports.id, report.id));

    if (input.action === "dismiss") {
      // Dismissals matter most of all: "nothing happened" is the decision
      // hardest to reconstruct later, and the one people query when they
      // ask whether a pattern was ever looked at.
      await recordModerationAction({
        action: "comment_report_dismissed",
        actorId: context.user.id,
        targetType: "comment_report",
        targetId: report.id,
        reason: input.reason,
        metadata: { commentId: report.commentId, reportReason: report.reason },
      });
    }
    return { success: true };
  });

// ── Blocks ───────────────────────────────────────────────────────────────────

export const blockUser = os
  .use(requireAuth)
  .input(z.object({ userId: z.string().min(1) }))
  .handler(async ({ input, context }) => {
    if (input.userId === context.user.id) {
      throw new ORPCError("BAD_REQUEST", { message: "You can't block yourself." });
    }
    const [target] = await db
      .select({ id: developerProfiles.id })
      .from(developerProfiles)
      .where(eq(developerProfiles.id, input.userId))
      .limit(1);
    if (!target) throw new ORPCError("NOT_FOUND", { message: "User not found." });
    await db
      .insert(userBlocks)
      .values({ blockerId: context.user.id, blockedId: input.userId })
      .onConflictDoNothing();
    return { success: true };
  });

export const unblockUser = os
  .use(requireAuth)
  .input(z.object({ userId: z.string().min(1) }))
  .handler(async ({ input, context }) => {
    await db
      .delete(userBlocks)
      .where(
        and(eq(userBlocks.blockerId, context.user.id), eq(userBlocks.blockedId, input.userId)),
      );
    return { success: true };
  });

export const listBlockedUsers = os
  .use(requireAuth)
  .input(z.object({}))
  .handler(async ({ context }) => {
    const rows = await db
      .select({ blockedId: userBlocks.blockedId, createdAt: userBlocks.createdAt })
      .from(userBlocks)
      .where(eq(userBlocks.blockerId, context.user.id))
      .orderBy(desc(userBlocks.createdAt));
    const authors = await authorsByIds(rows.map((r) => r.blockedId));
    return rows.map((r) => ({
      userId: r.blockedId,
      blockedAt: r.createdAt,
      user: authors.get(r.blockedId) ?? null,
    }));
  });
