import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  collabPosts,
  developerProfiles,
  moderationActions,
  notifications,
  teamInvites,
  teamMembers,
  teams,
  user,
} from "@/db/schema";
import {
  deleteTeam,
  getTeam,
  getTeamForInsider,
  getTeamStats,
  inviteToTeam,
  leaveTeam,
  listMyTeams,
  listTeams,
  listUserTeams,
  respondToInvite,
  setTeamArchived,
  setTeamHidden,
  updateTeam,
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

/**
 * Plan 23 phase 2: the hide visibility matrix. Hidden means gone from every
 * public read, flagged for the team's own members, reachable by insiders,
 * frozen for its owner — and fully reversible, restoring whichever status
 * the team was in.
 */

let db: TestDb;
let teamId: string;

async function hide(reason = "under investigation") {
  return call(setTeamHidden, { teamId, hidden: true, reason }, asUser("staff"));
}

beforeEach(async () => {
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
  await db.delete(notifications);
  await db.delete(moderationActions);
  await db.delete(collabPosts);
  await db.delete(teams);
  await db.delete(developerProfiles);
  await db.delete(user);

  await seedUser(db, "owner");
  await seedUser(db, "member1");
  await seedUser(db, "outsider");
  await seedUser(db, "invitee");
  await seedUser(db, "staff", { guildRoles: ["Staff"] });

  const [team] = await db
    .insert(teams)
    .values({ slug: "alpha", name: "Alpha Team", recruiting: true, createdBy: "owner" })
    .returning();
  teamId = team!.id;
  await db.insert(teamMembers).values([
    { teamId, userId: "owner", role: "owner" },
    { teamId, userId: "member1", role: "member" },
  ]);
});

describe("setTeamHidden", () => {
  it("requires a reason when hiding", async () => {
    await expect(call(setTeamHidden, { teamId, hidden: true }, asUser("staff"))).rejects.toThrow(
      /reason is required/i,
    );
  });

  it("is staff-only", async () => {
    await expect(
      call(setTeamHidden, { teamId, hidden: true, reason: "x" }, asUser("owner")),
    ).rejects.toThrow(/Staff access required/);
  });

  it("double-hide no-ops: changed false, one audit row, one owner notice", async () => {
    const first = await hide();
    expect(first.changed).toBe(true);
    const second = await hide("still investigating");
    expect(second.changed).toBe(false);

    const logged = await db
      .select()
      .from(moderationActions)
      .where(eq(moderationActions.action, "team_hidden"));
    expect(logged).toHaveLength(1);

    const rows = await db
      .select({ type: notifications.type, data: notifications.data })
      .from(notifications)
      .where(eq(notifications.userId, "owner"));
    expect(rows.map((r) => r.type)).toEqual(["team_hidden_by_staff"]);
    expect((rows[0]!.data as Record<string, unknown>).reason).toBe("under investigation");
  });

  it("unhide restores an active team to active", async () => {
    await hide();
    await call(setTeamHidden, { teamId, hidden: false }, asUser("staff"));

    const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
    expect(team!.hiddenAt).toBeNull();
    expect(team!.hiddenReason).toBeNull();
    expect(team!.status).toBe("active");
  });

  it("unhide restores an archived team to archived, not active", async () => {
    await call(setTeamArchived, { teamId, archived: true }, asUser("owner"));
    await hide();
    await call(setTeamHidden, { teamId, hidden: false }, asUser("staff"));

    const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
    expect(team!.hiddenAt).toBeNull();
    expect(team!.status).toBe("archived");
  });
});

describe("hidden team visibility", () => {
  it("drops out of getTeam, listTeams, getTeamStats and listUserTeams", async () => {
    // Baseline: visible everywhere first, so the exclusion is the hide's doing.
    expect(await call(getTeam, { teamId }, asUser(null))).not.toBeNull();
    expect((await call(listTeams, {}, asUser(null))).teams.map((t) => t.id)).toEqual([teamId]);
    expect(await call(getTeamStats, {}, asUser(null))).toEqual({ active: 1, recruiting: 1 });
    expect(await call(listUserTeams, { userId: "owner" }, asUser(null))).toHaveLength(1);

    await hide();

    expect(await call(getTeam, { teamId }, asUser(null))).toBeNull();
    const listed = await call(listTeams, {}, asUser(null));
    expect(listed.teams).toHaveLength(0);
    expect(listed.total).toBe(0);
    expect(await call(getTeamStats, {}, asUser(null))).toEqual({ active: 0, recruiting: 0 });
    expect(await call(listUserTeams, { userId: "owner" }, asUser(null))).toHaveLength(0);
  });

  it("stays on listMyTeams for a member, flagged hidden", async () => {
    await hide();

    const mine = await call(listMyTeams, {}, asUser("member1"));
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ id: teamId, hidden: true });
  });

  it("getTeamForInsider serves a member and staff, but not a third account", async () => {
    await hide();

    const asMember = await call(getTeamForInsider, { teamId }, asUser("member1"));
    expect(asMember).toMatchObject({ id: teamId, viewerIsMember: true });
    const asStaff = await call(getTeamForInsider, { teamId }, asUser("staff"));
    expect(asStaff).toMatchObject({ id: teamId, viewerIsMember: false });
    expect(await call(getTeamForInsider, { teamId }, asUser("outsider"))).toBeNull();
  });
});

describe("frozen while hidden", () => {
  it("refuses the owner's updateTeam and deleteTeam with the review message", async () => {
    await hide();

    await expect(call(updateTeam, { teamId, name: "Scrubbed" }, asUser("owner"))).rejects.toThrow(
      "This team is under review.",
    );
    await expect(call(deleteTeam, { teamId }, asUser("owner"))).rejects.toThrow(
      "This team is under review.",
    );
    const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
    expect(team!.name).toBe("Alpha Team");
  });

  it("never traps a member: leaveTeam still works", async () => {
    await hide();

    await call(leaveTeam, { teamId }, asUser("member1"));
    expect(
      await db.select().from(teamMembers).where(eq(teamMembers.userId, "member1")),
    ).toHaveLength(0);
  });

  it("refuses accepting an invite while hidden; declining still works", async () => {
    const invite = await call(inviteToTeam, { teamId, inviteeId: "invitee" }, asUser("owner"));
    await hide();

    await expect(
      call(respondToInvite, { inviteId: invite.id, accept: true }, asUser("invitee")),
    ).rejects.toThrow(/unavailable right now/);
    // The refusal settled nothing: the invite is still pending and can be declined.
    const declined = await call(
      respondToInvite,
      { inviteId: invite.id, accept: false },
      asUser("invitee"),
    );
    expect(declined.status).toBe("declined");
    const [row] = await db.select().from(teamInvites).where(eq(teamInvites.id, invite.id));
    expect(row!.status).toBe("declined");
  });

  it("last member leaving a hidden team archives it without closing its posts", async () => {
    await db.delete(teamMembers).where(eq(teamMembers.userId, "member1"));
    const postId = await seedCollabPost(db, "owner", { teamId, status: "recruiting" });
    await hide();

    await call(leaveTeam, { teamId }, asUser("owner"));

    const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
    expect(team!.status).toBe("archived");
    // `party_full` is a one-way door the unhide couldn't reopen, so the
    // hidden path deliberately leaves recruiting posts alone.
    const [post] = await db.select().from(collabPosts).where(eq(collabPosts.id, postId));
    expect(post!.status).toBe("recruiting");
  });
});
