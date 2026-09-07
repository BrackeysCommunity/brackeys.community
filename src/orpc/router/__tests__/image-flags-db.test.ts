import { call } from "@orpc/server";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  developerProfiles,
  imageFlags,
  imageScans,
  moderationActions,
  teams,
  user,
} from "@/db/schema";
import { quarantineKey } from "@/lib/image-quarantine";
import {
  listImageFlags,
  requestImageRescan,
  resolveImageFlag,
  resolveImageFlags,
} from "@/orpc/router/admin";
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

const objects = new Set<string>();
vi.mock("@/lib/profile-project-image-storage", () => ({
  storedImageStore: {
    async move(from: string, to: string) {
      if (!objects.has(from)) return;
      objects.delete(from);
      objects.add(to);
    },
    async remove(key: string) {
      objects.delete(key);
    },
  },
}));

const rescans: string[] = [];
vi.mock("@/lib/media-scan", () => ({
  enqueueImageRescan: async (key: string) => {
    rescans.push(key);
  },
}));

/**
 * Plan 27 phase 3: the upload-flag queue. The worker's idempotent flag
 * write, the staff listing with its owner links, and confirm/dismiss acting
 * on the object (purge / restore) with their moderation-log records.
 */

let db: TestDb;

const KEY = "team-avatars/team-1/abc-avatar.png";

async function workerUpsertFlag(flag: { objectKey: string; score: number; quarantined?: boolean }) {
  await db
    .insert(imageFlags)
    .values({
      objectKey: flag.objectKey,
      ownerType: "team_avatar",
      ownerId: "team-1",
      uploaderId: "rita",
      kind: "nsfw",
      source: "auto",
      score: flag.score,
      evidence: { nsfwScore: flag.score, quarantined: flag.quarantined ?? false },
    })
    .onConflictDoUpdate({
      target: [imageFlags.objectKey, imageFlags.kind],
      targetWhere: sql`status = 'open'`,
      set: { score: flag.score },
    });
}

beforeEach(async () => {
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
  await db.delete(moderationActions);
  await db.delete(imageFlags);
  await db.delete(imageScans);
  await db.delete(teams);
  await db.delete(developerProfiles);
  await db.delete(user);
  objects.clear();
  rescans.length = 0;

  await seedUser(db, "staff", { guildRoles: ["Staff"] });
  await seedUser(db, "rita");
  await db.insert(teams).values({
    id: "team-1",
    slug: "team-one",
    name: "Team One",
    avatarKey: KEY,
    createdBy: "rita",
  });
  await db.insert(imageScans).values({
    objectKey: KEY,
    ownerType: "team_avatar",
    ownerId: "team-1",
    uploaderId: "rita",
    status: "scanned",
    detectorVersion: 1,
  });
  objects.add(KEY);
});

describe("worker flag upsert", () => {
  it("refreshes the open flag instead of stacking duplicates", async () => {
    await workerUpsertFlag({ objectKey: KEY, score: 0.9 });
    await workerUpsertFlag({ objectKey: KEY, score: 0.95 });
    const rows = await db.select().from(imageFlags);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.score).toBeCloseTo(0.95);
  });
});

type ListInput = {
  includeResolved?: boolean;
  ownerType?: "team_avatar" | "team_banner";
  page?: number;
  pageSize?: number;
};

describe("listImageFlags", () => {
  const list = (input: ListInput = {}, who = "staff") =>
    call(listImageFlags, { includeResolved: false, page: 1, pageSize: 20, ...input }, asUser(who));

  it("refuses non-staff", async () => {
    await expect(list({}, "rita")).rejects.toThrow();
  });

  it("links the owner and the uploader, and serves the image through the staff route", async () => {
    await workerUpsertFlag({ objectKey: KEY, score: 0.995, quarantined: true });

    const result = await list();
    expect(result.total).toBe(1);
    const [item] = result.items;
    expect(item!.owner).toEqual({ label: "Team One", href: "/teams/team-one" });
    expect(item!.ownerTypeLabel).toBe("Team avatar");
    expect(item!.uploader?.id).toBe("rita");
    expect(item!.imageUrl).toBe(`/staff-image/${KEY}`);
    expect(item!.scanStatus).toBe("scanned");
  });

  it("hides resolved flags unless asked", async () => {
    await workerUpsertFlag({ objectKey: KEY, score: 0.9 });
    const [flag] = await db.select().from(imageFlags);
    await call(resolveImageFlag, { flagId: flag!.id, action: "dismiss" }, asUser("staff"));

    expect((await list()).total).toBe(0);
    const everything = await list({ includeResolved: true });
    expect(everything.items[0]!.status).toBe("dismissed");
    expect(everything.items[0]!.resolvedBy?.id).toBe("staff");
  });
});

describe("resolveImageFlag", () => {
  it("confirm purges the object, detaches it, and logs against the uploader", async () => {
    await workerUpsertFlag({ objectKey: KEY, score: 0.995 });
    const [flag] = await db.select().from(imageFlags);

    await call(
      resolveImageFlag,
      { flagId: flag!.id, action: "confirm", reason: "explicit" },
      asUser("staff"),
    );

    expect(objects.size).toBe(0);
    const [team] = await db.select().from(teams).where(eq(teams.id, "team-1"));
    expect(team!.avatarKey).toBeNull();
    const [scan] = await db.select().from(imageScans);
    expect(scan!.status).toBe("purged");
    const [updated] = await db.select().from(imageFlags);
    expect(updated!.status).toBe("confirmed");

    const actions = await db.select().from(moderationActions);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      action: "image_flag_confirmed",
      targetType: "stored_image",
      targetId: KEY,
      subjectUserId: "rita",
      reason: "explicit",
    });
    expect(actions[0]!.metadata).toMatchObject({
      flagId: flag!.id,
      kind: "nsfw",
      ownerId: "team-1",
    });
  });

  it("dismiss on a quarantined image restores it", async () => {
    // What the worker does above the quarantine threshold.
    objects.delete(KEY);
    objects.add(quarantineKey(KEY));
    await db.update(teams).set({ avatarKey: null }).where(eq(teams.id, "team-1"));
    await db
      .update(imageScans)
      .set({
        status: "quarantined",
        detached: { teams: [{ id: "team-1", field: "avatarKey", url: null }] },
      })
      .where(eq(imageScans.objectKey, KEY));
    await workerUpsertFlag({ objectKey: KEY, score: 0.995, quarantined: true });
    const [flag] = await db.select().from(imageFlags);

    await call(resolveImageFlag, { flagId: flag!.id, action: "dismiss" }, asUser("staff"));

    expect(objects.has(KEY)).toBe(true);
    const [team] = await db.select().from(teams).where(eq(teams.id, "team-1"));
    expect(team!.avatarKey).toBe(KEY);
    const [scan] = await db.select().from(imageScans);
    expect(scan!.status).toBe("cleared");
    const actions = await db.select().from(moderationActions);
    expect(actions[0]!.action).toBe("image_flag_dismissed");
  });

  it("a re-click on a resolved flag is a no-op", async () => {
    await workerUpsertFlag({ objectKey: KEY, score: 0.9 });
    const [flag] = await db.select().from(imageFlags);
    await call(resolveImageFlag, { flagId: flag!.id, action: "dismiss" }, asUser("staff"));
    await call(resolveImageFlag, { flagId: flag!.id, action: "confirm" }, asUser("staff"));

    const [updated] = await db.select().from(imageFlags);
    expect(updated!.status).toBe("dismissed");
    expect(objects.has(KEY)).toBe(true);
    expect(await db.select().from(moderationActions)).toHaveLength(1);
  });

  it("refuses non-staff", async () => {
    await workerUpsertFlag({ objectKey: KEY, score: 0.9 });
    const [flag] = await db.select().from(imageFlags);
    await expect(
      call(resolveImageFlag, { flagId: flag!.id, action: "confirm" }, asUser("rita")),
    ).rejects.toThrow();
  });
});

describe("resolveImageFlags", () => {
  it("rules on every open flag in one call", async () => {
    await db.insert(imageScans).values({
      objectKey: "team-banners/team-1/b.png",
      ownerType: "team_banner",
      ownerId: "team-1",
      status: "scanned",
    });
    await workerUpsertFlag({ objectKey: KEY, score: 0.9 });
    await workerUpsertFlag({ objectKey: "team-banners/team-1/b.png", score: 0.95 });
    const ids = (await db.select({ id: imageFlags.id }).from(imageFlags)).map((r) => r.id);

    const first = await call(
      resolveImageFlags,
      { flagIds: ids, action: "dismiss" },
      asUser("staff"),
    );
    expect(first.resolved).toBe(2);
    const again = await call(
      resolveImageFlags,
      { flagIds: ids, action: "confirm" },
      asUser("staff"),
    );
    expect(again.resolved).toBe(0);
    expect(await db.select().from(moderationActions)).toHaveLength(2);
  });
});

describe("requestImageRescan", () => {
  it("requests a re-run and logs it", async () => {
    await call(requestImageRescan, { objectKey: KEY }, asUser("staff"));
    expect(rescans).toEqual([KEY]);
    const actions = await db.select().from(moderationActions);
    expect(actions[0]!.action).toBe("image_rescan_requested");
  });

  it("refuses a purged image and non-staff", async () => {
    await db.update(imageScans).set({ status: "purged" }).where(eq(imageScans.objectKey, KEY));
    await expect(call(requestImageRescan, { objectKey: KEY }, asUser("staff"))).rejects.toThrow();
    await expect(call(requestImageRescan, { objectKey: KEY }, asUser("rita"))).rejects.toThrow();
  });
});
