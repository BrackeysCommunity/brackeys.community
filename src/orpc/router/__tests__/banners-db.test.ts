import { call } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { bannerHistory, developerProfiles, user } from "@/db/schema";
import { syncBannerHistory } from "@/orpc/router/banners";
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
}));

let db: TestDb;

beforeEach(async () => {
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
  await db.delete(bannerHistory);
  await db.delete(developerProfiles);
  await db.delete(user);
  for (const id of ["alice", "bob"]) await seedUser(db, id);
});

const sync = (who: string, records: { id: string; firstSeen: number; closed: boolean }[]) =>
  call(syncBannerHistory, { records }, asUser(who));

describe("syncBannerHistory", () => {
  it("keeps the earliest sighting and never reopens a close", async () => {
    await sync("alice", [{ id: "cookie-notice", firstSeen: 2_000, closed: true }]);
    const merged = await sync("alice", [
      { id: "cookie-notice", firstSeen: 1_000, closed: false },
      { id: "canvases-launch", firstSeen: 3_000, closed: false },
    ]);
    expect([...merged].sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: "canvases-launch", firstSeen: 3_000, closed: false },
      { id: "cookie-notice", firstSeen: 1_000, closed: true },
    ]);
  });

  it("reads without writing, and only the caller's own history", async () => {
    await sync("alice", [{ id: "cookie-notice", firstSeen: 1_000, closed: true }]);
    expect(await sync("bob", [])).toEqual([]);
  });

  it("won't take a sighting from the future", async () => {
    const [record] = await sync("alice", [
      { id: "cookie-notice", firstSeen: Date.now() + 86_400_000, closed: false },
    ]);
    expect(record!.firstSeen).toBeLessThanOrEqual(Date.now());
  });

  it("refuses anonymous callers", async () => {
    await expect(call(syncBannerHistory, { records: [] }, asUser(null))).rejects.toThrow();
  });
});
