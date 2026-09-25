import { call } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  forumFollows,
  forumPosts,
  notifications,
  profileUrlStubs,
  teamMembers,
  teams,
  threads,
  user,
} from "@/db/schema";
import { forumAtomResponse } from "@/lib/forum-atom";
import { createComment, listComments } from "@/orpc/router/comments";
import {
  createForumPost,
  getForumPost,
  listMyForumDrafts,
  markForumSolution,
  searchForumPosts,
  setForumReaction,
  updateForumPost,
} from "@/orpc/router/forum";
import { setForumFollow } from "@/orpc/router/forum-follows";
import { listNotifications } from "@/orpc/router/notifications";
import { seedUser, type TestDb } from "@/test/db";
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
vi.mock("@/lib/posthog-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/posthog-server")>()),
  isServerFlagEnabled: async () => true,
}));

let db: TestDb;

beforeEach(async () => {
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
  const { developerProfiles } = await import("@/db/schema");
  await db.delete(notifications);
  await db.delete(threads);
  await db.delete(forumPosts);
  await db.delete(forumFollows);
  await db.delete(teams);
  await db.delete(developerProfiles);
  await db.delete(user);
  for (const id of ["alice", "bob", "carol", "dave"]) {
    await seedUser(db, id);
    await db.insert(profileUrlStubs).values({ profileId: id, stub: id });
  }
  // Past slow mode: a fresh account can't publish its first post.
  await db.update(user).set({ createdAt: new Date(Date.now() - 7 * 86_400_000) });
});

const notificationsFor = (userId: string, type: string) =>
  db
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.type, type as "forum_mention")));

const comment = (who: string, postId: number, content: string, parentId?: number) =>
  call(
    createComment,
    { subject: { type: "forum_post", id: postId }, content, parentId },
    asUser(who),
  );

describe("solutions", () => {
  it("lets the asker accept a top-level answer and tells its author", async () => {
    const q = await call(
      createForumPost,
      { kind: "question", title: "Why?", body: "help" },
      asUser("alice"),
    );
    const answer = await comment("bob", q.id, "because");
    const reply = await comment("carol", q.id, "agreed", answer.id);

    await expect(
      call(markForumSolution, { postId: q.id, commentId: answer.id }, asUser("bob")),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      call(markForumSolution, { postId: q.id, commentId: reply.id }, asUser("alice")),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    await call(markForumSolution, { postId: q.id, commentId: answer.id }, asUser("alice"));
    const page = await call(getForumPost, { postId: q.id }, asUser(null));
    expect(page?.solved).toBe(true);
    expect(page?.solution).toMatchObject({ id: answer.id, content: "because" });
    await expect
      .poll(async () => (await notificationsFor("bob", "forum_answer_accepted")).length)
      .toBe(1);

    await call(markForumSolution, { postId: q.id, commentId: null }, asUser("alice"));
    expect((await call(getForumPost, { postId: q.id }, asUser(null)))?.solved).toBe(false);
  });

  it("refuses a comment from another post's thread, and non-questions", async () => {
    const q = await call(
      createForumPost,
      { kind: "question", title: "Q", body: "q" },
      asUser("alice"),
    );
    const other = await call(createForumPost, { kind: "post", body: "p" }, asUser("alice"));
    const elsewhere = await comment("bob", other.id, "hi");
    await expect(
      call(markForumSolution, { postId: q.id, commentId: elsewhere.id }, asUser("alice")),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      call(markForumSolution, { postId: other.id, commentId: elsewhere.id }, asUser("alice")),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("author badge", () => {
  it("marks comments from the post's writers and its team", async () => {
    const [team] = await db
      .insert(teams)
      .values({ slug: "crew", name: "Crew", createdBy: "alice" })
      .returning({ id: teams.id });
    await db.insert(teamMembers).values([
      { teamId: team!.id, userId: "alice", role: "owner" },
      { teamId: team!.id, userId: "bob", role: "member" },
    ]);
    const post = await call(
      createForumPost,
      { kind: "devlog", title: "Log", body: "words", teamId: team!.id },
      asUser("alice"),
    );
    await comment("alice", post.id, "author here");
    await comment("bob", post.id, "crew here");
    await comment("carol", post.id, "reader here");
    const { comments } = await call(
      listComments,
      { subject: { type: "forum_post", id: post.id } },
      asUser(null),
    );
    const marks = Object.fromEntries(comments.map((c) => [c.author?.id, c.byAuthor]));
    expect(marks).toEqual({ alice: true, bob: true, carol: false });
  });
});

describe("notifications", () => {
  it("tells a devlog's followers once it goes out, drafts only on publish", async () => {
    await call(
      setForumFollow,
      { targetType: "user", target: "alice", following: true },
      asUser("bob"),
    );
    const draft = await call(
      createForumPost,
      { kind: "devlog", title: "Soon", body: "wip", draft: true },
      asUser("alice"),
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(await notificationsFor("bob", "forum_devlog_published")).toHaveLength(0);

    await call(
      updateForumPost,
      { postId: draft.id, title: "Soon", body: "done", publish: true },
      asUser("alice"),
    );
    await expect
      .poll(async () => (await notificationsFor("bob", "forum_devlog_published")).length)
      .toBe(1);
    // A plain post isn't a devlog.
    await call(createForumPost, { kind: "post", body: "hi" }, asUser("alice"));
    await new Promise((r) => setTimeout(r, 50));
    expect(await notificationsFor("bob", "forum_devlog_published")).toHaveLength(1);
  });

  it("folds likes into one row per post that stays out of the bell", async () => {
    const post = await call(createForumPost, { kind: "post", body: "hi" }, asUser("alice"));
    await call(setForumReaction, { postId: post.id, liked: true }, asUser("bob"));
    await expect
      .poll(async () => (await notificationsFor("alice", "forum_post_liked")).length)
      .toBe(1);
    await call(setForumReaction, { postId: post.id, liked: true }, asUser("carol"));
    await expect
      .poll(async () => (await notificationsFor("alice", "forum_post_liked"))[0]?.data.likers)
      .toBe(2);
    const [row] = await notificationsFor("alice", "forum_post_liked");
    expect(row?.actorId).toBe("carol");

    const inbox = await call(listNotifications, {}, asUser("alice"));
    expect(inbox.items.map((n) => n.type)).not.toContain("forum_post_liked");
  });

  it("notifies @mentions in posts, edits and comments, once each", async () => {
    const post = await call(
      createForumPost,
      { kind: "post", body: "thanks @bob and @alice and @nobody" },
      asUser("alice"),
    );
    await expect.poll(async () => (await notificationsFor("bob", "forum_mention")).length).toBe(1);
    expect(await notificationsFor("alice", "forum_mention")).toHaveLength(0);

    await comment("dave", post.id, "cc @carol");
    await expect
      .poll(async () => (await notificationsFor("carol", "forum_mention")).length)
      .toBe(1);
    const [carolRow] = await notificationsFor("carol", "forum_mention");
    expect(carolRow?.data.subjectUrl).toMatch(/^\/forum\/\d+#comment-\d+$/);

    const q = await call(
      createForumPost,
      { kind: "question", title: "Q", body: "hey @bob" },
      asUser("dave"),
    );
    await expect.poll(async () => (await notificationsFor("bob", "forum_mention")).length).toBe(2);
    await call(
      updateForumPost,
      { postId: q.id, title: "Q", body: "hey @bob and @carol" },
      asUser("dave"),
    );
    await expect
      .poll(async () => (await notificationsFor("carol", "forum_mention")).length)
      .toBe(2);
    expect(await notificationsFor("bob", "forum_mention")).toHaveLength(2);
  });
});

describe("slow mode", () => {
  it("holds a brand-new account's first post, not its comments or later posts", async () => {
    const post = await call(createForumPost, { kind: "post", body: "hi" }, asUser("alice"));
    await db.update(user).set({ createdAt: new Date() }).where(eq(user.id, "bob"));
    await expect(
      call(createForumPost, { kind: "post", body: "first!" }, asUser("bob")),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(comment("bob", post.id, "commenting is fine")).resolves.toMatchObject({
      depth: 0,
    });
    // A draft isn't public; it waits for the publish.
    await expect(
      call(
        createForumPost,
        { kind: "devlog", title: "Later", body: "wip", draft: true },
        asUser("bob"),
      ),
    ).resolves.toMatchObject({ status: "draft" });

    // Once someone has published, a new account's age no longer matters.
    await db.update(user).set({ createdAt: new Date() }).where(eq(user.id, "alice"));
    await expect(
      call(createForumPost, { kind: "post", body: "again" }, asUser("alice")),
    ).resolves.toMatchObject({ status: "published" });
  });
});

describe("search", () => {
  it("matches stemmed words in bodies, partial titles, and ranks titles first", async () => {
    const inBody = await call(
      createForumPost,
      { kind: "post", body: "Finally got my water shaders working" },
      asUser("alice"),
    );
    const inTitle = await call(
      createForumPost,
      { kind: "question", title: "Shader compile errors on Godot 4", body: "help" },
      asUser("bob"),
    );
    await call(createForumPost, { kind: "post", body: "unrelated" }, asUser("carol"));

    const hits = await call(searchForumPosts, { query: "shader" }, asUser(null));
    expect(hits.posts.map((p) => p.id)).toEqual([inTitle.id, inBody.id]);

    const partial = await call(searchForumPosts, { query: "Godo" }, asUser(null));
    expect(partial.posts.map((p) => p.id)).toEqual([inTitle.id]);
  });
});

describe("drafts", () => {
  it("lists the viewer's own unpublished devlogs", async () => {
    const draft = await call(
      createForumPost,
      { kind: "devlog", title: "WIP", body: "wip", draft: true },
      asUser("alice"),
    );
    await call(createForumPost, { kind: "devlog", title: "Out", body: "done" }, asUser("alice"));
    await call(
      createForumPost,
      { kind: "devlog", title: "Theirs", body: "wip", draft: true },
      asUser("bob"),
    );
    const drafts = await call(listMyForumDrafts, {}, asUser("alice"));
    expect(drafts.map((d) => d.id)).toEqual([draft.id]);
  });
});

describe("atom feeds", () => {
  it("lists live devlogs only, escaped, optionally for one team", async () => {
    const [team] = await db
      .insert(teams)
      .values({ slug: "crew", name: "Crew", createdBy: "alice" })
      .returning({ id: teams.id });
    await db.insert(teamMembers).values({ teamId: team!.id, userId: "alice", role: "owner" });
    await call(
      createForumPost,
      { kind: "devlog", title: "Caves & <lava>", body: "words", teamId: team!.id },
      asUser("alice"),
    );
    await call(
      createForumPost,
      { kind: "devlog", title: "Solo log", body: "words" },
      asUser("bob"),
    );
    await call(createForumPost, { kind: "post", body: "not a devlog" }, asUser("bob"));

    const all = await (
      await forumAtomResponse({
        title: "t",
        subtitle: "s",
        selfPath: "/forum/feed.xml",
        alternatePath: "/forum",
      })
    ).text();
    expect(all).toContain("Caves &amp; &lt;lava&gt;");
    expect(all).toContain("Solo log");
    expect(all).not.toContain("not a devlog");
    expect(all.match(/<entry>/g)).toHaveLength(2);

    const crew = await (
      await forumAtomResponse({
        teamId: team!.id,
        title: "t",
        subtitle: "s",
        selfPath: "/teams/crew/devlog.xml",
        alternatePath: "/teams/crew",
      })
    ).text();
    expect(crew.match(/<entry>/g)).toHaveLength(1);
    expect(crew).toContain("<name>Crew</name>");
  });
});
