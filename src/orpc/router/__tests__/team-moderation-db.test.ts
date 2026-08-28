import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  developerProfiles,
  moderationActions,
  notifications,
  teamMembers,
  teamProjects,
  teams,
  user,
  type ModerationActionType,
} from "@/db/schema";
import {
  clearTeamImage,
  deleteTeam,
  inviteToTeam,
  removeMember,
  removeTeamProject,
  setTeamSlug,
  transferOwnership,
  updateMemberTitle,
  updateTeam,
  updateTeamProject,
} from "@/orpc/router/team";
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

/**
 * Plan 23 gate matrix: every widened team procedure keeps its owner path
 * byte-identical (same refusals, no audit) while admitting staff exactly
 * where `MOD_POWERS` says so — and every override leaves an audit row with
 * the before-values plus an owner-facing notice.
 */

let db: TestDb;
let teamId: string;
let member1RowId: number;
let projectId: string;

beforeEach(async () => {
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
  await db.delete(notifications);
  await db.delete(moderationActions);
  await db.delete(teams);
  await db.delete(developerProfiles);
  await db.delete(user);

  await seedUser(db, "owner");
  await seedUser(db, "member1");
  await seedUser(db, "member2");
  await seedUser(db, "rando");
  await seedUser(db, "invitee");
  await seedUser(db, "mod", { guildRoles: ["Moderator"] });
  await seedUser(db, "admin", { guildRoles: ["Admin"] });

  const [team] = await db
    .insert(teams)
    .values({
      slug: "alpha",
      name: "Alpha Team",
      tagline: "we jam",
      avatarUrl: "https://cdn.example/alpha.png",
      createdBy: "owner",
    })
    .returning();
  teamId = team!.id;
  const memberRows = await db
    .insert(teamMembers)
    .values([
      { teamId, userId: "owner", role: "owner" },
      { teamId, userId: "member1", role: "member", title: "Artist" },
      { teamId, userId: "member2", role: "member" },
    ])
    .returning({ id: teamMembers.id, userId: teamMembers.userId });
  member1RowId = memberRows.find((r) => r.userId === "member1")!.id;

  const [project] = await db
    .insert(teamProjects)
    .values({ teamId, title: "Jam Game", description: "made in 48h", addedBy: "member1" })
    .returning({ id: teamProjects.id });
  projectId = project!.id;
});

/** Every propose-tier procedure, phrased as a call the matrix can replay. */
function proposeTierCalls(): [string, (as: ReturnType<typeof asUser>) => Promise<unknown>][] {
  return [
    ["updateTeam", (as) => call(updateTeam, { teamId, name: "Renamed" }, as)],
    ["setTeamSlug", (as) => call(setTeamSlug, { teamId, slug: "new-handle" }, as)],
    ["clearTeamImage", (as) => call(clearTeamImage, { teamId, kind: "avatar" }, as)],
    ["removeMember", (as) => call(removeMember, { teamId, userId: "member1" }, as)],
    ["transferOwnership", (as) => call(transferOwnership, { teamId, userId: "member1" }, as)],
    [
      "updateMemberTitle",
      (as) => call(updateMemberTitle, { teamId, memberId: member1RowId, title: "Composer" }, as),
    ],
    ["updateTeamProject", (as) => call(updateTeamProject, { teamId, projectId, title: "Neu" }, as)],
    ["removeTeamProject", (as) => call(removeTeamProject, { teamId, projectId }, as)],
  ];
}

async function auditRows(action: ModerationActionType) {
  return db.select().from(moderationActions).where(eq(moderationActions.action, action));
}

async function noticesFor(userId: string) {
  return db
    .select({ type: notifications.type, data: notifications.data })
    .from(notifications)
    .where(eq(notifications.userId, userId));
}

describe("gate matrix — refusals", () => {
  it("refuses a non-member non-staff caller on every widened procedure", async () => {
    for (const [name, run] of proposeTierCalls()) {
      await expect(run(asUser("rando")), name).rejects.toThrow(/not a member of this team/);
    }
    await expect(
      call(inviteToTeam, { teamId, inviteeId: "invitee" }, asUser("rando")),
    ).rejects.toThrow(/not a member of this team/);
    await expect(call(deleteTeam, { teamId, reason: "x" }, asUser("rando"))).rejects.toThrow(
      /not a member of this team/,
    );
  });

  it("refuses a non-admin staffer on every propose-tier procedure, writing nothing", async () => {
    for (const [name, run] of proposeTierCalls()) {
      await expect(run(asUser("mod")), name).rejects.toThrow(/not a member of this team/);
    }
    // The refusals happened before any write: no audit rows, team untouched.
    expect(await db.select().from(moderationActions)).toHaveLength(0);
    const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
    expect(team!.name).toBe("Alpha Team");
    expect(team!.slug).toBe("alpha");
  });

  it("keeps deleteTeam admin-only: staff refused, admin without a reason refused", async () => {
    await expect(call(deleteTeam, { teamId, reason: "spam team" }, asUser("mod"))).rejects.toThrow(
      /not a member of this team/,
    );
    await expect(call(deleteTeam, { teamId }, asUser("admin"))).rejects.toThrow(
      /reason is required/,
    );
    expect(await db.select().from(teams)).toHaveLength(1);
  });
});

describe("updateTeam", () => {
  it("admin override applies, audits the before-values, and notifies the owner", async () => {
    await call(updateTeam, { teamId, name: "Renamed", reason: "impersonation" }, asUser("admin"));

    const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
    expect(team!.name).toBe("Renamed");

    const [logged] = await auditRows("team_updated");
    expect(logged).toBeDefined();
    expect(logged!.actorId).toBe("admin");
    expect(logged!.subjectUserId).toBe("owner");
    expect(logged!.reason).toBe("impersonation");
    const metadata = logged!.metadata as { fields: string[]; previous: Record<string, unknown> };
    expect(metadata.fields).toEqual(["name"]);
    expect(metadata.previous).toEqual({ name: "Alpha Team" });

    const rows = await noticesFor("owner");
    expect(rows.map((r) => r.type)).toEqual(["team_updated_by_staff"]);
    expect((rows[0]!.data as Record<string, unknown>).reason).toBe("impersonation");
  });

  it("owner path applies with no audit row and no staff notice", async () => {
    await call(updateTeam, { teamId, name: "Renamed" }, asUser("owner"));

    const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
    expect(team!.name).toBe("Renamed");
    expect(await db.select().from(moderationActions)).toHaveLength(0);
    expect(await noticesFor("owner")).toHaveLength(0);
  });
});

describe("setTeamSlug", () => {
  it("admin override applies, audits from→to, and notifies the owner", async () => {
    await call(setTeamSlug, { teamId, slug: "beta-crew", reason: "slur" }, asUser("admin"));

    const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
    expect(team!.slug).toBe("beta-crew");
    const [logged] = await auditRows("team_slug_updated");
    expect(logged!.metadata).toMatchObject({ from: "alpha", to: "beta-crew" });
    expect((await noticesFor("owner")).map((r) => r.type)).toEqual(["team_updated_by_staff"]);
  });

  it("owner path applies with no audit row", async () => {
    await call(setTeamSlug, { teamId, slug: "beta-crew" }, asUser("owner"));
    expect(await db.select().from(moderationActions)).toHaveLength(0);
  });
});

describe("clearTeamImage", () => {
  it("admin override nulls the image, audits the previous URL, and notifies the owner", async () => {
    await call(clearTeamImage, { teamId, kind: "avatar", reason: "nsfw" }, asUser("admin"));

    const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
    expect(team!.avatarUrl).toBeNull();
    const [logged] = await auditRows("team_image_cleared");
    expect(logged!.metadata).toMatchObject({
      kind: "avatar",
      previousUrl: "https://cdn.example/alpha.png",
    });
    expect((await noticesFor("owner")).map((r) => r.type)).toEqual(["team_updated_by_staff"]);
  });

  it("owner path clears with no audit row", async () => {
    await call(clearTeamImage, { teamId, kind: "avatar" }, asUser("owner"));
    const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
    expect(team!.avatarUrl).toBeNull();
    expect(await db.select().from(moderationActions)).toHaveLength(0);
  });
});

describe("removeMember", () => {
  it("admin override removes, audits, and tells the member it was staff", async () => {
    await call(removeMember, { teamId, userId: "member1", reason: "ban evasion" }, asUser("admin"));

    expect(
      await db.select().from(teamMembers).where(eq(teamMembers.userId, "member1")),
    ).toHaveLength(0);

    const [logged] = await auditRows("team_member_removed");
    expect(logged!.subjectUserId).toBe("member1");
    expect(logged!.metadata).toMatchObject({ removedUserId: "member1", role: "member" });

    const removed = await noticesFor("member1");
    expect(removed.map((r) => r.type)).toEqual(["team_member_removed"]);
    expect(removed[0]!.data).toMatchObject({ byStaff: true, reason: "ban evasion" });
    // The owner hears too — their roster changed under them.
    expect((await noticesFor("owner")).map((r) => r.type)).toEqual([
      "team_member_removed_by_staff",
    ]);
  });

  it("owner path removes with no audit row and no byStaff flag", async () => {
    await call(removeMember, { teamId, userId: "member2" }, asUser("owner"));

    expect(await db.select().from(moderationActions)).toHaveLength(0);
    const removed = await noticesFor("member2");
    expect(removed.map((r) => r.type)).toEqual(["team_member_removed"]);
    expect((removed[0]!.data as Record<string, unknown>).byStaff).toBeUndefined();
  });

  it("staff override refuses to remove the owner", async () => {
    await expect(
      call(removeMember, { teamId, userId: "owner", reason: "x" }, asUser("admin")),
    ).rejects.toThrow(/Transfer ownership first/);
  });

  it("staff override refuses to remove the last member", async () => {
    const [solo] = await db
      .insert(teams)
      .values({ slug: "solo", name: "Solo Act", createdBy: "member2" })
      .returning();
    await db.insert(teamMembers).values({ teamId: solo!.id, userId: "member2", role: "member" });

    await expect(
      call(removeMember, { teamId: solo!.id, userId: "member2", reason: "x" }, asUser("admin")),
    ).rejects.toThrow(/Hide or delete the team instead/);
  });
});

describe("transferOwnership", () => {
  it("admin override swaps roles, audits, and notifies the previous owner", async () => {
    await call(
      transferOwnership,
      { teamId, userId: "member1", reason: "owner AWOL" },
      asUser("admin"),
    );

    const roster = await db
      .select({ userId: teamMembers.userId, role: teamMembers.role })
      .from(teamMembers)
      .where(eq(teamMembers.teamId, teamId));
    expect(roster.find((m) => m.userId === "member1")!.role).toBe("owner");
    expect(roster.find((m) => m.userId === "owner")!.role).toBe("member");

    const [logged] = await auditRows("team_ownership_transferred");
    expect(logged!.metadata).toMatchObject({ from: "owner", to: "member1" });
    expect((await noticesFor("owner")).map((r) => r.type)).toEqual([
      "team_ownership_transferred_by_staff",
    ]);
  });

  it("owner path transfers with no audit row", async () => {
    await call(transferOwnership, { teamId, userId: "member1" }, asUser("owner"));
    expect(await db.select().from(moderationActions)).toHaveLength(0);
  });
});

describe("updateMemberTitle", () => {
  it("admin override edits another member's title and audits from→to", async () => {
    await call(
      updateMemberTitle,
      { teamId, memberId: member1RowId, title: "Composer", reason: "offensive label" },
      asUser("admin"),
    );

    const [row] = await db.select().from(teamMembers).where(eq(teamMembers.id, member1RowId));
    expect(row!.title).toBe("Composer");
    const [logged] = await auditRows("team_member_title_updated");
    expect(logged!.subjectUserId).toBe("member1");
    expect(logged!.metadata).toMatchObject({ from: "Artist", to: "Composer" });
  });

  it("owner path edits another member's title with no audit row", async () => {
    await call(
      updateMemberTitle,
      { teamId, memberId: member1RowId, title: "Composer" },
      asUser("owner"),
    );
    expect(await db.select().from(moderationActions)).toHaveLength(0);
  });
});

describe("updateTeamProject", () => {
  it("admin override edits, audits the previous values, and notifies the owner", async () => {
    await call(
      updateTeamProject,
      { teamId, projectId, title: "Cleaned Title", reason: "slur in title" },
      asUser("admin"),
    );

    const [row] = await db.select().from(teamProjects).where(eq(teamProjects.id, projectId));
    expect(row!.title).toBe("Cleaned Title");
    const [logged] = await auditRows("team_project_updated");
    expect(logged!.subjectUserId).toBe("member1");
    expect((logged!.metadata as { previous: Record<string, unknown> }).previous).toMatchObject({
      title: "Jam Game",
      description: "made in 48h",
    });
    expect((await noticesFor("owner")).map((r) => r.type)).toEqual(["team_updated_by_staff"]);
  });

  it("owner path edits with no audit row", async () => {
    await call(updateTeamProject, { teamId, projectId, title: "Cleaned" }, asUser("owner"));
    expect(await db.select().from(moderationActions)).toHaveLength(0);
  });
});

describe("removeTeamProject", () => {
  it("admin override removes, audits the title snapshot, and notifies the owner", async () => {
    await call(removeTeamProject, { teamId, projectId, reason: "stolen work" }, asUser("admin"));

    expect(await db.select().from(teamProjects).where(eq(teamProjects.id, projectId))).toHaveLength(
      0,
    );
    const [logged] = await auditRows("team_project_removed");
    expect(logged!.metadata).toMatchObject({ projectTitle: "Jam Game" });
    expect((await noticesFor("owner")).map((r) => r.type)).toEqual(["team_updated_by_staff"]);
  });

  it("owner path removes with no audit row", async () => {
    await call(removeTeamProject, { teamId, projectId }, asUser("owner"));
    expect(await db.select().from(moderationActions)).toHaveLength(0);
  });
});

describe("inviteToTeam (direct tier)", () => {
  it("lets a non-admin staffer invite on behalf of the team, with an audit row", async () => {
    const invite = await call(
      inviteToTeam,
      { teamId, inviteeId: "invitee", reason: "reuniting the crew" },
      asUser("mod"),
    );

    expect(invite.invitedBy).toBe("mod");
    const [logged] = await auditRows("team_member_invited");
    expect(logged!.subjectUserId).toBe("invitee");
    expect(logged!.metadata).toMatchObject({ inviteeId: "invitee", inviteId: invite.id });
    // Consent survives: the invitee still gets a normal invite to answer.
    expect((await noticesFor("invitee")).map((r) => r.type)).toEqual(["team_invite_received"]);
  });

  it("keeps the member path unlogged", async () => {
    await call(inviteToTeam, { teamId, inviteeId: "invitee" }, asUser("member1"));
    expect(await db.select().from(moderationActions)).toHaveLength(0);
  });
});

describe("deleteTeam", () => {
  it("admin delete audits the full before-image and notifies the roster", async () => {
    await call(deleteTeam, { teamId, reason: "scam front" }, asUser("admin"));

    expect(await db.select().from(teams)).toHaveLength(0);
    const [logged] = await auditRows("team_deleted");
    expect(logged!.subjectUserId).toBe("owner");
    const metadata = logged!.metadata as {
      team: Record<string, unknown>;
      roster: { userId: string; role: string }[];
    };
    expect(metadata.team).toMatchObject({ name: "Alpha Team", slug: "alpha" });
    expect(metadata.roster.map((m) => m.userId).sort()).toEqual(["member1", "member2", "owner"]);

    for (const member of ["owner", "member1", "member2"]) {
      const rows = await noticesFor(member);
      expect(
        rows.map((r) => r.type),
        member,
      ).toEqual(["team_deleted_by_staff"]);
      expect(rows[0]!.data).toMatchObject({ teamName: "Alpha Team", reason: "scam front" });
    }
  });

  it("owner delete needs no reason and writes no audit row", async () => {
    await call(deleteTeam, { teamId }, asUser("owner"));

    expect(await db.select().from(teams)).toHaveLength(0);
    expect(await db.select().from(moderationActions)).toHaveLength(0);
    expect(await noticesFor("member1")).toHaveLength(0);
  });
});
