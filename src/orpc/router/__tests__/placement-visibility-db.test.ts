import { call } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { itchJams, profileProjects } from "@/db/schema";
import { getJamCommunity } from "@/orpc/router/jam";
import { getProfile } from "@/orpc/router/profile";
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

/**
 * A placement is public on all four of `status`, `published`, `restricted_at`
 * and `missing_since` or on none of them. The jam community shelf used to
 * check only the first two, which put an itch.io "Restricted" game on the jam
 * page while its owner's profile — checking all four — hid it.
 */

const JAM_ID = 4242;

let db: TestDb;

async function seedPlacement(overrides: Partial<typeof profileProjects.$inferInsert> = {}) {
  await db.insert(profileProjects).values({
    profileId: "member",
    title: "Restricted Game",
    type: "game",
    jamId: JAM_ID,
    url: "https://member.itch.io/restricted-game",
    ...overrides,
  });
}

async function shelfTitles() {
  const { members } = await call(getJamCommunity, { jamId: JAM_ID }, asUser(null));
  return members.map((m) => m.entryTitle);
}

async function profileTitles() {
  const profile = await call(getProfile, { userId: "member" }, asUser(null));
  return (profile?.projects ?? []).map((p) => p.title);
}

beforeEach(async () => {
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
  await db.delete(profileProjects);
  await db.delete(itchJams);
  await seedUser(db, "member").catch(() => "member");
  await db.insert(itchJams).values({
    jamId: JAM_ID,
    slug: "test-jam",
    title: "Test Jam",
    status: "over",
  });
});

describe("placement visibility", () => {
  it("lists a plain approved placement on both surfaces", async () => {
    await seedPlacement();

    expect(await shelfTitles()).toEqual(["Restricted Game"]);
    expect(await profileTitles()).toEqual(["Restricted Game"]);
  });

  it.each([
    ["restricted on itch.io", { restrictedAt: new Date() }],
    ["gone from the linked library", { missingSince: new Date() }],
    ["unpublished at the provider", { published: false }],
    ["held by moderation", { status: "pending" }],
  ])("hides a placement %s from both surfaces", async (_case, overrides) => {
    await seedPlacement(overrides);

    expect(await shelfTitles()).toEqual([]);
    expect(await profileTitles()).toEqual([]);
  });
});
