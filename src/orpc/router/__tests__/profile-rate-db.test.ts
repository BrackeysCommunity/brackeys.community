import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { developerProfiles, user } from "@/db/schema";
import { updateProfile } from "@/orpc/router/profile";
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
 * The rate bounds are two columns the editor saves one at a time, so a
 * partial update is the shape that actually reaches production — and it is
 * the shape a schema-level check can't see. These run the comparison
 * against a real stored row.
 */

let db: TestDb;

beforeEach(async () => {
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
  await db.delete(developerProfiles);
  await db.delete(user);
});

async function storedRate(userId: string) {
  const [row] = await db
    .select({ rateMin: developerProfiles.rateMin, rateMax: developerProfiles.rateMax })
    .from(developerProfiles)
    .where(eq(developerProfiles.id, userId));
  return row;
}

describe("updateProfile — rate bounds", () => {
  it("rejects a maximum below the stored minimum", async () => {
    await seedUser(db, "u1", { rateMin: 150 });

    await expect(call(updateProfile, { rateMax: 50 }, asUser("u1"))).rejects.toThrow(
      /below your minimum/i,
    );
    expect(await storedRate("u1")).toEqual({ rateMin: 150, rateMax: null });
  });

  it("rejects a minimum above the stored maximum", async () => {
    await seedUser(db, "u1", { rateMax: 150 });

    await expect(call(updateProfile, { rateMin: 10_000_000 }, asUser("u1"))).rejects.toThrow();
    expect(await storedRate("u1")).toEqual({ rateMin: null, rateMax: 150 });
  });

  it("rejects a reversed pair sent together", async () => {
    await seedUser(db, "u1");

    await expect(
      call(updateProfile, { rateMin: 500, rateMax: 100 }, asUser("u1")),
    ).rejects.toThrow();
    expect(await storedRate("u1")).toEqual({ rateMin: null, rateMax: null });
  });

  it("caps an amount at a million, so `$10000K` is unreachable by typing", async () => {
    await seedUser(db, "u1");

    await expect(call(updateProfile, { rateMin: 10_000_000 }, asUser("u1"))).rejects.toThrow();
    expect(await storedRate("u1")).toEqual({ rateMin: null, rateMax: null });
  });

  it("accepts an ordered pair, and either half of one", async () => {
    await seedUser(db, "u1");

    await call(updateProfile, { rateMin: 50, rateMax: 150 }, asUser("u1"));
    expect(await storedRate("u1")).toEqual({ rateMin: 50, rateMax: 150 });

    await call(updateProfile, { rateMax: 200 }, asUser("u1"));
    expect(await storedRate("u1")).toEqual({ rateMin: 50, rateMax: 200 });

    await call(updateProfile, { rateMin: 75 }, asUser("u1"));
    expect(await storedRate("u1")).toEqual({ rateMin: 75, rateMax: 200 });
  });

  it("lets an equal pair through — a flat rate is not a reversed range", async () => {
    await seedUser(db, "u1", { rateMin: 100 });

    await call(updateProfile, { rateMax: 100 }, asUser("u1"));
    expect(await storedRate("u1")).toEqual({ rateMin: 100, rateMax: 100 });
  });

  it("lets a bound be cleared, and still guards what replaces it", async () => {
    await seedUser(db, "u1", { rateMin: 100, rateMax: 200 });

    // Clearing is never a reversed pair, whatever the other half holds.
    await call(updateProfile, { rateMin: null }, asUser("u1"));
    expect(await storedRate("u1")).toEqual({ rateMin: null, rateMax: 200 });

    // The surviving maximum still governs the next minimum.
    await expect(call(updateProfile, { rateMin: 300 }, asUser("u1"))).rejects.toThrow();
    expect(await storedRate("u1")).toEqual({ rateMin: null, rateMax: 200 });
  });
});
