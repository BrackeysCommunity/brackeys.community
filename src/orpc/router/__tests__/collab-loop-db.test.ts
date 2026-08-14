import { call } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  collabPosts,
  collabResponses,
  developerProfiles,
  notifications,
  teamMembers,
  teams,
  threads,
  threadSubscriptions,
  user,
} from "@/db/schema";
import { respondToPost, updateResponseStatus } from "@/orpc/router/collab";
import {
  createComment,
  listCommentReports,
  listComments,
  listReplies,
  reportComment,
} from "@/orpc/router/comments";
import { getProfile } from "@/orpc/router/profile";
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
 * Plan 03's two single-session-invisible checks, against real SQL:
 *
 * - A third account (and anonymous, and non-participant staff on writes)
 *   gets a thread that reads as absent on a private `collab_response`
 *   subject — the visibility rules as queries, not predicates.
 * - COLLABS counts the collaboration edge on *both* profiles once a roster
 *   seat carries response provenance.
 */

let db: TestDb;

beforeEach(async () => {
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
  await db.delete(notifications);
  await db.delete(threadSubscriptions);
  await db.delete(threads);
  await db.delete(teams);
  await db.delete(collabPosts);
  await db.delete(developerProfiles);
  await db.delete(user);

  await seedUser(db, "author");
  await seedUser(db, "responder");
  await seedUser(db, "outsider");
  await seedUser(db, "staff", { guildRoles: ["Staff"] });
});

async function seedResponseThread() {
  // Solo post: accepting must not demand a linked team page.
  const postId = await seedCollabPost(db, "author", { isIndividual: true });
  const response = await call(
    respondToPost,
    { postId, message: "I'd love to help." },
    asUser("responder"),
  );
  return { postId, subject: { type: "collab_response", id: response.id } as const };
}

describe("private response threads", () => {
  it("lets both parties read and write; both are subscribed from creation", async () => {
    const { subject } = await seedResponseThread();

    const empty = await call(listComments, { subject }, asUser("author"));
    expect(empty.thread).toBeNull();

    await call(createComment, { subject, content: "quick question" }, asUser("author"));
    await call(createComment, { subject, content: "an answer" }, asUser("responder"));

    const asAuthor = await call(listComments, { subject }, asUser("author"));
    expect(asAuthor.comments.map((c) => c.content)).toEqual(["an answer", "quick question"]);

    const subs = await db
      .select({ userId: threadSubscriptions.userId })
      .from(threadSubscriptions)
      .where(eq(threadSubscriptions.threadId, asAuthor.thread!.id));
    expect(subs.map((s) => s.userId).sort()).toEqual(["author", "responder"]);
  });

  it("reads as absent to a third account, anonymous included", async () => {
    const { subject } = await seedResponseThread();
    await call(createComment, { subject, content: "private q" }, asUser("author"));

    // The neutral message is part of the contract: "you can't see this"
    // would confirm that a named person applied to a named post.
    await expect(call(listComments, { subject }, asUser("outsider"))).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Not found.",
    });
    await expect(call(listComments, { subject }, asUser(null))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      call(createComment, { subject, content: "let me in" }, asUser("outsider")),
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: "Not found." });
  });

  it("denies a leaked root id through listReplies too", async () => {
    const { subject } = await seedResponseThread();
    const root = await call(createComment, { subject, content: "private q" }, asUser("author"));
    await call(
      createComment,
      { subject, parentId: root.id, content: "private a" },
      asUser("responder"),
    );

    await expect(call(listReplies, { rootId: root.id }, asUser("outsider"))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    const forResponder = await call(listReplies, { rootId: root.id }, asUser("responder"));
    expect(forResponder.comments.map((c) => c.content)).toEqual(["private a"]);
  });

  it("routes a reported private comment into the staff queue", async () => {
    const { subject } = await seedResponseThread();
    const root = await call(createComment, { subject, content: "over the line" }, asUser("author"));

    await call(
      reportComment,
      { commentId: root.id, reason: "unprofessional" },
      asUser("responder"),
    );

    // This is what buys `canViewSubject`'s staff exception: the queue links
    // staff into a thread neither of them is a participant of.
    const queue = await call(listCommentReports, { includeResolved: false }, asUser("staff"));
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      commentId: root.id,
      reporterId: "responder",
      commentContent: "over the line",
      subjectType: "collab_response",
    });
  });

  it("staff read the thread but cannot join the two-person conversation", async () => {
    const { subject } = await seedResponseThread();
    await call(createComment, { subject, content: "private q" }, asUser("author"));

    const asStaff = await call(listComments, { subject }, asUser("staff"));
    expect(asStaff.viewerIsStaff).toBe(true);
    expect(asStaff.comments).toHaveLength(1);

    await expect(
      call(createComment, { subject, content: "moderating in" }, asUser("staff")),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("the accept loop and COLLABS credits", () => {
  it("accepting notifies the responder and freezes the decision on the row", async () => {
    const { subject } = await seedResponseThread();

    await call(
      updateResponseStatus,
      { responseId: subject.id, status: "accepted" },
      asUser("author"),
    );

    const [row] = await db.select().from(collabResponses).where(eq(collabResponses.id, subject.id));
    expect(row!.status).toBe("accepted");

    const accepted = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, "responder"),
          eq(notifications.type, "collab_response_accepted"),
        ),
      );
    expect(accepted).toHaveLength(1);
  });

  it("counts the collaboration on both profiles — and only edges with provenance", async () => {
    const { subject } = await seedResponseThread();
    await call(
      updateResponseStatus,
      { responseId: subject.id, status: "accepted" },
      asUser("author"),
    );

    // The accept → invite → roster handoff, landed: the responder's seat
    // carries the response id, the author's and a bystander's do not.
    const [team] = await db
      .insert(teams)
      .values({ slug: "night-crew", name: "Night Crew", createdBy: "author" })
      .returning({ id: teams.id });
    await db.insert(teamMembers).values([
      { teamId: team!.id, userId: "author", role: "owner" },
      { teamId: team!.id, userId: "responder", sourceResponseId: subject.id },
      { teamId: team!.id, userId: "outsider" },
    ]);

    const [author, responder, outsider] = await Promise.all([
      call(getProfile, { userId: "author" }, asUser(null)),
      call(getProfile, { userId: "responder" }, asUser(null)),
      call(getProfile, { userId: "outsider" }, asUser(null)),
    ]);

    // Symmetric on the edge: the author who never left their own team still
    // gets the introduction credited (this is what the plan's "both
    // profiles" check pins down), and the responder's provenance seat
    // credits their edge to everyone on the roster.
    expect(author!.collabsCount).toBe(1);
    expect(responder!.collabsCount).toBe(2);
    expect(outsider!.collabsCount).toBe(1);
  });

  it("counts nothing on a roster with no collab provenance anywhere", async () => {
    const [team] = await db
      .insert(teams)
      .values({ slug: "old-friends", name: "Old Friends", createdBy: "author" })
      .returning({ id: teams.id });
    await db.insert(teamMembers).values([
      { teamId: team!.id, userId: "author", role: "owner" },
      { teamId: team!.id, userId: "outsider" },
    ]);

    const profile = await call(getProfile, { userId: "author" }, asUser(null));
    expect(profile!.collabsCount).toBe(0);
  });
});
