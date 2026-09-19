import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { developerProfiles, profileUrlStubs, user } from "@/db/schema";
import { clearUrlStub, setUrlStub } from "@/orpc/router/profile";
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

/**
 * The stub is what the profile route is keyed on, so where clearing one
 * lands is a routing question, not a cosmetic one.
 */

let db: TestDb;

beforeEach(async () => {
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
  await db.delete(profileUrlStubs);
  await db.delete(developerProfiles);
  await db.delete(user);
});

async function storedStub(userId: string) {
  const [row] = await db
    .select({ stub: profileUrlStubs.stub, source: profileUrlStubs.source })
    .from(profileUrlStubs)
    .where(eq(profileUrlStubs.profileId, userId));
  return row ?? null;
}

describe("setUrlStub", () => {
  it("records a hand-claimed stub as the member's own", async () => {
    await seedUser(db, "member", { discordUsername: "member" });
    await db
      .insert(profileUrlStubs)
      .values({ profileId: "member", stub: "member", source: "discord" });

    await call(setUrlStub, { stub: "saltysweet" }, asUser("member"));

    expect(await storedStub("member")).toEqual({ stub: "saltysweet", source: "user" });
  });
});

describe("clearUrlStub", () => {
  it("falls back to the discord-derived default", async () => {
    await seedUser(db, "member", { discordUsername: "salty.sweet" });
    await db.insert(profileUrlStubs).values({ profileId: "member", stub: "saltysweet" });

    const result = await call(clearUrlStub, undefined, asUser("member"));

    expect(result).toEqual({ stub: "salty-sweet", slug: "salty-sweet" });
    expect(await storedStub("member")).toEqual({ stub: "salty-sweet", source: "discord" });
  });

  it("drops the row and routes by id when someone else holds the default", async () => {
    await seedUser(db, "member", { discordUsername: "taken" });
    await seedUser(db, "squatter", { discordUsername: "squatter" });
    await db.insert(profileUrlStubs).values([
      { profileId: "squatter", stub: "taken" },
      { profileId: "member", stub: "saltysweet" },
    ]);

    const result = await call(clearUrlStub, undefined, asUser("member"));

    expect(result).toEqual({ stub: null, slug: "member" });
    expect(await storedStub("member")).toBeNull();
    expect(await storedStub("squatter")).toEqual({ stub: "taken", source: "user" });
  });

  it("drops the row when the discord username can't make a stub", async () => {
    await seedUser(db, "member", { discordUsername: "x." });
    await db.insert(profileUrlStubs).values({ profileId: "member", stub: "saltysweet" });

    const result = await call(clearUrlStub, undefined, asUser("member"));

    expect(result).toEqual({ stub: null, slug: "member" });
    expect(await storedStub("member")).toBeNull();
  });

  it("rejects an anonymous caller", async () => {
    await expect(call(clearUrlStub, undefined, asUser(null))).rejects.toThrow();
  });
});
