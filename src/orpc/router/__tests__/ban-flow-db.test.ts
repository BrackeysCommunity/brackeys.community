import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { developerProfiles, moderationActions, user } from "@/db/schema";
import { applyGuildBanOnSignIn, GUILD_BAN_REASON } from "@/lib/guild-ban-gate";
import {
  banUser,
  getBanStatus,
  listBans,
  listModerationActions,
  searchMembers,
  unbanUser,
} from "@/orpc/router/admin";
import { getMyProfile } from "@/orpc/router/profile";
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
const guildBanned = vi.hoisted(() => ({ value: false }));
vi.mock("@/lib/discord", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/discord")>()),
  isGuildMember: async () => true,
  isGuildBanned: async () => guildBanned.value,
  purgeGuildBanCache: async () => {},
}));
vi.mock("@/lib/guild-sync", () => ({
  refreshGuildRolesThrottled: async () => {},
  syncDiscordProfile: async () => ({ guildRolesSynced: false }),
}));
vi.mock("@/lib/staff-roles", async (importOriginal) => importOriginal());

/**
 * End-to-end ban flow against a real database: durations, history, what the
 * banned person is told, and the moderation log.
 */

let db: TestDb;

beforeEach(async () => {
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
  guildBanned.value = false;
  await db.delete(moderationActions);
  await db.delete(developerProfiles);
  await db.delete(user);

  await seedUser(db, "admin", { guildRoles: ["Admin"] });
  await seedUser(db, "staff", { guildRoles: ["Staff"] });
  await seedUser(db, "member", { guildNickname: "Loud Member" });
});

async function banFields(userId: string) {
  const [row] = await db
    .select({
      bannedAt: user.bannedAt,
      bannedUntil: user.bannedUntil,
      unbannedAt: user.unbannedAt,
      banReason: user.banReason,
      bannedById: user.bannedById,
    })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  return row!;
}

describe("ban durations", () => {
  it("stamps an end date from the chosen length, and none for a permanent ban", async () => {
    await call(banUser, { userId: "member", reason: "spam", durationDays: 7 }, asUser("admin"));

    const row = await banFields("member");
    expect(row.bannedAt).not.toBeNull();
    const days = (row.bannedUntil!.getTime() - row.bannedAt!.getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(7);

    await call(unbanUser, { userId: "member" }, asUser("admin"));
    await call(banUser, { userId: "member", reason: "again", durationDays: null }, asUser("admin"));
    expect((await banFields("member")).bannedUntil).toBeNull();
  });

  it("lets an expired ban lapse without anyone acting", async () => {
    await call(banUser, { userId: "member", reason: "cool off", durationDays: 1 }, asUser("admin"));
    await expect(call(getMyProfile, {}, asUser("member"))).rejects.toThrow();

    await db
      .update(user)
      .set({ bannedUntil: new Date(Date.now() - 1000) })
      .where(eq(user.id, "member"));

    expect((await call(getBanStatus, undefined, asUser("member"))).banned).toBe(false);
    await expect(call(getMyProfile, {}, asUser("member"))).resolves.toBeTruthy();
    const [entry] = await call(listBans, undefined, asUser("staff"));
    expect(entry?.isActive).toBe(false);
    expect(entry?.banReason).toBe("cool off");
  });

  it("refuses a second ban while one is in force, and allows one after it is lifted", async () => {
    await call(banUser, { userId: "member", reason: "spam", durationDays: null }, asUser("admin"));
    await expect(
      call(banUser, { userId: "member", reason: "spam", durationDays: null }, asUser("admin")),
    ).rejects.toThrow(/already banned/i);

    await call(unbanUser, { userId: "member" }, asUser("admin"));
    await expect(
      call(banUser, { userId: "member", reason: "again", durationDays: null }, asUser("admin")),
    ).resolves.toMatchObject({ success: true });
  });
});

describe("unban keeps the record", () => {
  it("stamps unbannedAt and leaves the reason behind it", async () => {
    await call(
      banUser,
      { userId: "member", reason: "harassment", durationDays: 30 },
      asUser("admin"),
    );
    await call(unbanUser, { userId: "member" }, asUser("admin"));

    const row = await banFields("member");
    expect(row.unbannedAt).not.toBeNull();
    expect(row.bannedAt).not.toBeNull();
    expect(row.banReason).toBe("harassment");

    const entries = await call(listBans, undefined, asUser("staff"));
    expect(entries).toHaveLength(1);
    expect(entries[0]?.isActive).toBe(false);
    await expect(call(getMyProfile, {}, asUser("member"))).resolves.toBeTruthy();
  });

  it("refuses to unban somebody whose ban is already over", async () => {
    await expect(call(unbanUser, { userId: "member" }, asUser("admin"))).rejects.toThrow(
      /isn't banned/i,
    );
  });
});

describe("getBanStatus", () => {
  it("tells a banned session what happened, and everyone else nothing", async () => {
    await call(banUser, { userId: "member", reason: "spam", durationDays: 3 }, asUser("admin"));

    const status = await call(getBanStatus, undefined, asUser("member"));
    expect(status).toMatchObject({ banned: true, reason: "spam" });
    expect(status.banned && status.until).not.toBeNull();

    expect(await call(getBanStatus, undefined, asUser("staff"))).toEqual({ banned: false });
    expect(await call(getBanStatus, undefined, asUser(null))).toEqual({ banned: false });
  });
});

describe("searchMembers", () => {
  it("is staff-only", async () => {
    await expect(call(searchMembers, { search: "member" }, asUser("member"))).rejects.toThrow(
      /staff/i,
    );
  });

  it("matches the name people can see, and the id they can copy", async () => {
    const byNickname = await call(searchMembers, { search: "Loud" }, asUser("staff"));
    expect(byNickname.results.map((r) => r.id)).toEqual(["member"]);
    expect(byNickname.results[0]?.displayName).toBe("Loud Member");

    const byId = await call(searchMembers, { search: "member" }, asUser("staff"));
    expect(byId.results.map((r) => r.id)).toContain("member");

    const byDiscordId = await call(searchMembers, { search: "discord-member" }, asUser("staff"));
    expect(byDiscordId.results.map((r) => r.id)).toEqual(["member"]);
  });

  it("carries the ban state the picker confirms against", async () => {
    await call(banUser, { userId: "member", reason: "spam", durationDays: 1 }, asUser("admin"));
    const banned = await call(searchMembers, { search: "Loud" }, asUser("staff"));
    expect(banned.results[0]).toMatchObject({ isBanned: true, wasBanned: true });

    await call(unbanUser, { userId: "member" }, asUser("admin"));
    const lifted = await call(searchMembers, { search: "Loud" }, asUser("staff"));
    expect(lifted.results[0]).toMatchObject({ isBanned: false, wasBanned: true });
  });
});

describe("the Discord guild-ban gate", () => {
  it("applies the app's own ban when Discord says they are banned there", async () => {
    guildBanned.value = true;
    expect(await applyGuildBanOnSignIn("member")).toBe(true);

    const row = await banFields("member");
    expect(row.banReason).toBe(GUILD_BAN_REASON);
    expect(row.bannedById).toBeNull();
    expect(row.bannedUntil).toBeNull();

    const [logged] = await db
      .select({ actorId: moderationActions.actorId, metadata: moderationActions.metadata })
      .from(moderationActions)
      .where(eq(moderationActions.action, "user_banned"));
    expect(logged?.actorId).toBeNull();
    expect((logged!.metadata as Record<string, unknown>).source).toBe("discord_guild_ban");
  });

  it("does nothing when Discord doesn't know, and never touches an existing ban", async () => {
    expect(await applyGuildBanOnSignIn("member")).toBe(false);
    expect((await banFields("member")).bannedAt).toBeNull();

    await call(banUser, { userId: "member", reason: "spam", durationDays: 7 }, asUser("admin"));
    const before = await banFields("member");
    guildBanned.value = true;
    expect(await applyGuildBanOnSignIn("member")).toBe(false);
    // The gate does not re-stamp a duration staff chose.
    expect((await banFields("member")).bannedUntil).toEqual(before.bannedUntil);
  });
});

describe("the moderation log is readable", () => {
  it("returns what happened, to whom, and by whom — newest first", async () => {
    await call(banUser, { userId: "member", reason: "spam", durationDays: 1 }, asUser("admin"));
    await call(unbanUser, { userId: "member" }, asUser("admin"));

    const log = await call(listModerationActions, {}, asUser("staff"));
    expect(log.total).toBe(2);
    expect(log.actions[0]?.action).toBe("user_unbanned");
    expect(log.actions[0]?.actor?.id).toBe("admin");
    expect(log.actions[0]?.subject?.id).toBe("member");

    const bansOnly = await call(listModerationActions, { action: "user_banned" }, asUser("staff"));
    expect(bansOnly.total).toBe(1);
    expect(bansOnly.actions[0]?.reason).toBe("spam");

    const bySubject = await call(
      listModerationActions,
      { subjectUserId: "staff" },
      asUser("staff"),
    );
    expect(bySubject.total).toBe(0);
  });

  it("is staff-only", async () => {
    await expect(call(listModerationActions, {}, asUser("member"))).rejects.toThrow(/staff/i);
  });
});
