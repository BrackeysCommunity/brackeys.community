import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { forumPosts, forumSeries, teamMembers, teams, threads, user } from "@/db/schema";
import {
  createForumPost,
  deleteForumPost,
  getForumPost,
  updateForumPost,
} from "@/orpc/router/forum";
import {
  createForumSeries,
  deleteForumSeries,
  getForumSeries,
  listForumSeries,
  reorderForumSeries,
} from "@/orpc/router/forum-series";
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
  await db.delete(forumSeries);
  await db.delete(teams);
  await db.delete(developerProfiles);
  await db.delete(user);
  for (const id of ["alice", "bob", "carol"]) await seedUser(db, id);
  // Past slow mode: a fresh account can't publish its first post.
  await db.update(user).set({ createdAt: new Date(Date.now() - 7 * 86_400_000) });
});

async function seedTeam() {
  const [team] = await db
    .insert(teams)
    .values({ slug: "crew", name: "Crew", createdBy: "alice" })
    .returning({ id: teams.id });
  await db.insert(teamMembers).values([
    { teamId: team!.id, userId: "alice", role: "owner" },
    { teamId: team!.id, userId: "bob", role: "member" },
  ]);
  return team!.id;
}

const devlog = (who: string, title: string, extra: Record<string, unknown> = {}) =>
  call(createForumPost, { kind: "devlog", title, body: "words", ...extra }, asUser(who));

const indexOf = async (postId: number) =>
  (await db.select().from(forumPosts).where(eq(forumPosts.id, postId)))[0]!.seriesIndex;

describe("series", () => {
  it("numbers published entries in order and skips drafts until they go out", async () => {
    const series = await call(createForumSeries, { title: "Road to demo" }, asUser("alice"));
    const one = await devlog("alice", "One", { seriesId: series.id });
    const draft = await devlog("alice", "Two", { seriesId: series.id, draft: true });
    const three = await devlog("alice", "Three", { seriesId: series.id });

    expect(await indexOf(one.id)).toBe(1);
    expect(await indexOf(draft.id)).toBeNull();
    expect(await indexOf(three.id)).toBe(2);

    await call(
      updateForumPost,
      { postId: draft.id, title: "Two", body: "words", publish: true },
      asUser("alice"),
    );
    expect(await indexOf(draft.id)).toBe(3);

    const page = await call(getForumPost, { postId: three.id }, asUser(null));
    expect(page?.series).toMatchObject({
      id: series.id,
      total: 3,
      prev: { id: one.id },
      next: { id: draft.id },
    });
  });

  it("closes the gap when an entry is deleted or leaves the series", async () => {
    const series = await call(createForumSeries, { title: "Log" }, asUser("alice"));
    const a = await devlog("alice", "A", { seriesId: series.id });
    const b = await devlog("alice", "B", { seriesId: series.id });
    const c = await devlog("alice", "C", { seriesId: series.id });

    await call(deleteForumPost, { postId: a.id }, asUser("alice"));
    expect(await indexOf(b.id)).toBe(1);
    expect(await indexOf(c.id)).toBe(2);

    await call(
      updateForumPost,
      { postId: b.id, title: "B", body: "words", seriesId: null },
      asUser("alice"),
    );
    expect(await indexOf(b.id)).toBeNull();
    expect(await indexOf(c.id)).toBe(1);
  });

  it("reorders, and refuses a stale list", async () => {
    const series = await call(createForumSeries, { title: "Log" }, asUser("alice"));
    const a = await devlog("alice", "A", { seriesId: series.id });
    const b = await devlog("alice", "B", { seriesId: series.id });

    await call(reorderForumSeries, { seriesId: series.id, postIds: [b.id, a.id] }, asUser("alice"));
    const got = await call(getForumSeries, { seriesId: series.id }, asUser(null));
    expect(got?.entries.map((e) => e.id)).toEqual([b.id, a.id]);

    await expect(
      call(reorderForumSeries, { seriesId: series.id, postIds: [a.id] }, asUser("alice")),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("keeps team series to the team and solo series to their owner", async () => {
    const teamId = await seedTeam();
    const teamSeries = await call(createForumSeries, { title: "Crew log", teamId }, asUser("bob"));
    await expect(
      call(createForumSeries, { title: "Nope", teamId }, asUser("carol")),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await expect(
      devlog("alice", "Solo into team series", { seriesId: teamSeries.id }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      devlog("alice", "Team", { teamId, seriesId: teamSeries.id }),
    ).resolves.toMatchObject({ status: "published" });

    const mine = await call(createForumSeries, { title: "Mine" }, asUser("carol"));
    await expect(devlog("bob", "Theirs", { seriesId: mine.id })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(
      call(createForumPost, { kind: "post", body: "hi", seriesId: mine.id }, asUser("carol")),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const listed = await call(listForumSeries, { teamId }, asUser(null));
    expect(listed).toEqual([expect.objectContaining({ title: "Crew log", entryCount: 1 })]);

    // A member renames and reorders; only the owner deletes.
    await expect(
      call(deleteForumSeries, { seriesId: teamSeries.id }, asUser("bob")),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await call(deleteForumSeries, { seriesId: teamSeries.id }, asUser("alice"));
    const rows = await db.select().from(forumPosts);
    expect(rows.every((r) => r.seriesId === null && r.seriesIndex === null)).toBe(true);
  });

  it("gives a series of the same name a fresh slug", async () => {
    const a = await call(createForumSeries, { title: "Log" }, asUser("alice"));
    const b = await call(createForumSeries, { title: "Log" }, asUser("alice"));
    expect([a.slug, b.slug]).toEqual(["log", "log-2"]);
  });
});

describe("co-authors", () => {
  it("bylines team members on a team devlog only", async () => {
    const teamId = await seedTeam();
    const post = await devlog("alice", "Together", { teamId, coAuthorIds: ["bob"] });
    const page = await call(getForumPost, { postId: post.id }, asUser(null));
    expect(page?.coAuthors.map((a) => a.id)).toEqual(["bob"]);

    await expect(
      devlog("alice", "Outsider", { teamId, coAuthorIds: ["carol"] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(devlog("alice", "Solo", { coAuthorIds: ["bob"] })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });

    // A co-author may edit; clearing the list removes them.
    await call(
      updateForumPost,
      { postId: post.id, title: "Together", body: "edited", coAuthorIds: [] },
      asUser("bob"),
    );
    const after = await call(getForumPost, { postId: post.id }, asUser(null));
    expect(after?.coAuthors).toEqual([]);
  });
});
