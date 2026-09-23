import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { forumPosts, forumTags, teamMembers, teams, threads, user, userBlocks } from "@/db/schema";
import {
  createForumPost,
  deleteForumPost,
  getForumPost,
  listForumPosts,
  searchForumTags,
  setForumReaction,
  updateForumPost,
} from "@/orpc/router/forum";
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
const nonMembers = new Set<string>();
vi.mock("@/lib/discord", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/discord")>()),
  isGuildMember: async (discordId: string) => !nonMembers.has(discordId),
}));
vi.mock("@/lib/guild-sync", () => ({
  refreshGuildRolesThrottled: async () => {},
}));
let forumEnabled = true;
vi.mock("@/lib/posthog-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/posthog-server")>()),
  isServerFlagEnabled: async () => forumEnabled,
}));

let db: TestDb;

beforeEach(async () => {
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
  const { developerProfiles } = await import("@/db/schema");
  forumEnabled = true;
  nonMembers.clear();
  await db.delete(threads);
  await db.delete(forumPosts);
  await db.delete(forumTags);
  await db.delete(userBlocks);
  await db.delete(teams);
  await db.delete(developerProfiles);
  await db.delete(user);
  await seedUser(db, "alice");
  await seedUser(db, "bob");
});

const post = (body = "hello", extra: Record<string, unknown> = {}) =>
  call(createForumPost, { kind: "post", body, ...extra }, asUser("alice"));

async function seedTeam(ownerId: string, memberIds: string[] = []) {
  const [team] = await db
    .insert(teams)
    .values({ slug: "crew", name: "Crew", createdBy: ownerId })
    .returning({ id: teams.id });
  await db
    .insert(teamMembers)
    .values([
      { teamId: team!.id, userId: ownerId, role: "owner" },
      ...memberIds.map((userId) => ({ teamId: team!.id, userId, role: "member" })),
    ]);
  return team!.id;
}

describe("access", () => {
  it("answers NOT_FOUND to reads and writes while the flag is off", async () => {
    forumEnabled = false;
    await expect(call(listForumPosts, {}, asUser(null))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(post()).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("lets anyone read but only guild members write", async () => {
    await post();
    const { posts } = await call(listForumPosts, {}, asUser(null));
    expect(posts).toHaveLength(1);

    await expect(
      call(createForumPost, { kind: "post", body: "hi" }, asUser(null)),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    nonMembers.add("discord-bob");
    await expect(
      call(createForumPost, { kind: "post", body: "hi" }, asUser("bob")),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("keeps Announcements to staff", async () => {
    await expect(
      call(
        createForumPost,
        { kind: "question", title: "News?", body: "x", category: "announcements" },
        asUser("alice"),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("posting", () => {
  it("files each kind under its default category and enforces titles", async () => {
    await expect(post("hi", { title: "Nope" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      call(createForumPost, { kind: "question", body: "how?" }, asUser("alice")),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const q = await call(
      createForumPost,
      { kind: "question", title: "How do I jump?", body: "Godot 4" },
      asUser("alice"),
    );
    expect(q.slug).toBe("how-do-i-jump");
    const page = await call(getForumPost, { postId: q.id }, asUser(null));
    expect(page!.category.slug).toBe("help");
    expect(page!.excerpt).toBe("Godot 4");
  });

  it("posts a devlog as a team only for its members", async () => {
    const teamId = await seedTeam("alice");
    const created = await call(
      createForumPost,
      { kind: "devlog", title: "Entry 1", body: "We started.", teamId },
      asUser("alice"),
    );
    const page = await call(getForumPost, { postId: created.id }, asUser(null));
    expect(page!.team?.name).toBe("Crew");

    await expect(
      call(
        createForumPost,
        { kind: "devlog", title: "Mine now", body: "x", teamId },
        asUser("bob"),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(post("x", { teamId })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects a profane title or tag", async () => {
    await expect(
      call(
        createForumPost,
        { kind: "question", title: "what the fuck", body: "x" },
        asUser("alice"),
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(post("x", { tags: ["shit"] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("tags", () => {
  it("creates, counts and autocompletes tags", async () => {
    await post("a", { tags: ["#Godot", "pixel art"] });
    await post("b", { tags: ["godot"] });

    const found = await call(searchForumTags, { query: "go" }, asUser(null));
    expect(found).toEqual([{ slug: "godot", name: "godot", usageCount: 2 }]);

    const { posts } = await call(listForumPosts, { tag: "pixel-art" }, asUser(null));
    expect(posts.map((p) => p.body)).toEqual(["a"]);
  });

  it("recounts only the tags an edit moved", async () => {
    const created = await post("a", { tags: ["godot", "unity"] });
    await call(
      updateForumPost,
      { postId: created.id, body: "a", tags: ["godot"] },
      asUser("alice"),
    );
    const rows = await db.select().from(forumTags);
    expect(Object.fromEntries(rows.map((t) => [t.slug, t.usageCount]))).toEqual({
      godot: 1,
      unity: 0,
    });
  });

  it("resolves a merged tag to its target and refuses a banned one", async () => {
    const [target] = await db
      .insert(forumTags)
      .values({ slug: "godot", name: "godot" })
      .returning({ id: forumTags.id });
    await db.insert(forumTags).values([
      { slug: "godot-engine", name: "godot-engine", mergedIntoId: target!.id },
      { slug: "spam", name: "spam", status: "banned" },
    ]);

    const created = await post("a", { tags: ["godot-engine"] });
    const page = await call(getForumPost, { postId: created.id }, asUser(null));
    expect(page!.tags).toEqual(["godot"]);
    await expect(post("b", { tags: ["spam"] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("feed", () => {
  it("pages latest by keyset without repeats", async () => {
    for (let i = 0; i < 5; i++) await post(`p${i}`);
    const first = await call(listForumPosts, { limit: 2 }, asUser(null));
    const second = await call(
      listForumPosts,
      { limit: 2, cursor: first.nextCursor! },
      asUser(null),
    );
    const third = await call(
      listForumPosts,
      { limit: 2, cursor: second.nextCursor! },
      asUser(null),
    );
    expect([...first.posts, ...second.posts, ...third.posts].map((p) => p.body)).toEqual([
      "p4",
      "p3",
      "p2",
      "p1",
      "p0",
    ]);
    expect(third.nextCursor).toBeNull();
  });

  it("leaves out hidden posts, banned authors, and blocked people", async () => {
    const hidden = await post("hidden");
    await db.update(forumPosts).set({ hiddenAt: new Date() }).where(eq(forumPosts.id, hidden.id));
    await call(createForumPost, { kind: "post", body: "from bob" }, asUser("bob"));
    await post("visible");

    const everyone = await call(listForumPosts, {}, asUser(null));
    expect(everyone.posts.map((p) => p.body)).toEqual(["visible", "from bob"]);

    await db.insert(userBlocks).values({ blockerId: "bob", blockedId: "alice" });
    const forBob = await call(listForumPosts, {}, asUser("bob"));
    expect(forBob.posts.map((p) => p.body)).toEqual(["from bob"]);

    await db.update(user).set({ bannedAt: new Date() }).where(eq(user.id, "bob"));
    const afterBan = await call(listForumPosts, {}, asUser(null));
    expect(afterBan.posts.map((p) => p.body)).toEqual(["visible"]);
  });

  it("returns global pins first and keeps them out of the stream", async () => {
    const pinned = await post("pinned");
    await post("newer");
    await db
      .update(forumPosts)
      .set({ pinnedAt: new Date(), pinnedScope: "global" })
      .where(eq(forumPosts.id, pinned.id));

    const feed = await call(listForumPosts, {}, asUser(null));
    expect(feed.pinned.map((p) => p.body)).toEqual(["pinned"]);
    expect(feed.posts.map((p) => p.body)).toEqual(["newer"]);
  });

  it("ranks top by likes and comments", async () => {
    const quiet = await post("quiet");
    const liked = await post("liked");
    await call(setForumReaction, { postId: liked.id, liked: true }, asUser("bob"));
    const { posts } = await call(listForumPosts, { sort: "top", window: "all" }, asUser(null));
    expect(posts.map((p) => p.id)).toEqual([liked.id, quiet.id]);
  });
});

describe("likes", () => {
  it("counts a like once however often it is sent", async () => {
    const created = await post();
    await call(setForumReaction, { postId: created.id, liked: true }, asUser("bob"));
    const again = await call(setForumReaction, { postId: created.id, liked: true }, asUser("bob"));
    expect(again.likeCount).toBe(1);
    await call(setForumReaction, { postId: created.id, liked: false }, asUser("bob"));
    const off = await call(setForumReaction, { postId: created.id, liked: false }, asUser("bob"));
    expect(off.likeCount).toBe(0);

    const { posts } = await call(listForumPosts, {}, asUser("bob"));
    expect(posts[0]!.viewer.liked).toBe(false);
  });
});

describe("post page", () => {
  it("strips a hidden post for readers but not for its author", async () => {
    const created = await post("secret");
    await db
      .update(forumPosts)
      .set({ hiddenAt: new Date(), hiddenReason: "spam" })
      .where(eq(forumPosts.id, created.id));

    const reader = await call(getForumPost, { postId: created.id }, asUser("bob"));
    expect(reader).toMatchObject({ visibility: "hidden", body: null, hiddenReason: null });
    const author = await call(getForumPost, { postId: created.id }, asUser("alice"));
    expect(author).toMatchObject({ visibility: "hidden", body: "secret", hiddenReason: "spam" });
  });

  it("serves drafts to their author only, and publishing stamps them", async () => {
    const draft = await call(
      createForumPost,
      { kind: "devlog", title: "WIP", body: "soon", draft: true },
      asUser("alice"),
    );
    expect(await call(getForumPost, { postId: draft.id }, asUser("bob"))).toBeNull();
    expect((await call(listForumPosts, {}, asUser(null))).posts).toHaveLength(0);

    await call(
      updateForumPost,
      { postId: draft.id, title: "Done", body: "shipped", publish: true },
      asUser("alice"),
    );
    const page = await call(getForumPost, { postId: draft.id }, asUser("bob"));
    expect(page).toMatchObject({ status: "published", title: "Done", editedAt: null });
  });

  it("lets a team owner delete a member's devlog, leaving a tombstone", async () => {
    const teamId = await seedTeam("bob", ["alice"]);
    const created = await call(
      createForumPost,
      { kind: "devlog", title: "Entry", body: "x", teamId },
      asUser("alice"),
    );
    await call(deleteForumPost, { postId: created.id }, asUser("bob"));
    const page = await call(getForumPost, { postId: created.id }, asUser(null));
    expect(page).toMatchObject({ visibility: "deleted", title: null, body: null });
  });

  it("refuses edits from someone else", async () => {
    const created = await post();
    await expect(
      call(updateForumPost, { postId: created.id, body: "mine" }, asUser("bob")),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
