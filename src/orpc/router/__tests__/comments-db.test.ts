import { call } from "@orpc/server";
import { and, count, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { comments, notifications, threads, threadSubscriptions, userBlocks } from "@/db/schema";
import { loadSubject, resolveThread } from "@/lib/comment-subjects";
import { createComment, listComments } from "@/orpc/router/comments";
import { seedCollabPost, seedUser, type TestDb } from "@/test/db";
import { asUser } from "@/test/orpc";

vi.mock("@/db", async () => {
  const { createTestDb } = await import("@/test/db");
  return { db: await createTestDb() } as unknown as typeof import("@/db");
});
vi.mock("@/lib/auth", async () => {
  const { fakeAuthModule } = await import("@/test/orpc");
  return fakeAuthModule();
});
vi.mock("@/lib/discord", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/discord")>()),
  isGuildMember: async () => true,
}));
vi.mock("@/lib/guild-sync", () => ({
  refreshGuildRolesThrottled: async () => {},
}));
vi.mock("@/lib/queue", () => ({
  getNotificationsQueue: async () => ({ add: async () => ({}) }),
}));

/**
 * The plan-11 acceptance items that only real SQL can exercise: the
 * thread-creation race, the two-query list assembly, and the notification
 * fan-out. Everything runs against a migrated pglite database — `@/db` is
 * swapped for it above, so the router, the subject registry and the notify
 * write path all hit the same DDL production runs.
 */

let db: TestDb;

async function fanOutSettled(expected: number) {
  // createComment's fan-out is deliberately fire-and-forget; poll the table
  // rather than racing it.
  await expect
    .poll(async () => (await db.select({ value: count() }).from(notifications))[0]!.value, {
      timeout: 2000,
    })
    .toBe(expected);
}

beforeEach(async () => {
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
  // One database per file, fresh rows per test. Deleting identities
  // cascades through posts, threads, comments and subscriptions.
  const { collabPosts, developerProfiles, user } = await import("@/db/schema");
  await db.delete(notifications);
  await db.delete(userBlocks);
  await db.delete(collabPosts);
  await db.delete(threads);
  await db.delete(developerProfiles);
  await db.delete(user);
});

describe("thread creation race", () => {
  it("resolves concurrent first comments to a single thread with one subscriber set", async () => {
    await seedUser(db, "owner");
    const postId = await seedCollabPost(db, "owner");
    const ref = { type: "collab_post", id: postId } as const;
    const subject = (await loadSubject(ref))!;

    const [a, b] = await Promise.all([resolveThread(ref, subject), resolveThread(ref, subject)]);
    expect(a.id).toBe(b.id);

    const threadRows = await db.select().from(threads).where(eq(threads.collabPostId, postId));
    expect(threadRows).toHaveLength(1);

    const subs = await db
      .select()
      .from(threadSubscriptions)
      .where(eq(threadSubscriptions.threadId, a.id));
    expect(subs.map((s) => s.userId)).toEqual(["owner"]);
  });

  it("returns the winner's row when the insert loses to a committed thread", async () => {
    await seedUser(db, "owner");
    const postId = await seedCollabPost(db, "owner");
    const ref = { type: "collab_post", id: postId } as const;
    const subject = (await loadSubject(ref))!;

    const [existing] = await db
      .insert(threads)
      .values({ subjectType: "collab_post", collabPostId: postId })
      .returning();
    const resolved = await resolveThread(ref, subject);
    expect(resolved.id).toBe(existing!.id);
  });
});

describe("two-query list assembly", () => {
  it("pages top-level comments by cursor and carries each page's replies with it", async () => {
    await seedUser(db, "owner");
    await seedUser(db, "writer");
    const postId = await seedCollabPost(db, "owner");
    const subject = { type: "collab_post", id: postId } as const;

    // 25 roots straight into the table (volume), replies on the newest two.
    const [thread] = await db
      .insert(threads)
      .values({ subjectType: "collab_post", collabPostId: postId, commentCount: 29 })
      .returning();
    const roots = await db
      .insert(comments)
      .values(
        Array.from({ length: 25 }, (_, i) => ({
          threadId: thread!.id,
          authorId: "writer",
          content: `root ${i}`,
          depth: 0,
        })),
      )
      .returning();
    const newest = roots.at(-1)!;
    const secondNewest = roots.at(-2)!;
    await db.insert(comments).values([
      ...Array.from({ length: 3 }, (_, i) => ({
        threadId: thread!.id,
        authorId: "owner",
        content: `reply ${i}`,
        parentId: newest.id,
        rootId: newest.id,
        depth: 1,
      })),
      {
        threadId: thread!.id,
        authorId: "owner",
        content: "lone reply",
        parentId: secondNewest.id,
        rootId: secondNewest.id,
        depth: 1,
      },
    ]);

    const page1 = await call(listComments, { subject }, asUser(null));
    const page1Roots = page1.comments.filter((c) => c.parentId == null);
    const page1Replies = page1.comments.filter((c) => c.parentId != null);
    expect(page1Roots).toHaveLength(20);
    expect(page1Replies).toHaveLength(4);
    expect(page1.nextCursor).not.toBeNull();
    expect(page1.commentCount).toBe(29);
    // Newest-first: the first root is the one carrying the 3-reply chain.
    expect(page1Roots[0]!.id).toBe(newest.id);
    expect(page1Replies.filter((r) => r.rootId === newest.id)).toHaveLength(3);

    const page2 = await call(listComments, { subject, cursor: page1.nextCursor! }, asUser(null));
    expect(page2.comments.filter((c) => c.parentId == null)).toHaveLength(5);
    // Page 2's roots have no replies, so none ride along.
    expect(page2.comments.filter((c) => c.parentId != null)).toHaveLength(0);
    expect(page2.nextCursor).toBeNull();
  });
});

describe("notification fan-out", () => {
  it("notifies subscribers but never the writer, and dedupes within the window", async () => {
    await seedUser(db, "owner");
    await seedUser(db, "writer");
    const postId = await seedCollabPost(db, "owner");
    const subject = { type: "collab_post", id: postId } as const;

    // First comment creates the thread, auto-subscribing the owner; the
    // writer subscribes themself in the same transaction.
    await call(createComment, { subject, content: "first" }, asUser("writer"));
    await fanOutSettled(1);

    const [row] = await db.select().from(notifications);
    expect(row).toMatchObject({ userId: "owner", type: "comment_received", actorId: "writer" });

    // A second comment inside the dedupe window bumps the row, not the count.
    await call(createComment, { subject, content: "second" }, asUser("writer"));
    await new Promise((r) => setTimeout(r, 50));
    const [total] = await db.select({ value: count() }).from(notifications);
    expect(total!.value).toBe(1);
  });

  it("notifies a reply's parent author as a reply, not a subscription event", async () => {
    await seedUser(db, "owner");
    await seedUser(db, "writer");
    const postId = await seedCollabPost(db, "owner");
    const subject = { type: "collab_post", id: postId } as const;

    const first = await call(createComment, { subject, content: "root" }, asUser("writer"));
    await fanOutSettled(1);

    await call(
      createComment,
      { subject, parentId: first.id, content: "welcome aboard" },
      asUser("owner"),
    );
    await fanOutSettled(2);

    const replyRows = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, "writer"), eq(notifications.type, "comment_reply")));
    expect(replyRows).toHaveLength(1);
    expect(replyRows[0]!.actorId).toBe("owner");
  });

  it("skips muted subscribers and block pairs", async () => {
    await seedUser(db, "owner");
    await seedUser(db, "muted-sub");
    await seedUser(db, "blocker-sub");
    await seedUser(db, "writer");
    const postId = await seedCollabPost(db, "owner");
    const subject = { type: "collab_post", id: postId } as const;

    const first = await call(createComment, { subject, content: "root" }, asUser("owner"));
    void first;
    await fanOutSettled(0); // owner wrote it; owner is the only subscriber

    const [thread] = await db.select().from(threads).where(eq(threads.collabPostId, postId));
    await db.insert(threadSubscriptions).values([
      { threadId: thread!.id, userId: "muted-sub", muted: true },
      { threadId: thread!.id, userId: "blocker-sub" },
    ]);
    await db.insert(userBlocks).values({ blockerId: "blocker-sub", blockedId: "writer" });

    await call(createComment, { subject, content: "hello" }, asUser("writer"));
    // Only the owner qualifies: muted-sub is muted, blocker-sub blocks the writer.
    await fanOutSettled(1);
    const [row] = await db.select().from(notifications);
    expect(row).toMatchObject({ userId: "owner", type: "comment_received" });
  });
});
