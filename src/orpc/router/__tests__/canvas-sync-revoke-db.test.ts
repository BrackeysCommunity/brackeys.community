import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  canvasDocVersions,
  canvases,
  developerProfiles,
  moderationActions,
  notifications,
  teamMembers,
  teams,
  user,
} from "@/db/schema";
import { cleanupUserData } from "@/lib/account-deletion";
import { SYNC_LIMITS } from "@/lib/canvas/limits";
import { banUser } from "@/orpc/router/admin";
import { createCanvas, deleteCanvas, getCanvasSyncToken } from "@/orpc/router/canvas";
import {
  deleteTeam,
  leaveTeam,
  removeMember,
  setTeamArchived,
  setTeamHidden,
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
  purgeGuildMemberCache: async () => {},
}));
vi.mock("@/lib/guild-sync", () => ({
  refreshDiscordProfileThrottled: async () => {},
  syncDiscordProfile: async () => ({ guildRolesSynced: false }),
}));
vi.mock("@/lib/queue", () => ({
  getNotificationsQueue: async () => ({ add: async () => ({}) }),
}));
vi.mock("@/lib/posthog-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/posthog-server")>()),
  isServerFlagEnabled: async () => true,
}));

/**
 * The real publish path down to Redis: only the client is fake, so these
 * pin the channel names and payloads `canvas-sync` subscribes to.
 */
const redis = vi.hoisted(() => ({
  published: [] as { channel: string; message: unknown }[],
  tombstones: new Map<string, { at: number; ttlMs: number }>(),
}));
vi.mock("@/lib/redis", () => ({
  createRedisClient: async () => ({
    status: "ready",
    once() {},
    publish: async (channel: string, raw: string) => {
      redis.published.push({ channel, message: JSON.parse(raw) });
      return 1;
    },
    set: async (key: string, value: string, _px: "PX", ttlMs: number) => {
      redis.tombstones.set(key, { at: Number(value), ttlMs });
      return "OK";
    },
  }),
}));

const REVOKE = "development:canvas-sync:revoke";
const SECRET = "revoke-test-sync-secret";

let db: TestDb;
let teamId: string;
let teamCanvas: string;
let otherTeamCanvas: string;
let deletedTeamCanvas: string;

const revokes = () => redis.published.filter((p) => p.channel === REVOKE).map((p) => p.message);

/** The publishes are fire-and-forget; wait for the expected set to arrive. */
async function expectRevokes(expected: unknown[]) {
  await vi.waitFor(() => expect(revokes()).toEqual(expect.arrayContaining(expected)));
  // And nothing beyond them.
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(revokes()).toHaveLength(expected.length);
}

beforeEach(async () => {
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
  redis.published.length = 0;
  process.env.REDIS_URL = "redis://fake.test:6379";
  delete process.env.RAILWAY_ENVIRONMENT_NAME;
  process.env.CANVAS_SYNC_SECRET = SECRET;
  process.env.CANVAS_SYNC_URL = "wss://sync.test";
  await db.delete(notifications);
  await db.delete(moderationActions);
  await db.delete(canvasDocVersions);
  await db.delete(canvases);
  await db.delete(teams);
  await db.delete(developerProfiles);
  await db.delete(user);
  for (const id of ["owner", "member1", "member2", "outsider"]) await seedUser(db, id);
  await seedUser(db, "staff", { guildRoles: ["Staff"] });
  await seedUser(db, "admin", { guildRoles: ["Admin"] });

  const [team] = await db
    .insert(teams)
    .values({ slug: "crew", name: "Crew", createdBy: "owner" })
    .returning({ id: teams.id });
  teamId = team!.id;
  await db.insert(teamMembers).values([
    { teamId, userId: "owner", role: "owner" },
    { teamId, userId: "member1", role: "member" },
    { teamId, userId: "member2", role: "member" },
  ]);
  const scope = { kind: "team" as const, teamId };
  ({ id: teamCanvas } = await call(createCanvas, { scope, path: "A.canvas" }, asUser("owner")));
  ({ id: otherTeamCanvas } = await call(
    createCanvas,
    { scope, path: "B.canvas" },
    asUser("member1"),
  ));
  ({ id: deletedTeamCanvas } = await call(
    createCanvas,
    { scope, path: "C.canvas" },
    asUser("owner"),
  ));
  await call(deleteCanvas, { canvasId: deletedTeamCanvas }, asUser("owner"));
  redis.published.length = 0;
});

describe("revoke publishes", () => {
  it("canvas delete: everyone on that canvas", async () => {
    await call(deleteCanvas, { canvasId: teamCanvas }, asUser("owner"));
    await expectRevokes([{ canvasId: teamCanvas }]);
  });

  it("member removal: that member on each live team canvas, and their next token is refused", async () => {
    expect(
      (await call(getCanvasSyncToken, { canvasId: teamCanvas }, asUser("member1"))).access,
    ).toBe("write");
    await call(removeMember, { teamId, userId: "member1" }, asUser("owner"));
    await expectRevokes([
      { canvasId: teamCanvas, userId: "member1" },
      { canvasId: otherTeamCanvas, userId: "member1" },
    ]);
    await expect(
      call(getCanvasSyncToken, { canvasId: teamCanvas }, asUser("member1")),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Everyone else keeps writing.
    expect(
      (await call(getCanvasSyncToken, { canvasId: teamCanvas }, asUser("member2"))).access,
    ).toBe("write");
  });

  it("leave: the leaver on each live team canvas, and their next token is refused", async () => {
    await call(leaveTeam, { teamId }, asUser("member2"));
    await expectRevokes([
      { canvasId: teamCanvas, userId: "member2" },
      { canvasId: otherTeamCanvas, userId: "member2" },
    ]);
    await expect(
      call(getCanvasSyncToken, { canvasId: otherTeamCanvas }, asUser("member2")),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("last member leaving archives the team: everyone on each canvas", async () => {
    await db.delete(teamMembers).where(eq(teamMembers.userId, "member1"));
    await db.delete(teamMembers).where(eq(teamMembers.userId, "member2"));
    await call(leaveTeam, { teamId }, asUser("owner"));
    await expectRevokes([{ canvasId: teamCanvas }, { canvasId: otherTeamCanvas }]);
  });

  it("archive: everyone on each canvas, and owners come back read-only", async () => {
    await call(setTeamArchived, { teamId, archived: true }, asUser("owner"));
    await expectRevokes([{ canvasId: teamCanvas }, { canvasId: otherTeamCanvas }]);
    expect((await call(getCanvasSyncToken, { canvasId: teamCanvas }, asUser("owner"))).access).toBe(
      "read",
    );
    redis.published.length = 0;
    await call(setTeamArchived, { teamId, archived: false }, asUser("owner"));
    await expectRevokes([]);
  });

  it("hide: everyone on each canvas; unhide publishes nothing", async () => {
    await call(setTeamHidden, { teamId, hidden: true, reason: "checking" }, asUser("staff"));
    await expectRevokes([{ canvasId: teamCanvas }, { canvasId: otherTeamCanvas }]);
    await expect(
      call(getCanvasSyncToken, { canvasId: teamCanvas }, asUser("member1")),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    redis.published.length = 0;
    await call(setTeamHidden, { teamId, hidden: false }, asUser("staff"));
    await expectRevokes([]);
  });

  it("team delete: everyone on each canvas, read before the cascade", async () => {
    await call(deleteTeam, { teamId }, asUser("owner"));
    await expectRevokes([{ canvasId: teamCanvas }, { canvasId: otherTeamCanvas }]);
    expect(await db.select().from(canvases).where(eq(canvases.teamId, teamId))).toEqual([]);
  });

  it("ban: that person everywhere", async () => {
    await call(banUser, { userId: "member1", reason: "spam", durationDays: 7 }, asUser("admin"));
    await expectRevokes([{ userId: "member1" }]);
  });

  it("account deletion: that person everywhere, and everyone on their personal canvases", async () => {
    const { id: personal } = await call(
      createCanvas,
      { scope: { kind: "personal" }, path: "Mine.canvas" },
      asUser("member2"),
    );
    redis.published.length = 0;
    await cleanupUserData("member2");
    await expectRevokes([{ userId: "member2" }, { canvasId: personal }]);
  });

  it("publishes on the environment's channel", async () => {
    process.env.RAILWAY_ENVIRONMENT_NAME = "staging";
    await call(deleteCanvas, { canvasId: teamCanvas }, asUser("owner"));
    await vi.waitFor(() =>
      expect(redis.published.filter((p) => p.channel.includes(":canvas-sync:"))).toEqual([
        { channel: "staging:canvas-sync:revoke", message: { canvasId: teamCanvas } },
      ]),
    );
  });

  it("leaves a tombstone that outlives any token minted before the revoke", async () => {
    process.env.RAILWAY_ENVIRONMENT_NAME = "staging";
    redis.tombstones.clear();
    const before = Date.now();
    await call(deleteCanvas, { canvasId: teamCanvas }, asUser("owner"));
    await vi.waitFor(() =>
      expect(redis.tombstones.get(`staging:canvas-sync:revoked:${teamCanvas}:`)).toBeDefined(),
    );
    const tombstone = redis.tombstones.get(`staging:canvas-sync:revoked:${teamCanvas}:`)!;
    expect(tombstone.at).toBeGreaterThanOrEqual(before);
    expect(tombstone.ttlMs).toBeGreaterThan(SYNC_LIMITS.tokenTtlMs);
  });

  it("publishes nothing, and throws nothing, without REDIS_URL", async () => {
    delete process.env.REDIS_URL;
    await call(deleteCanvas, { canvasId: teamCanvas }, asUser("owner"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(redis.published).toEqual([]);
  });
});
