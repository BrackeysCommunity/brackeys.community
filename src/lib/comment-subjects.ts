import { eq } from "drizzle-orm";

import { db } from "@/db";
import {
  collabPosts,
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

export type SubjectRef = { type: "collab_post"; id: number } | { type: "profile"; id: string };

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
};

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
      };
    },
    threadInsert(id) {
      return { subjectType: "collab_post", collabPostId: id as number };
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
      : eq(threads.profileUserId, insert.profileUserId!);
  const [row] = await db.select().from(threads).where(condition).limit(1);
  return row ?? null;
}

/**
 * Get-or-create, race-safe via the partial unique indexes on `threads`:
 * `INSERT … ON CONFLICT DO NOTHING`, then select. On first creation the
 * subject owner's subscription row is written in the same transaction.
 */
export async function resolveThread(ref: SubjectRef, ownerId: string): Promise<ThreadRow> {
  const existing = await findThread(ref);
  if (existing) return existing;

  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(threads)
      .values(handlers[ref.type].threadInsert(ref.id))
      .onConflictDoNothing()
      .returning();
    if (row) {
      await tx
        .insert(threadSubscriptions)
        .values({ threadId: row.id, userId: ownerId })
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
  return { type: "profile", id: thread.profileUserId! };
}
