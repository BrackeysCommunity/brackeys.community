import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  developerProfiles,
  engineProjects,
  engineReleaseFiles,
  engineReleaseObjects,
  engineReleases,
  imageFlags,
  imageScans,
  moderationActions,
  projects,
  user,
} from "@/db/schema";
import { ENGINE_QUARANTINE_REASON, quarantineImage } from "@/lib/image-quarantine";
import { listImageFlags, resolveImageFlag } from "@/orpc/router/admin";
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

/** Every bucket call the router makes; a hosted game's image must never reach one. */
const bucketCalls: string[] = [];
vi.mock("@/lib/profile-project-image-storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/profile-project-image-storage")>()),
  storedImageStore: {
    async move(from: string, to: string) {
      bucketCalls.push(`move ${from} ${to}`);
    },
    async remove(key: string) {
      bucketCalls.push(`remove ${key}`);
    },
  },
}));

let db: TestDb;

async function flag(objectKey: string, ownerType: "engine_blob" | "engine_release_file") {
  const ownerId = objectKey.split("/")[1]!;
  await db.insert(imageScans).values({
    objectKey,
    ownerType,
    ownerId,
    uploaderId: "rita",
    status: "scanned",
    detectorVersion: 1,
  });
  await db.insert(imageFlags).values({
    objectKey,
    ownerType,
    ownerId,
    uploaderId: "rita",
    kind: "nsfw",
    source: "auto",
    score: 0.99,
    evidence: { nsfwScore: 0.99, quarantined: false },
  });
}

beforeEach(async () => {
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
  bucketCalls.length = 0;
  await db.delete(imageFlags);
  await db.delete(imageScans);
  await db.delete(engineProjects);
  await db.delete(projects);
  await db.delete(developerProfiles);
  await db.delete(user);
  await seedUser(db, "staff", { guildRoles: ["Staff"] });
  await seedUser(db, "rita");
});

describe("listImageFlags on hosted game images", () => {
  it("names the game by its showcase title or project name and links its page", async () => {
    await db.insert(projects).values({ id: "show-1", slug: "star-hop", title: "Star Hop" });
    await db.insert(engineProjects).values([
      { projectId: "linked", name: "linked-project", showcaseProjectId: "show-1" },
      { projectId: "plain", name: "Plain Game" },
    ]);
    await flag("engine-releases/linked/1/cover.png", "engine_release_file");
    await flag("engine-assets/plain/abc.png", "engine_blob");
    await flag("engine-assets/gone/abc.png", "engine_blob");

    const { items } = await call(
      listImageFlags,
      { includeResolved: false, page: 1, pageSize: 20 },
      asUser("staff"),
    );
    const owners = Object.fromEntries(items.map((item) => [item.ownerId, item.owner]));
    expect(owners).toEqual({
      linked: { label: "Star Hop", href: "/games/linked" },
      plain: { label: "Plain Game", href: "/games/plain" },
      gone: null,
    });
  });
});

describe("resolveImageFlag on a hosted game image", () => {
  const PROJECT = "kitchen";
  const IMAGE = "c".repeat(64);
  const RELEASE = "1".repeat(64);
  const KEY = `engine-releases/${PROJECT}/${IMAGE}`;

  beforeEach(async () => {
    await db.insert(engineProjects).values({ projectId: PROJECT, name: "Kitchen" });
    await db.insert(engineReleaseObjects).values({
      projectId: PROJECT,
      sha256: IMAGE,
      bytes: 4,
      contentType: "image/png",
      storageKey: KEY,
    });
    await db.insert(engineReleases).values({
      id: RELEASE,
      projectId: PROJECT,
      version: 1,
      manifest: "{}",
      manifestBytes: 2,
      totalBytes: 4,
      fileCount: 1,
      engineVersion: "0.14.1",
      gameId: "tactics",
      snapshot: "a".repeat(64),
      buildHash: "b".repeat(64),
      target: "web",
    });
    await db.insert(engineReleaseFiles).values({
      releaseId: RELEASE,
      projectId: PROJECT,
      path: "assets/hero.png",
      sha256: IMAGE,
      bytes: 4,
      role: "asset",
      source: "release",
    });
    await flag(KEY, "engine_release_file");
    await quarantineImage(db, { move: async () => {}, remove: async () => {} }, KEY, {
      purge: async () => {},
    });
  });

  it("confirming closes the flag, keeps the object and leaves the release hidden", async () => {
    const [open] = await db.select({ id: imageFlags.id }).from(imageFlags);
    await call(resolveImageFlag, { flagId: open!.id, action: "confirm" }, asUser("staff"));

    expect(bucketCalls).toEqual([]);
    const [closed] = await db
      .select({ status: imageFlags.status, resolvedById: imageFlags.resolvedById })
      .from(imageFlags);
    expect(closed).toEqual({ status: "confirmed", resolvedById: "staff" });
    const [scan] = await db
      .select({ status: imageScans.status })
      .from(imageScans)
      .where(eq(imageScans.objectKey, KEY));
    expect(scan?.status).toBe("purged");
    const [object] = await db
      .select({ quarantinedAt: engineReleaseObjects.quarantinedAt })
      .from(engineReleaseObjects)
      .where(eq(engineReleaseObjects.sha256, IMAGE));
    expect(object?.quarantinedAt).toBeInstanceOf(Date);
    const [release] = await db
      .select({ reason: engineReleases.hiddenReason })
      .from(engineReleases)
      .where(eq(engineReleases.id, RELEASE));
    expect(release?.reason).toBe(ENGINE_QUARANTINE_REASON);
    const [action] = await db
      .select({ action: moderationActions.action, metadata: moderationActions.metadata })
      .from(moderationActions)
      .where(eq(moderationActions.targetId, KEY));
    expect(action?.action).toBe("image_flag_confirmed");
    expect(action?.metadata).toMatchObject({ keptHidden: true });

    const { items } = await call(
      listImageFlags,
      { includeResolved: true, page: 1, pageSize: 20 },
      asUser("staff"),
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ keepsObject: true, scanStatus: "purged" });
    expect(items[0]!.imageUrl).toBe(`/staff-image/engine-releases/${PROJECT}/${IMAGE}`);
  });
});
