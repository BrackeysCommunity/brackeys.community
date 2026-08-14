import { eq } from "drizzle-orm";

import { db } from "@/db";
import {
  collabPosts,
  collabResponses,
  developerProfiles,
  profileUrlStubs,
  threads,
  threadSubscriptions,
} from "@/db/schema";

/**
 * The subject registry: every subject-specific behavior of the comment
 * system lives here. The comments router dispatches through this file and
 * shares everything else, so a new commentable paradigm touches only the
 * `threads` table (one FK column) and this registry.
 */

export type SubjectRef =
  | { type: "collab_post"; id: number }
  | { type: "profile"; id: string }
  | { type: "collab_response"; id: number };

export type SubjectContext = {
  exists: boolean;
  /** Auto-subscribed at thread creation; may moderate the thread. */
  ownerId: string;
  commentingEnabled: boolean;
  /** Notification copy: "commented on <title>". */
  title: string;
  /** Deep-link base; the router appends `#comment-<id>`. */
  url: string;
  maxCommentLength: number;
  /**
   * Who may read and write this thread, or `null` for a public subject.
   * When set, everyone else is refused a thread that reads as absent
   * (staff excepted on reads — see `canViewSubject`). Deriving it here
   * rather than storing a flag on `threads` means a subject can never be
   * public in the table and private in the handler.
   */
  participantIds: string[] | null;
};

/** Read access. Staff see private threads; the report queue is useless
 *  otherwise, and moderation is the trade that bought this feature. */
export function canViewSubject(
  subject: SubjectContext,
  viewerId: string | null,
  viewerIsStaff: boolean,
): boolean {
  if (!subject.participantIds) return true;
  if (viewerIsStaff) return true;
  return viewerId != null && subject.participantIds.includes(viewerId);
}

/** Write access — strictly the named parties. Staff read private threads
 *  and remove from them; they do not join a two-person conversation. */
export function canWriteSubject(subject: SubjectContext, viewerId: string): boolean {
  if (!subject.participantIds) return true;
  return subject.participantIds.includes(viewerId);
}

type ThreadInsert = typeof threads.$inferInsert;
export type ThreadRow = typeof threads.$inferSelect;

type SubjectHandler = {
  load(id: SubjectRef["id"]): Promise<SubjectContext | null>;
  /** Values for the threads insert; used by resolveThread's upsert. */
  threadInsert(id: SubjectRef["id"]): ThreadInsert;
};

const handlers: Record<SubjectRef["type"], SubjectHandler> = {
  collab_post: {
    async load(id) {
      const [post] = await db
        .select({ id: collabPosts.id, authorId: collabPosts.authorId, title: collabPosts.title })
        .from(collabPosts)
        .where(eq(collabPosts.id, id as number))
        .limit(1);
      if (!post) return null;
      return {
        exists: true,
        ownerId: post.authorId,
        // A closed post's comments stay open — people discuss finished
        // recruitment. Only `threads.lockedAt` locks.
        commentingEnabled: true,
        title: post.title,
        url: `/collab/${post.id}`,
        maxCommentLength: 2000,
        participantIds: null,
      };
    },
    threadInsert(id) {
      return { subjectType: "collab_post", collabPostId: id as number };
    },
  },
  collab_response: {
    async load(id) {
      const [row] = await db
        .select({
          responseId: collabResponses.id,
          responderId: collabResponses.responderId,
          postId: collabPosts.id,
          postTitle: collabPosts.title,
          authorId: collabPosts.authorId,
        })
        .from(collabResponses)
        .innerJoin(collabPosts, eq(collabResponses.postId, collabPosts.id))
        .where(eq(collabResponses.id, id as number))
        .limit(1);
      if (!row) return null;
      return {
        exists: true,
        // The post author owns the thread the way they own the post: they
        // get the OP marker and the moderation affordances. It does not
        // widen who can read — `participantIds` is the only gate.
        ownerId: row.authorId,
        commentingEnabled: true,
        title: `your application to "${row.postTitle}"`,
        // Both parties' entry points live on the post page — the author's
        // response list and the responder's own status card — so one URL
        // lands each of them somewhere the thread is reachable.
        url: `/collab/${row.postId}`,
        // Capped like profile notes: this is scoped Q&A before a decision,
        // not a second place to write the application.
        maxCommentLength: 500,
        participantIds: [row.authorId, row.responderId],
      };
    },
    threadInsert(id) {
      return { subjectType: "collab_response", collabResponseId: id as number };
    },
  },
  profile: {
    async load(id) {
      const [profile] = await db
        .select({
          id: developerProfiles.id,
          discordUsername: developerProfiles.discordUsername,
          guildNickname: developerProfiles.guildNickname,
          profileNotesEnabled: developerProfiles.profileNotesEnabled,
        })
        .from(developerProfiles)
        .where(eq(developerProfiles.id, id as string))
        .limit(1);
      // Anonymized skeletons (moderation-pinned deletions) are not
      // commentable subjects.
      if (!profile || profile.discordUsername === "[deleted]") return null;
      const [stub] = await db
        .select({ stub: profileUrlStubs.stub })
        .from(profileUrlStubs)
        .where(eq(profileUrlStubs.profileId, profile.id))
        .limit(1);
      const name = profile.guildNickname ?? profile.discordUsername ?? "a member";
      return {
        exists: true,
        ownerId: profile.id,
        commentingEnabled: profile.profileNotesEnabled,
        title: `${name}'s wall`,
        url: `/profile/${stub?.stub ?? profile.id}`,
        maxCommentLength: 500,
        participantIds: null,
      };
    },
    threadInsert(id) {
      return { subjectType: "profile", profileUserId: id as string };
    },
  },
};

export function loadSubject(ref: SubjectRef): Promise<SubjectContext | null> {
  return handlers[ref.type].load(ref.id);
}

/** Read-only lookup — never creates. Null when nobody has commented yet. */
export async function findThread(ref: SubjectRef): Promise<ThreadRow | null> {
  const insert = handlers[ref.type].threadInsert(ref.id);
  const condition =
    insert.subjectType === "collab_post"
      ? eq(threads.collabPostId, insert.collabPostId!)
      : insert.subjectType === "profile"
        ? eq(threads.profileUserId, insert.profileUserId!)
        : eq(threads.collabResponseId, insert.collabResponseId!);
  const [row] = await db.select().from(threads).where(condition).limit(1);
  return row ?? null;
}

/**
 * Get-or-create, race-safe via the partial unique indexes on `threads`:
 * `INSERT … ON CONFLICT DO NOTHING`, then select. On first creation the
 * subject's subscribers are written in the same transaction.
 *
 * Takes the whole context rather than an owner id so a private subject
 * auto-subscribes *both* parties: the comment fan-out reaches subscribers
 * only, so a response thread that subscribed the author alone would leave
 * the applicant's replies silently unannounced to the person waiting on them.
 */
export async function resolveThread(ref: SubjectRef, subject: SubjectContext): Promise<ThreadRow> {
  const existing = await findThread(ref);
  if (existing) return existing;

  const subscriberIds = subject.participantIds ?? [subject.ownerId];

  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(threads)
      .values(handlers[ref.type].threadInsert(ref.id))
      .onConflictDoNothing()
      .returning();
    if (row) {
      await tx
        .insert(threadSubscriptions)
        .values(subscriberIds.map((userId) => ({ threadId: row.id, userId })))
        .onConflictDoNothing();
    }
    return row ?? null;
  });
  if (created) return created;

  // Lost the race — the conflicting insert committed the row.
  const won = await findThread(ref);
  if (!won) throw new Error("thread resolution failed after conflict");
  return won;
}

/** Reverse dispatch: which subject a bare thread row belongs to. */
export function subjectRefOfThread(thread: ThreadRow): SubjectRef {
  if (thread.subjectType === "collab_post") {
    return { type: "collab_post", id: thread.collabPostId! };
  }
  if (thread.subjectType === "collab_response") {
    return { type: "collab_response", id: thread.collabResponseId! };
  }
  return { type: "profile", id: thread.profileUserId! };
}
