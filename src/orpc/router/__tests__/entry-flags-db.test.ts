import { call } from "@orpc/server";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  developerProfiles,
  entryFlags,
  itchJamEntries,
  itchJams,
  moderationActions,
  user,
} from "@/db/schema";
import { listEntryFlags, resolveEntryFlag } from "@/orpc/router/admin";
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
 * Plan 22 phase 3: the entry-flag queue. The scan worker's idempotent flag
 * write (the partial unique index), the jam-scoped staff listing, and
 * confirm/dismiss with their moderation-log records.
 */

let db: TestDb;

/** What the scan worker writes — insert-or-refresh against the open flag. */
async function workerUpsertFlag(flag: {
  entryId: number;
  jamId: number;
  kind: "stolen_internal" | "nsfw";
  score: number;
  evidence: Record<string, unknown>;
}) {
  await db
    .insert(entryFlags)
    .values({ ...flag, source: "auto" })
    .onConflictDoUpdate({
      target: [entryFlags.entryId, entryFlags.kind],
      targetWhere: sql`status = 'open'`,
      set: { score: flag.score, evidence: flag.evidence },
    });
}

beforeEach(async () => {
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
  await db.delete(moderationActions);
  await db.delete(entryFlags);
  await db.delete(itchJamEntries);
  await db.delete(itchJams);
  await db.delete(developerProfiles);
  await db.delete(user);

  await seedUser(db, "staff", { guildRoles: ["Staff"] });
  await seedUser(db, "rita");

  await db.insert(itchJams).values([
    { jamId: 1, slug: "live-jam", title: "Live Jam", status: "running" },
    { jamId: 2, slug: "old-jam", title: "Old Jam", status: "over" },
  ]);
  await db.insert(itchJamEntries).values([
    {
      entryId: 101,
      jamId: 1,
      gameId: 9101,
      rateUrl: "https://itch.io/jam/live-jam/rate/9101",
      gameTitle: "Fresh Entry",
      gameUrl: "https://someone.itch.io/fresh",
      authorName: "someone",
    },
    {
      entryId: 201,
      jamId: 2,
      gameId: 9201,
      rateUrl: "https://itch.io/jam/old-jam/rate/9201",
      gameTitle: "Historic Entry",
      gameUrl: "https://other.itch.io/historic",
      authorName: "other",
    },
  ]);
});

describe("worker flag upsert", () => {
  it("refreshes the open flag instead of stacking duplicates", async () => {
    await workerUpsertFlag({
      entryId: 101,
      jamId: 1,
      kind: "nsfw",
      score: 0.9,
      evidence: { nsfwScore: 0.9 },
    });
    await workerUpsertFlag({
      entryId: 101,
      jamId: 1,
      kind: "nsfw",
      score: 0.95,
      evidence: { nsfwScore: 0.95 },
    });

    const rows = await db.select().from(entryFlags).where(eq(entryFlags.entryId, 101));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.score).toBeCloseTo(0.95);
    expect(rows[0]!.status).toBe("open");
  });

  it("a resolved flag leaves room for a fresh open one beside it", async () => {
    await workerUpsertFlag({ entryId: 101, jamId: 1, kind: "nsfw", score: 0.9, evidence: {} });
    const [flag] = await db.select().from(entryFlags);
    await call(resolveEntryFlag, { flagId: flag!.id, action: "dismiss" }, asUser("staff"));

    // The worker skips re-flagging ruled entries; the index itself only
    // guards *open* duplicates, so a deliberate later re-detection can
    // still open a fresh row without tripping it.
    await workerUpsertFlag({ entryId: 101, jamId: 1, kind: "nsfw", score: 0.99, evidence: {} });
    const rows = await db.select().from(entryFlags).where(eq(entryFlags.entryId, 101));
    expect(rows.map((r) => r.status).sort()).toEqual(["dismissed", "open"]);
  });
});

describe("listEntryFlags", () => {
  it("refuses non-staff", async () => {
    await expect(
      call(
        listEntryFlags,
        { includeResolved: false, jamScope: "all", page: 1, pageSize: 20 },
        asUser("rita"),
      ),
    ).rejects.toThrow();
  });

  it("scopes to live jams by default and orders by confidence", async () => {
    await workerUpsertFlag({ entryId: 101, jamId: 1, kind: "nsfw", score: 0.9, evidence: {} });
    await workerUpsertFlag({
      entryId: 101,
      jamId: 1,
      kind: "stolen_internal",
      score: 1,
      evidence: {},
    });
    await workerUpsertFlag({ entryId: 201, jamId: 2, kind: "nsfw", score: 0.99, evidence: {} });

    const live = await call(
      listEntryFlags,
      { includeResolved: false, jamScope: "live", page: 1, pageSize: 20 },
      asUser("staff"),
    );
    expect(live.items.map((i) => i.entryId)).toEqual([101, 101]);
    expect(live.items.map((i) => i.kind)).toEqual(["stolen_internal", "nsfw"]);
    expect(live.items[0]!.gameTitle).toBe("Fresh Entry");
    expect(live.items[0]!.jamTitle).toBe("Live Jam");

    const all = await call(
      listEntryFlags,
      { includeResolved: false, jamScope: "all", page: 1, pageSize: 20 },
      asUser("staff"),
    );
    expect(all.total).toBe(3);
  });

  it("hides resolved flags unless asked, and hydrates the resolver", async () => {
    await workerUpsertFlag({ entryId: 101, jamId: 1, kind: "nsfw", score: 0.9, evidence: {} });
    const [flag] = await db.select().from(entryFlags);
    await call(resolveEntryFlag, { flagId: flag!.id, action: "confirm" }, asUser("staff"));

    const open = await call(
      listEntryFlags,
      { includeResolved: false, jamScope: "all", page: 1, pageSize: 20 },
      asUser("staff"),
    );
    expect(open.total).toBe(0);

    const everything = await call(
      listEntryFlags,
      { includeResolved: true, jamScope: "all", page: 1, pageSize: 20 },
      asUser("staff"),
    );
    expect(everything.items[0]!.status).toBe("confirmed");
    expect(everything.items[0]!.resolvedBy?.id).toBe("staff");
  });
});

describe("resolveEntryFlag", () => {
  it("confirm records the judgment in the moderation log", async () => {
    await workerUpsertFlag({ entryId: 101, jamId: 1, kind: "nsfw", score: 0.9, evidence: {} });
    const [flag] = await db.select().from(entryFlags);

    await call(
      resolveEntryFlag,
      { flagId: flag!.id, action: "confirm", reason: "clearly explicit" },
      asUser("staff"),
    );

    const [updated] = await db.select().from(entryFlags).where(eq(entryFlags.id, flag!.id));
    expect(updated!.status).toBe("confirmed");
    expect(updated!.resolvedById).toBe("staff");
    expect(updated!.resolvedAt).not.toBeNull();

    const actions = await db.select().from(moderationActions);
    expect(actions).toHaveLength(1);
    expect(actions[0]!.action).toBe("entry_flag_confirmed");
    expect(actions[0]!.targetType).toBe("jam_entry");
    expect(actions[0]!.targetId).toBe("101");
    expect(actions[0]!.metadata).toMatchObject({
      flagId: flag!.id,
      kind: "nsfw",
      gameTitle: "Fresh Entry",
      jamTitle: "Live Jam",
    });
  });

  it("dismiss logs its own action, and a re-click is a no-op", async () => {
    await workerUpsertFlag({ entryId: 101, jamId: 1, kind: "nsfw", score: 0.9, evidence: {} });
    const [flag] = await db.select().from(entryFlags);

    await call(resolveEntryFlag, { flagId: flag!.id, action: "dismiss" }, asUser("staff"));
    await call(resolveEntryFlag, { flagId: flag!.id, action: "confirm" }, asUser("staff"));

    const [updated] = await db.select().from(entryFlags).where(eq(entryFlags.id, flag!.id));
    // The second call hit an already-resolved flag and changed nothing.
    expect(updated!.status).toBe("dismissed");
    const actions = await db.select().from(moderationActions);
    expect(actions).toHaveLength(1);
    expect(actions[0]!.action).toBe("entry_flag_dismissed");
  });

  it("refuses non-staff", async () => {
    await workerUpsertFlag({ entryId: 101, jamId: 1, kind: "nsfw", score: 0.9, evidence: {} });
    const [flag] = await db.select().from(entryFlags);
    await expect(
      call(resolveEntryFlag, { flagId: flag!.id, action: "confirm" }, asUser("rita")),
    ).rejects.toThrow();
  });
});
