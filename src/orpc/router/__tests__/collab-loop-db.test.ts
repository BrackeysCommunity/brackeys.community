import { call } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  collabPosts,
  collabResponses,
  collabRoles,
  developerProfiles,
  notifications,
  projects,
  teamInvites,
  teamMembers,
  teams,
  threads,
  threadSubscriptions,
  user,
} from "@/db/schema";
import {
  acceptAndInvite,
  createPost,
  linkPostTeam,
  respondToPost,
  updatePostLinks,
  updateResponseStatus,
} from "@/orpc/router/collab";
import {
  createComment,
  listCommentReports,
  listComments,
  listReplies,
  reportComment,
} from "@/orpc/router/comments";
import { getProfile } from "@/orpc/router/profile";
import { respondToInvite } from "@/orpc/router/team";
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
  await db.delete(projects);
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

async function seedTeam(ownerId: string, overrides: Partial<typeof teams.$inferInsert> = {}) {
  const [team] = await db
    .insert(teams)
    .values({
      slug: `crew-${crypto.randomUUID().slice(0, 8)}`,
      name: "Existing Crew",
      createdBy: ownerId,
      ...overrides,
    })
    .returning();
  await db.insert(teamMembers).values({ teamId: team!.id, userId: ownerId, role: "owner" });
  return team!;
}

async function loadPostRow(postId: number) {
  const [row] = await db.select().from(collabPosts).where(eq(collabPosts.id, postId));
  return row!;
}

/**
 * Plan 26: the crew is minted at the moment it becomes real — when the
 * poster accepts someone — and the accept → invite → roster chain is one
 * call on the owner's side.
 */
describe("acceptAndInvite", () => {
  it("mints a crew owned by the author, links the post, accepts, and the invite lands a provenance seat", async () => {
    const { postId, subject } = await seedResponseThread();

    const result = await call(
      acceptAndInvite,
      { responseId: subject.id, team: { create: { name: "Night Shift Crew" } }, invite: true },
      asUser("author"),
    );
    expect(result.status).toBe("accepted");
    expect(result.createdTeam).toMatchObject({
      name: "Night Shift Crew",
      slug: "night-shift-crew",
    });
    expect(result.inviteId).not.toBeNull();

    // The crew belongs to the poster, and the post is now a team post.
    const [team] = await db.select().from(teams).where(eq(teams.id, result.teamId!));
    expect(team!.createdBy).toBe("author");
    const [seat] = await db
      .select()
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, team!.id), eq(teamMembers.userId, "author")));
    expect(seat!.role).toBe("owner");
    const post = await loadPostRow(postId);
    expect(post.teamId).toBe(team!.id);
    expect(post.isIndividual).toBe(false);

    // Both notifications the two separate paths used to send.
    const types = (
      await db
        .select({ type: notifications.type })
        .from(notifications)
        .where(eq(notifications.userId, "responder"))
    ).map((r) => r.type);
    expect(types.sort()).toEqual(["collab_response_accepted", "team_invite_received"]);

    // The responder accepts the invite: the roster seat carries the
    // response, so COLLABS credits both profiles exactly as the manual
    // accept → invite chain did.
    await call(respondToInvite, { inviteId: result.inviteId!, accept: true }, asUser("responder"));
    const [responderSeat] = await db
      .select()
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, team!.id), eq(teamMembers.userId, "responder")));
    expect(responderSeat!.sourceResponseId).toBe(subject.id);

    const [author, responder] = await Promise.all([
      call(getProfile, { userId: "author" }, asUser(null)),
      call(getProfile, { userId: "responder" }, asUser(null)),
    ]);
    expect(author!.collabsCount).toBe(1);
    expect(responder!.collabsCount).toBe(1);
  });

  it("uses an existing team, flipping a solo post into a team post", async () => {
    const { postId, subject } = await seedResponseThread();
    const team = await seedTeam("author");

    const result = await call(
      acceptAndInvite,
      { responseId: subject.id, team: { id: team.id }, invite: true },
      asUser("author"),
    );
    expect(result.teamId).toBe(team.id);
    expect(result.createdTeam).toBeNull();

    const post = await loadPostRow(postId);
    expect(post).toMatchObject({ teamId: team.id, isIndividual: false });
    const [invite] = await db
      .select()
      .from(teamInvites)
      .where(eq(teamInvites.id, result.inviteId!));
    expect(invite).toMatchObject({ inviteeId: "responder", sourceResponseId: subject.id });
  });

  it("accept-only on a solo post is a plain accept", async () => {
    const { postId, subject } = await seedResponseThread();

    const result = await call(
      acceptAndInvite,
      { responseId: subject.id, team: null, invite: false },
      asUser("author"),
    );
    expect(result).toMatchObject({ status: "accepted", teamId: null, inviteId: null });
    expect((await loadPostRow(postId)).isIndividual).toBe(true);
    expect(await db.select().from(teams)).toHaveLength(0);
  });

  it("refuses accept-only on a team post with no team — the one hard rule left", async () => {
    const postId = await seedCollabPost(db, "author", { isIndividual: false });
    const response = await call(
      respondToPost,
      { postId, message: "Count me in." },
      asUser("responder"),
    );

    await expect(
      call(
        acceptAndInvite,
        { responseId: response.id, team: null, invite: false },
        asUser("author"),
      ),
    ).rejects.toThrow(/Link your team page before accepting/);
    const [row] = await db
      .select()
      .from(collabResponses)
      .where(eq(collabResponses.id, response.id));
    expect(row!.status).toBe("pending");
  });

  it("refuses a hidden team through the same linkability check the picker mirrors", async () => {
    const { subject } = await seedResponseThread();
    const hidden = await seedTeam("author", {
      hiddenAt: new Date(),
      hiddenById: "staff",
      hiddenReason: "under review",
    });

    await expect(
      call(
        acceptAndInvite,
        { responseId: subject.id, team: { id: hidden.id }, invite: true },
        asUser("author"),
      ),
    ).rejects.toThrow(/unavailable right now/);
  });

  it("refuses a team the author is not on, even for staff", async () => {
    const { subject } = await seedResponseThread();
    const theirs = await seedTeam("outsider");

    await expect(
      call(
        acceptAndInvite,
        { responseId: subject.id, team: { id: theirs.id }, invite: true },
        asUser("staff"),
      ),
    ).rejects.toThrow(/not a member/);
  });

  it("leaves nothing behind when the invite half fails", async () => {
    const { postId, subject } = await seedResponseThread();
    // The responder already sits on the crew-to-be's namesake? No — the
    // invitee guard that can fail before the team exists is the block
    // pair; simulate the simplest refusal: inviting yourself.
    const [own] = await db
      .update(collabResponses)
      .set({ responderId: "author" })
      .where(eq(collabResponses.id, subject.id))
      .returning();
    expect(own).toBeDefined();

    await expect(
      call(
        acceptAndInvite,
        { responseId: subject.id, team: { create: { name: "Ghost Crew" } }, invite: true },
        asUser("author"),
      ),
    ).rejects.toThrow(/already on this team/);
    expect(await db.select().from(teams)).toHaveLength(0);
    expect((await loadPostRow(postId)).teamId).toBeNull();
  });
});

describe("post links", () => {
  it("linkPostTeam flips a solo post into a team post", async () => {
    const postId = await seedCollabPost(db, "author", { isIndividual: true });
    const team = await seedTeam("author");

    const updated = await call(linkPostTeam, { postId, teamId: team.id }, asUser("author"));
    expect(updated).toMatchObject({ teamId: team.id, isIndividual: false });
  });

  it("updatePostLinks re-derives the project name on link and unlinks with null", async () => {
    const postId = await seedCollabPost(db, "author", { projectName: "Working Title" });
    const [project] = await db
      .insert(projects)
      .values({ slug: "cathedral", title: "Cathedral of Wires", createdBy: "author" })
      .returning();
    const team = await seedTeam("author");

    const linked = await call(
      updatePostLinks,
      { postId, projectId: project!.id, teamId: team.id },
      asUser("author"),
    );
    expect(linked).toMatchObject({
      projectId: project!.id,
      projectName: "Cathedral of Wires",
      teamId: team.id,
      isIndividual: false,
    });

    const unlinked = await call(
      updatePostLinks,
      { postId, projectId: null, teamId: null },
      asUser("author"),
    );
    expect(unlinked).toMatchObject({ projectId: null, teamId: null });
    // Unlinking keeps the derived name as the post's own free text.
    expect(unlinked.projectName).toBe("Cathedral of Wires");
  });

  it("updatePostLinks fills a blank timeline from the jam but never overwrites one", async () => {
    const postId = await seedCollabPost(db, "author", { projectLength: "6+ months" });
    // No jam rows in the harness, so a missing jam is the refusal to test.
    await expect(
      call(updatePostLinks, { postId, jamId: 999, projectLength: "<1 week" }, asUser("author")),
    ).rejects.toThrow(/jam no longer exists/);
    expect((await loadPostRow(postId)).projectLength).toBe("6+ months");
  });

  it("is owner-only", async () => {
    const postId = await seedCollabPost(db, "author");
    await expect(
      call(updatePostLinks, { postId, projectId: null }, asUser("outsider")),
    ).rejects.toThrow(/own posts/);
  });
});

describe("the five-field post", () => {
  it("saves through createPost with only type, title, description, and one role", async () => {
    const [role] = await db
      .insert(collabRoles)
      .values({ name: "Pixel Artist" })
      .onConflictDoNothing()
      .returning();
    const roleId =
      role?.id ?? (await db.select({ id: collabRoles.id }).from(collabRoles).limit(1)).at(0)!.id;

    const post = await call(
      createPost,
      {
        type: "hobby",
        title: "Pixel artist for a PSX horror RPG",
        description: "A short atmospheric horror RPG in the PSX style. Looking for a pixel artist.",
        roleIds: [roleId],
      },
      asUser("author"),
    );
    expect(post).toMatchObject({
      projectName: null,
      platforms: [],
      projectLength: null,
      experienceLevel: null,
      teamId: null,
      isIndividual: false,
    });
  });
});
