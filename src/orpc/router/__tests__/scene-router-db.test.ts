import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { developerProfiles, sceneDocs, user } from "@/db/schema";
import { verifyCanvasToken } from "@/lib/canvas/token";
import { createHostedScene, deleteHostedScene, getSceneSyncToken } from "@/orpc/router/scene";
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
vi.mock("@/lib/guild-sync", () => ({
  refreshDiscordProfileThrottled: async () => {},
  syncDiscordProfile: async () => ({ guildRolesSynced: false }),
}));

const redis = vi.hoisted(() => ({
  published: [] as { channel: string; message: unknown }[],
  tombstones: new Map<string, number>(),
}));
vi.mock("@/lib/redis", () => ({
  createRedisClient: async () => ({
    status: "ready",
    once() {},
    publish: async (channel: string, raw: string) => {
      redis.published.push({ channel, message: JSON.parse(raw) });
      return 1;
    },
    set: async (key: string, value: string) => {
      redis.tombstones.set(key, Number(value));
      return "OK";
    },
  }),
}));

const SECRET = "scene-router-sync-secret";
const SCENE = "platformer.level-1";

let db: TestDb;

beforeEach(async () => {
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
  redis.published.length = 0;
  redis.tombstones.clear();
  process.env.REDIS_URL = "redis://fake.test:6379";
  delete process.env.RAILWAY_ENVIRONMENT_NAME;
  process.env.CANVAS_SYNC_SECRET = SECRET;
  process.env.CANVAS_SYNC_URL = "wss://sync.test";
  await db.delete(sceneDocs);
  await db.delete(developerProfiles);
  await db.delete(user);
  await seedUser(db, "member");
  await seedUser(db, "moderator", { guildRoles: ["Moderator"] });
  await seedUser(db, "staff", { guildRoles: ["Staff"] });
  await seedUser(db, "admin", { guildRoles: ["Admin"] });
  await db.insert(sceneDocs).values({ sceneId: SCENE });
});

const mint = (userId: string | null, input: Partial<{ access: "read" | "write" }> = {}) =>
  call(getSceneSyncToken, { sceneId: SCENE, formatVersion: 1, ...input }, asUser(userId));

describe("getSceneSyncToken: the gate", () => {
  it.each(["moderator", "staff", "admin"])("mints a write token for %s", async (who) => {
    const { token, url, access } = await mint(who);
    expect(url).toBe("wss://sync.test");
    expect(access).toBe("write");
    expect(await verifyCanvasToken(token, SECRET)).toMatchObject({
      c: `scene:${SCENE}`,
      u: who,
      a: "write",
      k: "scene",
      f: 1,
    });
  });

  it("refuses a member with no staff role", async () => {
    await expect(mint("member")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses the signed-out", async () => {
    await expect(mint(null)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("refuses a staff role a ban outranks", async () => {
    await db.update(user).set({ bannedAt: new Date() }).where(eq(user.id, "staff"));
    await expect(mint("staff")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("getSceneSyncToken", () => {
  it("mints a read-only token on request", async () => {
    const { token, access } = await mint("staff", { access: "read" });
    expect(access).toBe("read");
    expect(await verifyCanvasToken(token, SECRET)).toMatchObject({ a: "read", k: "scene" });
  });

  it("carries the caller's format version, which the service compares", async () => {
    const { token } = await call(
      getSceneSyncToken,
      { sceneId: SCENE, formatVersion: 3 },
      asUser("staff"),
    );
    expect(await verifyCanvasToken(token, SECRET)).toMatchObject({ f: 3 });
  });

  it("refuses a scene that doesn't exist and an id that isn't one", async () => {
    await expect(
      call(getSceneSyncToken, { sceneId: "platformer.nope", formatVersion: 1 }, asUser("staff")),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      call(getSceneSyncToken, { sceneId: "Level One", formatVersion: 1 }, asUser("staff")),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("says so when live scenes aren't set up", async () => {
    delete process.env.CANVAS_SYNC_URL;
    await expect(mint("staff")).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});

describe("hosted scenes", () => {
  it("creates one with its seed, behind the same gate", async () => {
    const seed = { v: 1, game: "platformer", name: "level-2", bounds: [0, 0, 100, 100] };
    await expect(
      call(createHostedScene, { sceneId: "platformer.level-2", seed }, asUser("member")),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await call(createHostedScene, { sceneId: "platformer.level-2", seed }, asUser("staff"));
    const [row] = await db
      .select()
      .from(sceneDocs)
      .where(eq(sceneDocs.sceneId, "platformer.level-2"));
    expect(JSON.parse(row!.seed!)).toEqual(seed);
    expect(row).toMatchObject({ state: null, createdById: "staff" });
    await expect(
      call(createHostedScene, { sceneId: "platformer.level-2" }, asUser("staff")),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      call(createHostedScene, { sceneId: "platformer.bad", seed: { name: "x" } }, asUser("staff")),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("deletes one and revokes everyone on it, with a tombstone for later instances", async () => {
    await call(deleteHostedScene, { sceneId: SCENE }, asUser("admin"));
    expect(await db.select().from(sceneDocs).where(eq(sceneDocs.sceneId, SCENE))).toEqual([]);
    await vi.waitFor(() =>
      expect(redis.published).toEqual([
        { channel: "development:canvas-sync:revoke", message: { sceneId: SCENE } },
      ]),
    );
    expect([...redis.tombstones.keys()]).toEqual([
      `development:canvas-sync:revoked:scene:${SCENE}:`,
    ]);
    await expect(mint("staff")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
