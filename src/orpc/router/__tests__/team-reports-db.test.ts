import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  collabPostReports,
  collabPosts,
  commentReports,
  developerProfiles,
  moderationActions,
  notifications,
  teamMembers,
  teamReports,
  teams,
  threads,
  user,
} from "@/db/schema";
import { reopenReport } from "@/orpc/router/admin";
import { reportPost } from "@/orpc/router/collab";
import { createComment, reportComment } from "@/orpc/router/comments";
import {
  deleteTeam,
  listTeamReports,
  reportTeam,
  resolveTeamReport,
  setTeamHidden,
} from "@/orpc/router/team";
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
// In-memory stand-in for the Redis fixed-window counter, so the shared
// "report" bucket is actually enforced in tests (the real module degrades
// open without REDIS_URL).
vi.mock("@/lib/rate-limit", async () => {
  const { ORPCError } = await import("@orpc/client");
  const counters = new Map<string, number>();
  const bump = (bucket: string, userId: string) => {
    const key = `${bucket}:${userId}`;
    const next = (counters.get(key) ?? 0) + 1;
    counters.set(key, next);
    return next;
  };
  return {
    checkRateLimit: async (bucket: string, userId: string, limit: number) =>
      bump(bucket, userId) <= limit,
    assertRateLimit: async (bucket: string, userId: string, limit: number, message: string) => {
      if (bump(bucket, userId) > limit) {
        throw new ORPCError("TOO_MANY_REQUESTS", { message });
      }
    },
    __resetRateLimits: () => counters.clear(),
  };
});

/**
 * Plan 23 phase 3: the team report loop. Dedupe per (team, reporter), one
 * shared abuse-report budget across all three surfaces, resolve semantics
 * that mirror `resolvePostReport`, and reports that survive the subject's
 * hard delete as orphans.
 */

let db: TestDb;
let teamId: string;

beforeEach(async () => {
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
  const rateLimit = (await import("@/lib/rate-limit")) as unknown as {
    __resetRateLimits: () => void;
  };
  rateLimit.__resetRateLimits();
  await db.delete(notifications);
  await db.delete(moderationActions);
  await db.delete(teamReports);
  await db.delete(commentReports);
  await db.delete(collabPostReports);
  await db.delete(threads);
  await db.delete(collabPosts);
  await db.delete(teams);
  await db.delete(developerProfiles);
  await db.delete(user);

  await seedUser(db, "owner");
  await seedUser(db, "rita");
  await seedUser(db, "bob");
  await seedUser(db, "staff", { guildRoles: ["Staff"] });

  const [team] = await db
    .insert(teams)
    .values({ slug: "alpha", name: "Alpha Team", createdBy: "owner" })
    .returning();
  teamId = team!.id;
  await db.insert(teamMembers).values({ teamId, userId: "owner", role: "owner" });
});

async function noticesFor(userId: string) {
  return db
    .select({ type: notifications.type, data: notifications.data })
    .from(notifications)
    .where(eq(notifications.userId, userId));
}

describe("reportTeam", () => {
  it("dedupes per (team, reporter) while a report is open", async () => {
    await call(reportTeam, { teamId, reason: "scam" }, asUser("rita"));
    await expect(
      call(reportTeam, { teamId, reason: "scam again" }, asUser("rita")),
    ).rejects.toThrow(/already reported this team/);
    // A different reporter is not deduped.
    await call(reportTeam, { teamId, reason: "also scam" }, asUser("bob"));
    expect(await db.select().from(teamReports)).toHaveLength(2);
  });

  it("shares the abuse-report budget across posts, comments and teams", async () => {
    const postIds = [];
    for (let i = 0; i < 8; i++) postIds.push(await seedCollabPost(db, "owner"));
    const comment = await call(
      createComment,
      { subject: { type: "collab_post", id: postIds[0]! }, content: "gross" },
      asUser("owner"),
    );
    const [teamB] = await db
      .insert(teams)
      .values({ slug: "beta", name: "Beta Team", createdBy: "owner" })
      .returning();

    // 8 post reports + 1 comment report + 1 team report = the whole 10/hr.
    for (const postId of postIds) {
      await call(reportPost, { postId, reason: "spam" }, asUser("rita"));
    }
    await call(reportComment, { commentId: comment.id, reason: "spam" }, asUser("rita"));
    await call(reportTeam, { teamId, reason: "spam" }, asUser("rita"));

    // The 11th report — a fresh subject on a third surface — hits the cap.
    await expect(
      call(reportTeam, { teamId: teamB!.id, reason: "spam" }, asUser("rita")),
    ).rejects.toThrow(/Too many reports/);
    // Someone else's budget is untouched.
    await call(reportTeam, { teamId: teamB!.id, reason: "spam" }, asUser("bob"));
  });

  it("404s on a hidden team, same as the page", async () => {
    await call(setTeamHidden, { teamId, hidden: true, reason: "review" }, asUser("staff"));
    await expect(call(reportTeam, { teamId, reason: "scam" }, asUser("rita"))).rejects.toThrow(
      /Team not found/,
    );
  });
});

describe("resolveTeamReport", () => {
  it("hide_team hides the team, resolves every sibling, and tells reporters it was actioned", async () => {
    const report = await call(reportTeam, { teamId, reason: "scam" }, asUser("rita"));
    await call(reportTeam, { teamId, reason: "also scam" }, asUser("bob"));

    await call(
      resolveTeamReport,
      { reportId: report.id, action: "hide_team", reason: "confirmed" },
      asUser("staff"),
    );

    const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
    expect(team!.hiddenAt).not.toBeNull();
    const rows = await db.select().from(teamReports);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.resolvedAt != null)).toBe(true);

    for (const reporter of ["rita", "bob"]) {
      const notices = (await noticesFor(reporter)).filter((n) => n.type === "report_resolved");
      expect(notices, reporter).toHaveLength(1);
      expect((notices[0]!.data as Record<string, unknown>).outcome).toBe("actioned");
    }
  });

  it("just closes the report when the team is already hidden — no second hide audit", async () => {
    const report = await call(reportTeam, { teamId, reason: "scam" }, asUser("rita"));
    await call(reportTeam, { teamId, reason: "also scam" }, asUser("bob"));
    // Staff hid mid-investigation; the reports stay open until the ruling.
    await call(setTeamHidden, { teamId, hidden: true, reason: "review" }, asUser("staff"));

    await call(resolveTeamReport, { reportId: report.id, action: "hide_team" }, asUser("staff"));

    const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
    expect(team!.hiddenAt).not.toBeNull();
    expect((await db.select().from(teamReports)).every((r) => r.resolvedAt != null)).toBe(true);
    // The one team-targeted hide row is the setTeamHidden call's; the no-op
    // transition inside the resolve logged nothing new.
    const hides = await db
      .select()
      .from(moderationActions)
      .where(eq(moderationActions.action, "team_hidden"));
    expect(hides.filter((row) => row.targetType === "team")).toHaveLength(1);
  });

  it("dismiss resolves siblings against the clicked report and says no action was taken", async () => {
    const report = await call(reportTeam, { teamId, reason: "scam" }, asUser("rita"));
    await call(reportTeam, { teamId, reason: "also scam" }, asUser("bob"));

    await call(resolveTeamReport, { reportId: report.id, action: "dismiss" }, asUser("staff"));

    const dismissed = await db
      .select()
      .from(moderationActions)
      .where(eq(moderationActions.action, "team_report_dismissed"));
    expect(dismissed).toHaveLength(2);
    const sibling = dismissed.find(
      (row) => (row.metadata as Record<string, unknown>).resolvedVia != null,
    );
    expect(sibling).toBeDefined();
    expect((sibling!.metadata as Record<string, unknown>).resolvedVia).toBe(report.id);

    for (const reporter of ["rita", "bob"]) {
      const notices = (await noticesFor(reporter)).filter((n) => n.type === "report_resolved");
      expect((notices[0]!.data as Record<string, unknown>).outcome).toBe("no_action");
    }
    // Left up, so the team stays visible.
    const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
    expect(team!.hiddenAt).toBeNull();
  });

  it("survives the owner hard-deleting the team: the report orphans with its snapshot", async () => {
    const report = await call(reportTeam, { teamId, reason: "scam" }, asUser("rita"));

    await call(deleteTeam, { teamId }, asUser("owner"));

    const [row] = await db.select().from(teamReports).where(eq(teamReports.id, report.id));
    expect(row!.teamId).toBeNull();
    expect(row!.teamName).toBe("Alpha Team");
    expect(row!.resolvedAt).toBeNull();

    // The queue still renders it, live columns empty — the "TEAM DELETED" cue.
    const queue = await call(listTeamReports, { includeResolved: false }, asUser("staff"));
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ id: report.id, teamName: "Alpha Team", liveName: null });
  });
});

describe("reopenReport kind team", () => {
  it("puts a dismissed team report back in the queue", async () => {
    const report = await call(reportTeam, { teamId, reason: "scam" }, asUser("rita"));
    await call(resolveTeamReport, { reportId: report.id, action: "dismiss" }, asUser("staff"));

    const result = await call(reopenReport, { reportId: report.id, kind: "team" }, asUser("staff"));

    expect(result.reopened).toBe(true);
    const [row] = await db.select().from(teamReports).where(eq(teamReports.id, report.id));
    expect(row!.resolvedAt).toBeNull();
  });

  it("refuses when the same reporter already has a newer open report", async () => {
    const first = await call(reportTeam, { teamId, reason: "scam" }, asUser("rita"));
    await call(resolveTeamReport, { reportId: first.id, action: "dismiss" }, asUser("staff"));
    // Dismiss left the team up, so rita can file again immediately.
    await call(reportTeam, { teamId, reason: "still a scam" }, asUser("rita"));

    const result = await call(reopenReport, { reportId: first.id, kind: "team" }, asUser("staff"));

    expect(result.reopened).toBe(false);
    expect(result.message).toMatch(/newer open report/i);
    const [row] = await db.select().from(teamReports).where(eq(teamReports.id, first.id));
    expect(row!.resolvedAt).not.toBeNull();
  });
});
