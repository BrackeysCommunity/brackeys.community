import { call } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  forumPostReports,
  forumPosts,
  forumTags,
  moderationActions,
  notifications,
  threads,
  user,
} from "@/db/schema";
import { reopenReport } from "@/orpc/router/admin";
import {
  createForumPost,
  getForumPost,
  listForumPosts,
  listForumReports,
  listRecentForumPosts,
  reportForumPost,
  resolveForumReport,
  setForumPostHidden,
  setForumPostPinned,
  staffDeleteForumPost,
  staffUpdateForumPost,
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
  await db.delete(notifications);
  await db.delete(moderationActions);
  await db.delete(threads);
  await db.delete(forumPosts);
  await db.delete(forumTags);
  await db.delete(developerProfiles);
  await db.delete(user);
  await seedUser(db, "alice");
  await seedUser(db, "bob");
  // Past slow mode: a fresh account can't publish its first post.
  await db.update(user).set({ createdAt: new Date(Date.now() - 7 * 86_400_000) });
  await seedUser(db, "mod", { guildRoles: ["Moderator"] });
});

const post = (body = "hello") => call(createForumPost, { kind: "post", body }, asUser("alice"));

async function actions() {
  const rows = await db.select().from(moderationActions);
  return rows.map((r) => r.action).sort();
}

async function noticesFor(userId: string) {
  const rows = await db.select().from(notifications).where(eq(notifications.userId, userId));
  return rows.map((r) => r.type).sort();
}

describe("staff gate", () => {
  it("refuses members, and answers NOT_FOUND to staff while the forum is dark", async () => {
    const created = await post();
    await expect(
      call(setForumPostHidden, { postId: created.id, hidden: true, reason: "x" }, asUser("bob")),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    forumEnabled = false;
    await expect(call(listRecentForumPosts, {}, asUser("mod"))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("hide", () => {
  it("needs a reason, drops the post from the feed, logs it and tells the author", async () => {
    const created = await post();
    await expect(
      call(setForumPostHidden, { postId: created.id, hidden: true }, asUser("mod")),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    await call(
      setForumPostHidden,
      { postId: created.id, hidden: true, reason: "spam" },
      asUser("mod"),
    );
    expect((await call(listForumPosts, {}, asUser(null))).posts).toHaveLength(0);
    expect(await actions()).toEqual(["forum_post_hidden"]);
    expect(await noticesFor("alice")).toEqual(["forum_post_hidden_by_staff"]);

    await call(setForumPostHidden, { postId: created.id, hidden: false }, asUser("mod"));
    expect((await call(listForumPosts, {}, asUser(null))).posts).toHaveLength(1);
    expect(await noticesFor("alice")).toEqual([
      "forum_post_hidden_by_staff",
      "forum_post_unhidden_by_staff",
    ]);
  });
});

describe("pin, move and retag", () => {
  it("pins a live post and refuses a hidden one", async () => {
    const created = await post("pinned");
    await call(setForumPostPinned, { postId: created.id, scope: "global" }, asUser("mod"));
    expect((await call(listForumPosts, {}, asUser(null))).pinned.map((p) => p.id)).toEqual([
      created.id,
    ]);

    await call(
      setForumPostHidden,
      { postId: created.id, hidden: true, reason: "x" },
      asUser("mod"),
    );
    await expect(
      call(setForumPostPinned, { postId: created.id, scope: "global" }, asUser("mod")),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("moves and retags, logging each half with before and after", async () => {
    const created = await call(
      createForumPost,
      { kind: "post", body: "x", tags: ["godot"] },
      asUser("alice"),
    );
    await call(
      staffUpdateForumPost,
      { postId: created.id, category: "off-topic", tags: ["unity"], reason: "wrong board" },
      asUser("mod"),
    );

    const page = await call(getForumPost, { postId: created.id }, asUser(null));
    expect(page).toMatchObject({
      category: { slug: "off-topic" },
      tags: ["unity"],
      editedAt: null,
    });
    const log = await db.select().from(moderationActions);
    expect(log.find((r) => r.action === "forum_post_moved")!.metadata).toMatchObject({
      from: "show-and-tell",
      to: "off-topic",
    });
    expect(log.find((r) => r.action === "forum_post_retagged")!.metadata).toMatchObject({
      before: ["godot"],
      after: ["unity"],
    });
  });
});

describe("reports", () => {
  it("resolves every report on a post at once and tells each reporter", async () => {
    await seedUser(db, "carol");
    const created = await post();
    await call(reportForumPost, { postId: created.id, reason: "spam" }, asUser("bob"));
    await call(reportForumPost, { postId: created.id, reason: "rude" }, asUser("carol"));

    const queue = await call(listForumReports, {}, asUser("mod"));
    expect(queue).toHaveLength(2);
    expect(queue[0]!.postAuthor?.displayName).toBe("alice");

    await call(
      resolveForumReport,
      { reportId: queue[0]!.id, action: "delete_post", reason: "spam" },
      asUser("mod"),
    );
    expect(await call(listForumReports, {}, asUser("mod"))).toHaveLength(0);
    expect(await noticesFor("bob")).toEqual(["report_resolved"]);
    expect(await noticesFor("carol")).toEqual(["report_resolved"]);
    expect(await noticesFor("alice")).toEqual(["forum_post_deleted_by_staff"]);

    const page = await call(getForumPost, { postId: created.id }, asUser(null));
    expect(page!.visibility).toBe("deleted");
  });

  it("reopens a resolved forum report", async () => {
    const created = await post();
    await call(reportForumPost, { postId: created.id, reason: "spam" }, asUser("bob"));
    const [report] = await call(listForumReports, {}, asUser("mod"));
    await call(resolveForumReport, { reportId: report!.id, action: "dismiss" }, asUser("mod"));

    const result = await call(
      reopenReport,
      { reportId: report!.id, kind: "forum_post" },
      asUser("mod"),
    );
    expect(result.reopened).toBe(true);
    const [row] = await db
      .select()
      .from(forumPostReports)
      .where(and(eq(forumPostReports.id, report!.id)));
    expect(row!.resolvedAt).toBeNull();
  });
});

describe("recent posts", () => {
  it("lists every post whatever its state, newest first", async () => {
    const a = await post("a");
    const b = await post("b");
    await call(staffDeleteForumPost, { postId: a.id, reason: "dupe" }, asUser("mod"));
    await call(setForumPostHidden, { postId: b.id, hidden: true, reason: "x" }, asUser("mod"));

    const { posts } = await call(listRecentForumPosts, {}, asUser("mod"));
    expect(posts.map((p) => [p.id, p.deletedAt != null, p.hiddenAt != null])).toEqual([
      [b.id, false, true],
      [a.id, true, false],
    ]);
  });
});
