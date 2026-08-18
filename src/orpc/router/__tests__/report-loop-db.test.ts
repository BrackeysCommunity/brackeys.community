import { call } from "@orpc/server";
import { count, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  collabPostReports,
  collabPosts,
  developerProfiles,
  moderationActions,
  notifications,
  user,
} from "@/db/schema";
import { reopenReport } from "@/orpc/router/admin";
import { listReports, reportPost, resolvePostReport } from "@/orpc/router/collab";
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
 * Plan 12 batch B: the report loop closes. A report can come back out of the
 * resolved pile, siblings on one subject resolve together, and everybody who
 * filed one hears what came of it.
 */

let db: TestDb;
let postId: number;

beforeEach(async () => {
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
  await db.delete(notifications);
  await db.delete(moderationActions);
  await db.delete(collabPosts);
  await db.delete(developerProfiles);
  await db.delete(user);

  await seedUser(db, "author");
  await seedUser(db, "alice");
  await seedUser(db, "bob");
  await seedUser(db, "staff", { guildRoles: ["Staff"] });
  postId = await seedCollabPost(db, "author", { title: "Need a composer" });
});

async function reportsOfType(userId: string) {
  return db
    .select({ type: notifications.type, data: notifications.data })
    .from(notifications)
    .where(eq(notifications.userId, userId));
}

describe("co-resolving sibling reports", () => {
  it("resolves every open report on the subject, not just the one clicked", async () => {
    const a = await call(reportPost, { postId, reason: "spam" }, asUser("alice"));
    const b = await call(reportPost, { postId, reason: "also spam" }, asUser("bob"));

    await call(resolvePostReport, { reportId: a!.id, action: "close_post" }, asUser("staff"));

    const rows = await db
      .select({ id: collabPostReports.id, resolvedAt: collabPostReports.resolvedAt })
      .from(collabPostReports);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.resolvedAt != null)).toBe(true);
    // The queue is empty afterwards — the second row's "Close post" used to
    // sit there as a no-op guarded on a status that had already moved.
    expect(await call(listReports, { includeResolved: false }, asUser("staff"))).toHaveLength(0);
    expect(b!.id).not.toBe(a!.id);
  });

  it("logs each sibling against the decision that closed it", async () => {
    const a = await call(reportPost, { postId, reason: "spam" }, asUser("alice"));
    await call(reportPost, { postId, reason: "also spam" }, asUser("bob"));

    await call(resolvePostReport, { reportId: a!.id, action: "dismiss" }, asUser("staff"));

    const logged = await db
      .select({ targetId: moderationActions.targetId, metadata: moderationActions.metadata })
      .from(moderationActions)
      .where(eq(moderationActions.action, "post_report_dismissed"));
    expect(logged).toHaveLength(2);
    const sibling = logged.find(
      (row) => (row.metadata as Record<string, unknown>).resolvedVia != null,
    );
    expect((sibling?.metadata as Record<string, unknown>).resolvedVia).toBe(a!.id);
  });

  it("tells every reporter, and says which way it went", async () => {
    const a = await call(reportPost, { postId, reason: "spam" }, asUser("alice"));
    await call(reportPost, { postId, reason: "also spam" }, asUser("bob"));

    await call(resolvePostReport, { reportId: a!.id, action: "close_post" }, asUser("staff"));

    for (const reporter of ["alice", "bob"]) {
      const rows = await reportsOfType(reporter);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.type).toBe("report_resolved");
      expect((rows[0]!.data as Record<string, unknown>).outcome).toBe("actioned");
    }
    // The post's author hears about the closure, never about the report.
    const authorRows = await reportsOfType("author");
    expect(authorRows.map((r) => r.type)).toEqual(["collab_post_closed_by_staff"]);
  });

  it("says 'left it up' when the report is dismissed", async () => {
    const a = await call(reportPost, { postId, reason: "spam" }, asUser("alice"));

    await call(resolvePostReport, { reportId: a!.id, action: "dismiss" }, asUser("staff"));

    const rows = await reportsOfType("alice");
    expect((rows[0]!.data as Record<string, unknown>).outcome).toBe("no_action");
  });

  it("does not notify a staffer who resolved their own report", async () => {
    const own = await call(reportPost, { postId, reason: "spam" }, asUser("staff"));

    await call(resolvePostReport, { reportId: own!.id, action: "dismiss" }, asUser("staff"));

    expect(await reportsOfType("staff")).toHaveLength(0);
  });
});

describe("reopening a report", () => {
  it("puts a resolved report back in the open queue and logs it", async () => {
    const a = await call(reportPost, { postId, reason: "spam" }, asUser("alice"));
    await call(resolvePostReport, { reportId: a!.id, action: "dismiss" }, asUser("staff"));

    const result = await call(reopenReport, { reportId: a!.id, kind: "post" }, asUser("staff"));

    expect(result.reopened).toBe(true);
    const open = await call(listReports, { includeResolved: false }, asUser("staff"));
    expect(open.map((r) => r.id)).toEqual([a!.id]);
    const [logged] = await db
      .select({ value: count() })
      .from(moderationActions)
      .where(eq(moderationActions.action, "report_reopened"));
    expect(logged!.value).toBe(1);
  });

  it("leaves the action it undoes alone — a closed post stays closed", async () => {
    const a = await call(reportPost, { postId, reason: "spam" }, asUser("alice"));
    await call(resolvePostReport, { reportId: a!.id, action: "close_post" }, asUser("staff"));

    await call(reopenReport, { reportId: a!.id, kind: "post" }, asUser("staff"));

    const [post] = await db
      .select({ status: collabPosts.status })
      .from(collabPosts)
      .where(eq(collabPosts.id, postId));
    expect(post!.status).toBe("party_full");
  });

  it("is a no-op when the same reporter already has a newer open report", async () => {
    const first = await call(reportPost, { postId, reason: "spam" }, asUser("alice"));
    await call(resolvePostReport, { reportId: first!.id, action: "dismiss" }, asUser("staff"));
    // The dedupe only blocks a duplicate while an *open* report exists, so
    // alice can file again the moment the first one is resolved.
    await call(reportPost, { postId, reason: "still spam" }, asUser("alice"));

    const result = await call(reopenReport, { reportId: first!.id, kind: "post" }, asUser("staff"));

    expect(result.reopened).toBe(false);
    expect(result.message).toMatch(/newer open report/i);
    const [row] = await db
      .select({ resolvedAt: collabPostReports.resolvedAt })
      .from(collabPostReports)
      .where(eq(collabPostReports.id, first!.id));
    expect(row!.resolvedAt).not.toBeNull();
  });

  it("is a no-op on a report that was never resolved", async () => {
    const a = await call(reportPost, { postId, reason: "spam" }, asUser("alice"));

    const result = await call(reopenReport, { reportId: a!.id, kind: "post" }, asUser("staff"));

    expect(result.reopened).toBe(false);
    expect(result.message).toMatch(/already open/i);
  });

  it("is staff-only", async () => {
    const a = await call(reportPost, { postId, reason: "spam" }, asUser("alice"));
    await call(resolvePostReport, { reportId: a!.id, action: "dismiss" }, asUser("staff"));

    await expect(
      call(reopenReport, { reportId: a!.id, kind: "post" }, asUser("alice")),
    ).rejects.toThrow();
  });
});
