import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  forumFollows,
  forumPosts,
  forumTags,
  teamMembers,
  teams,
  threads,
  user,
} from "@/db/schema";
import { createForumPost, listForumPosts } from "@/orpc/router/forum";
import { listMyForumFollows, setForumFollow } from "@/orpc/router/forum-follows";
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
vi.mock("@/lib/posthog-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/posthog-server")>()),
  isServerFlagEnabled: async () => true,
}));

let db: TestDb;

beforeEach(async () => {
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
  const { developerProfiles } = await import("@/db/schema");
  await db.delete(threads);
  await db.delete(forumPosts);
  await db.delete(forumFollows);
  await db.delete(forumTags);
  await db.delete(teams);
  await db.delete(developerProfiles);
  await db.delete(user);
  for (const id of ["alice", "bob", "carol", "dave"]) await seedUser(db, id);
  // Past slow mode: a fresh account can't publish its first post.
  await db.update(user).set({ createdAt: new Date(Date.now() - 7 * 86_400_000) });
});

const follow = (who: string, targetType: string, target: string, following = true) =>
  call(setForumFollow, { targetType: targetType as "user", target, following }, asUser(who));

const feedIds = async (who: string | null, sort: "following" | "hot") =>
  (await call(listForumPosts, { sort }, asUser(who))).posts.map((p) => p.id);

describe("follows", () => {
  it("builds the Following feed from users, teams, tags, categories and series", async () => {
    const [team] = await db
      .insert(teams)
      .values({ slug: "crew", name: "Crew", createdBy: "carol" })
      .returning({ id: teams.id });
    await db.insert(teamMembers).values({ teamId: team!.id, userId: "carol", role: "owner" });

    const byBob = await call(createForumPost, { kind: "post", body: "bob" }, asUser("bob"));
    const byCrew = await call(
      createForumPost,
      { kind: "devlog", title: "Crew", body: "crew", teamId: team!.id },
      asUser("carol"),
    );
    const tagged = await call(
      createForumPost,
      { kind: "post", body: "tagged", tags: ["godot"] },
      asUser("dave"),
    );
    const help = await call(
      createForumPost,
      { kind: "question", title: "How?", body: "help" },
      asUser("dave"),
    );
    await call(createForumPost, { kind: "post", body: "unrelated" }, asUser("dave"));

    expect(await feedIds("alice", "following")).toEqual([]);
    await follow("alice", "user", "bob");
    await follow("alice", "team", team!.id);
    await follow("alice", "tag", "#Godot");
    await follow("alice", "category", "help");

    expect(new Set(await feedIds("alice", "following"))).toEqual(
      new Set([byBob.id, byCrew.id, tagged.id, help.id]),
    );

    const mine = await call(listMyForumFollows, {}, asUser("alice"));
    expect(mine.users.map((u) => u.id)).toEqual(["bob"]);
    expect(mine.teams.map((t) => t.name)).toEqual(["Crew"]);
    expect(mine.tags).toEqual(["godot"]);
    expect(mine.categories.map((c) => c.slug)).toEqual(["help"]);

    await follow("alice", "user", "bob", false);
    expect(await feedIds("alice", "following")).not.toContain(byBob.id);
  });

  it("refuses unknown targets and yourself", async () => {
    await expect(follow("alice", "tag", "nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(follow("alice", "user", "alice")).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("gives signed-out readers an empty Following feed", async () => {
    await call(createForumPost, { kind: "post", body: "hi" }, asUser("bob"));
    expect(await feedIds(null, "following")).toEqual([]);
  });
});

describe("for you", () => {
  it("ranks by engagement over age, boosts follows, and skips old posts", async () => {
    const quiet = await call(createForumPost, { kind: "post", body: "quiet" }, asUser("bob"));
    const loud = await call(createForumPost, { kind: "post", body: "loud" }, asUser("carol"));
    const stale = await call(createForumPost, { kind: "post", body: "stale" }, asUser("dave"));
    await db.update(forumPosts).set({ likeCount: 5 }).where(eq(forumPosts.id, loud.id));
    await db
      .update(forumPosts)
      .set({ likeCount: 50, publishedAt: new Date(Date.now() - 20 * 86_400_000) })
      .where(eq(forumPosts.id, stale.id));

    expect(await feedIds(null, "hot")).toEqual([loud.id, quiet.id]);

    // Following bob doubles quiet's score, which is still under loud's 6×.
    await follow("alice", "user", "bob");
    expect(await feedIds("alice", "hot")).toEqual([loud.id, quiet.id]);
    await db.update(forumPosts).set({ likeCount: 2 }).where(eq(forumPosts.id, quiet.id));
    await db.update(forumPosts).set({ likeCount: 3 }).where(eq(forumPosts.id, loud.id));
    expect(await feedIds("alice", "hot")).toEqual([quiet.id, loud.id]);
    expect(await feedIds(null, "hot")).toEqual([loud.id, quiet.id]);
  });
});
