import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  developerProfiles,
  moderationActions,
  moderationProposals,
  notifications,
  teamMembers,
  teams,
  user,
} from "@/db/schema";
import {
  approveModerationProposal,
  listModerationProposals,
  proposeModerationEdit,
  rejectModerationProposal,
} from "@/orpc/router/admin";
import { staffUpdateProfile } from "@/orpc/router/profile";
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
 * Plan 23 phase 4: the propose → approve pipeline. Payloads validate against
 * the same schemas the direct procedures use, drafts supersede atomically,
 * approvals are compare-and-set and apply through the shared helpers, and
 * targets that vanish or outrank the mod are refused rather than half-done.
 */

let db: TestDb;
let teamId: string;

beforeEach(async () => {
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
  await db.delete(notifications);
  await db.delete(moderationActions);
  await db.delete(moderationProposals);
  await db.delete(teams);
  await db.delete(developerProfiles);
  await db.delete(user);

  await seedUser(db, "owner");
  await seedUser(db, "target", { bio: "original bio" });
  await seedUser(db, "rando");
  await seedUser(db, "mod", { guildRoles: ["Moderator"] });
  await seedUser(db, "admin", { guildRoles: ["Admin"] });
  await seedUser(db, "admin2", { guildRoles: ["Admin"] });

  const [team] = await db
    .insert(teams)
    .values({ slug: "alpha", name: "Alpha Team", createdBy: "owner" })
    .returning();
  teamId = team!.id;
  await db.insert(teamMembers).values({ teamId, userId: "owner", role: "owner" });
});

function proposeRename(name = "Renamed Team", reason = "impersonates a studio") {
  return call(
    proposeModerationEdit,
    { action: "team_update", targetId: teamId, payload: { name }, reason },
    asUser("mod"),
  );
}

describe("proposeModerationEdit", () => {
  it("is staff-only", async () => {
    await expect(
      call(
        proposeModerationEdit,
        { action: "team_update", targetId: teamId, payload: { name: "x" }, reason: "r" },
        asUser("rando"),
      ),
    ).rejects.toThrow(/Staff access required/);
  });

  it("validates the payload against the real schema", async () => {
    await expect(
      call(
        proposeModerationEdit,
        { action: "team_update", targetId: teamId, payload: { name: 123 }, reason: "bad" },
        asUser("mod"),
      ),
    ).rejects.toThrow(/Invalid proposal payload/);
    expect(await db.select().from(moderationProposals)).toHaveLength(0);
  });

  it("snapshots the touched fields at propose time", async () => {
    const proposal = await proposeRename();
    expect(proposal.snapshot).toEqual({ name: "Alpha Team" });
    expect(proposal.status).toBe("pending");
    expect(proposal.proposedById).toBe("mod");
  });

  it("supersedes the previous pending proposal for the same (target, action)", async () => {
    const first = await proposeRename("Draft One");
    const second = await proposeRename("Draft Two");

    const rows = await db.select().from(moderationProposals);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === first.id)!.status).toBe("superseded");
    expect(rows.find((r) => r.id === second.id)!.status).toBe("pending");
    expect(rows.filter((r) => r.status === "pending")).toHaveLength(1);

    const pending = await call(listModerationProposals, { status: "pending" }, asUser("mod"));
    expect(pending.items.map((p) => p.id)).toEqual([second.id]);
  });

  it("refuses a proposal against an admin's profile", async () => {
    await expect(
      call(
        proposeModerationEdit,
        { action: "profile_update", targetId: "admin2", payload: { bio: "clean" }, reason: "r" },
        asUser("mod"),
      ),
    ).rejects.toThrow(/Admins' profiles can't be moderated/);
  });

  it("refuses a proposal against the proposer's own profile", async () => {
    await expect(
      call(
        proposeModerationEdit,
        { action: "profile_update", targetId: "mod", payload: { bio: "clean" }, reason: "r" },
        asUser("mod"),
      ),
    ).rejects.toThrow(/Edit your own profile directly/);
  });
});

describe("approveModerationProposal", () => {
  it("applies through the shared helper, stamps appliedPrevious, audits twice, and notifies with the proposal's reason", async () => {
    const proposal = await proposeRename("Renamed Team", "impersonates a studio");

    const result = await call(
      approveModerationProposal,
      { proposalId: proposal.id, note: "agreed" },
      asUser("admin"),
    );
    expect(result).toEqual({ success: true, applied: true });

    // The patch actually landed on the team row.
    const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
    expect(team!.name).toBe("Renamed Team");

    const [row] = await db
      .select()
      .from(moderationProposals)
      .where(eq(moderationProposals.id, proposal.id));
    expect(row!.status).toBe("approved");
    expect(row!.reviewedById).toBe("admin");
    expect(row!.reviewNote).toBe("agreed");
    expect(row!.appliedPrevious).toEqual({ name: "Alpha Team" });

    // One decision, two rows: the ruling and the effect.
    const ruling = await db
      .select()
      .from(moderationActions)
      .where(eq(moderationActions.action, "moderation_proposal_approved"));
    expect(ruling).toHaveLength(1);
    expect(ruling[0]!.metadata).toMatchObject({
      action: "team_update",
      appliedPrevious: { name: "Alpha Team" },
    });
    const effect = await db
      .select()
      .from(moderationActions)
      .where(eq(moderationActions.action, "team_updated"));
    expect(effect).toHaveLength(1);
    expect(effect[0]!.actorId).toBe("admin");

    // The subject hears the proposal's reason, not the admin's note.
    const notices = await db
      .select({ type: notifications.type, data: notifications.data })
      .from(notifications)
      .where(eq(notifications.userId, "owner"));
    expect(notices.map((n) => n.type)).toEqual(["team_updated_by_staff"]);
    expect((notices[0]!.data as Record<string, unknown>).reason).toBe("impersonates a studio");
  });

  it("is compare-and-set: the loser of an approve/approve or approve/reject race gets NOT_FOUND", async () => {
    const proposal = await proposeRename();
    await call(approveModerationProposal, { proposalId: proposal.id }, asUser("admin"));

    await expect(
      call(approveModerationProposal, { proposalId: proposal.id }, asUser("admin2")),
    ).rejects.toThrow(/No pending proposal/);
    await expect(
      call(rejectModerationProposal, { proposalId: proposal.id }, asUser("admin2")),
    ).rejects.toThrow(/No pending proposal/);
  });

  it("is admin-only — the proposing mod cannot approve", async () => {
    const proposal = await proposeRename();
    await expect(
      call(approveModerationProposal, { proposalId: proposal.id }, asUser("mod")),
    ).rejects.toThrow(/Admin access required/);
  });

  it("flips to rejected with 'target gone' when the team vanished before approval", async () => {
    const proposal = await proposeRename();
    await db.delete(teams).where(eq(teams.id, teamId));

    const result = await call(
      approveModerationProposal,
      { proposalId: proposal.id },
      asUser("admin"),
    );

    expect(result.applied).toBe(false);
    const [row] = await db
      .select()
      .from(moderationProposals)
      .where(eq(moderationProposals.id, proposal.id));
    expect(row!.status).toBe("rejected");
    expect(row!.reviewNote).toBe("target gone");
  });
});

describe("rejectModerationProposal", () => {
  it("rejects with a note, audits, and leaves the target untouched", async () => {
    const proposal = await proposeRename();

    await call(
      rejectModerationProposal,
      { proposalId: proposal.id, note: "not warranted" },
      asUser("admin"),
    );

    const [row] = await db
      .select()
      .from(moderationProposals)
      .where(eq(moderationProposals.id, proposal.id));
    expect(row).toMatchObject({
      status: "rejected",
      reviewedById: "admin",
      reviewNote: "not warranted",
    });
    const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
    expect(team!.name).toBe("Alpha Team");

    const logged = await db
      .select()
      .from(moderationActions)
      .where(eq(moderationActions.action, "moderation_proposal_rejected"));
    expect(logged).toHaveLength(1);

    // CAS: a second ruling on the same row finds nothing pending.
    await expect(
      call(rejectModerationProposal, { proposalId: proposal.id }, asUser("admin2")),
    ).rejects.toThrow(/No pending proposal/);
  });
});

describe("staffUpdateProfile (admin direct)", () => {
  it("edits another user's bio, audits the previous value, and notifies them", async () => {
    await call(
      staffUpdateProfile,
      { userId: "target", bio: "cleaned up", reason: "doxxing" },
      asUser("admin"),
    );

    const [profile] = await db
      .select({ bio: developerProfiles.bio })
      .from(developerProfiles)
      .where(eq(developerProfiles.id, "target"));
    expect(profile!.bio).toBe("cleaned up");

    const [logged] = await db
      .select()
      .from(moderationActions)
      .where(eq(moderationActions.action, "profile_updated"));
    expect(logged!.subjectUserId).toBe("target");
    expect(logged!.metadata).toMatchObject({ fields: ["bio"], previous: { bio: "original bio" } });

    const notices = await db
      .select({ type: notifications.type, data: notifications.data })
      .from(notifications)
      .where(eq(notifications.userId, "target"));
    expect(notices.map((n) => n.type)).toEqual(["profile_updated_by_staff"]);
    expect(notices[0]!.data).toMatchObject({ fields: ["bio"], reason: "doxxing" });
  });

  it("refuses an admin target, and refuses mods entirely", async () => {
    await expect(
      call(staffUpdateProfile, { userId: "admin2", bio: "x" }, asUser("admin")),
    ).rejects.toThrow(/Admins' profiles can't be moderated/);
    await expect(
      call(staffUpdateProfile, { userId: "target", bio: "x" }, asUser("mod")),
    ).rejects.toThrow(/Admin access required/);
  });
});
