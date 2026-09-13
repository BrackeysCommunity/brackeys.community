import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { developerProfiles, linkedAccounts, teamMembers, teams, user } from "@/db/schema";
import { seedUser, type TestDb } from "@/test/db";

vi.mock("@/db", async () => {
  const { createTestDb } = await import("@/test/db");
  return { db: await createTestDb() } as unknown as typeof import("@/db");
});

const { personProperties } = await import("@/lib/person-properties");

/**
 * These become PostHog person properties, so the failure they exist to catch
 * is a silent one: a join that multiplies two unrelated counts together reads
 * as a plausible number and quietly misstates every cohort built on it.
 */

let db: TestDb;

beforeEach(async () => {
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
  await db.delete(teamMembers);
  await db.delete(teams);
  await db.delete(linkedAccounts);
  await db.delete(developerProfiles);
  await db.delete(user);
});

async function link(profileId: string, provider: string) {
  await db.insert(linkedAccounts).values({
    profileId,
    provider,
    providerUserId: `${provider}-1`,
    providerUsername: "who",
  });
}

async function team(slug: string, memberId: string) {
  const [row] = await db
    .insert(teams)
    .values({ slug, name: slug, createdBy: memberId })
    .returning();
  await db.insert(teamMembers).values({ teamId: row!.id, userId: memberId, role: "member" });
}

async function joinedDaysAgo(id: string, days: number) {
  await db
    .update(user)
    .set({ createdAt: new Date(Date.now() - days * 86_400_000) })
    .where(eq(user.id, id));
}

describe("personProperties", () => {
  it("reads a brand-new account as zero on every dimension", async () => {
    await seedUser(db, "u1");

    expect(await personProperties("u1")).toEqual({
      account_age_days: 0,
      linked_provider_count: 0,
      team_count: 0,
    });
  });

  it("counts whole days since the account was made", async () => {
    await seedUser(db, "u1");
    await joinedDaysAgo("u1", 40);

    expect((await personProperties("u1"))?.account_age_days).toBe(40);
  });

  it("does not multiply links by teams", async () => {
    // The regression this file exists for: two left joins over one row each
    // produce a cross product, and three teams times two links reads as six
    // of each unless the counts are distinct.
    await seedUser(db, "u1");
    await link("u1", "github");
    await link("u1", "gitlab-brackeys");
    await team("alpha", "u1");
    await team("beta", "u1");
    await team("gamma", "u1");

    expect(await personProperties("u1")).toMatchObject({
      linked_provider_count: 2,
      team_count: 3,
    });
  });

  it("counts only the person asked about", async () => {
    await seedUser(db, "u1");
    await seedUser(db, "u2");
    await link("u2", "github");
    await team("alpha", "u2");

    expect(await personProperties("u1")).toMatchObject({
      linked_provider_count: 0,
      team_count: 0,
    });
  });

  it("answers null for a user row that is not there", async () => {
    expect(await personProperties("ghost")).toBeNull();
  });

  it("never reports a negative age when the clock is behind the row", async () => {
    await seedUser(db, "u1");
    await joinedDaysAgo("u1", -3);

    expect((await personProperties("u1"))?.account_age_days).toBe(0);
  });
});
