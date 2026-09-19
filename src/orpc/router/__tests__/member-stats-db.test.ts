import { call } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { getMemberStats, listMembers } from "@/orpc/router/member";
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

let db: TestDb;

beforeEach(async () => {
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
});

describe("getMemberStats", () => {
  /** The home page advertises this number and `/members` has to open on
   *  it — a filter added to one side and not the other makes the tile a
   *  lie nobody would notice. */
  it("counts what the unfiltered directory lists", async () => {
    await seedUser(db, "member-a", { discordUsername: "A" });
    await seedUser(db, "member-b", { discordUsername: "B", availableForWork: true });

    const { total } = await call(getMemberStats, {}, asUser(null));
    const listing = await call(listMembers, { limit: 50, offset: 0 }, asUser(null));

    expect(total).toBe(2);
    expect(total).toBe(listing.total);
  });
});
