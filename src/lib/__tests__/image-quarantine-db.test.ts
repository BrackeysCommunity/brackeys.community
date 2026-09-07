import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  collabPostImages,
  developerProfiles,
  imageScans,
  projects,
  teams,
  user,
} from "@/db/schema";
import {
  detachImageKey,
  type ImageObjectStore,
  purgeImage,
  quarantineImage,
  quarantineKey,
  restoreImage,
} from "@/lib/image-quarantine";
import { createTestDb, seedCollabPost, seedUser, type TestDb } from "@/test/db";

/**
 * Plan 27 phase 3: what a quarantine does to our own rows and objects, and
 * what a dismiss and a confirm do afterwards. The object store is a fake
 * keyed on object names; the DB is the real migrated schema.
 */

let db: TestDb;

function fakeStore(): ImageObjectStore & { objects: Set<string> } {
  const objects = new Set<string>();
  return {
    objects,
    async move(from, to) {
      if (!objects.has(from)) return;
      objects.delete(from);
      objects.add(to);
    },
    async remove(key) {
      objects.delete(key);
    },
  };
}

const KEY = "team-banners/team-1/abc-banner.png";

beforeEach(async () => {
  db = await createTestDb();
  await seedUser(db, "owner");
  await db.insert(teams).values({
    id: "team-1",
    slug: "team-one",
    name: "Team One",
    bannerKey: KEY,
    bannerUrl: `/images/${KEY}`,
    createdBy: "owner",
  });
  await db.insert(imageScans).values({
    objectKey: KEY,
    ownerType: "team_banner",
    ownerId: "team-1",
    uploaderId: "owner",
    status: "scanned",
  });
});

describe("detachImageKey", () => {
  it("clears every reference to the key across owner tables and reports them", async () => {
    const postId = await seedCollabPost(db, "owner");
    await db.insert(collabPostImages).values({ postId, imageKey: KEY, url: "/x", alt: "alt" });
    await db.insert(projects).values({
      id: "proj-1",
      slug: "proj-one",
      title: "Project",
      imageKey: KEY,
      createdBy: "owner",
    });

    const refs = await detachImageKey(db, KEY);

    expect(refs.teams).toEqual([{ id: "team-1", field: "bannerKey", url: `/images/${KEY}` }]);
    expect(refs.collabPostImages).toHaveLength(1);
    expect(refs.projects).toEqual(["proj-1"]);
    const [team] = await db.select().from(teams).where(eq(teams.id, "team-1"));
    expect(team!.bannerKey).toBeNull();
    expect(await db.select().from(collabPostImages)).toHaveLength(0);
    const [project] = await db.select().from(projects).where(eq(projects.id, "proj-1"));
    expect(project!.imageKey).toBeNull();
  });
});

describe("quarantineImage", () => {
  it("detaches, moves the object under quarantine/, and records the refs", async () => {
    const store = fakeStore();
    store.objects.add(KEY);

    const refs = await quarantineImage(db, store, KEY);

    expect(refs?.teams).toHaveLength(1);
    expect(store.objects.has(KEY)).toBe(false);
    expect(store.objects.has(quarantineKey(KEY))).toBe(true);
    const [scan] = await db.select().from(imageScans).where(eq(imageScans.objectKey, KEY));
    expect(scan!.status).toBe("quarantined");
    expect(scan!.detached).toMatchObject({ teams: [{ id: "team-1", field: "bannerKey" }] });
  });

  it("is idempotent under a retried job and never re-quarantines a cleared image", async () => {
    const store = fakeStore();
    store.objects.add(KEY);
    await quarantineImage(db, store, KEY);
    const again = await quarantineImage(db, store, KEY);
    // The refs recorded the first time survive the retry finding nothing left to detach.
    expect(again?.teams).toHaveLength(1);

    await restoreImage(db, store, KEY);
    expect(await quarantineImage(db, store, KEY)).toBeNull();
    const [team] = await db.select().from(teams).where(eq(teams.id, "team-1"));
    expect(team!.bannerKey).toBe(KEY);
  });
});

describe("restoreImage", () => {
  it("moves the object back and re-attaches the key where the slot is still empty", async () => {
    const store = fakeStore();
    store.objects.add(KEY);
    await quarantineImage(db, store, KEY);

    expect(await restoreImage(db, store, KEY)).toBe(true);

    expect(store.objects.has(KEY)).toBe(true);
    expect(store.objects.has(quarantineKey(KEY))).toBe(false);
    const [team] = await db.select().from(teams).where(eq(teams.id, "team-1"));
    expect(team!.bannerKey).toBe(KEY);
    expect(team!.bannerUrl).toBe(`/images/${KEY}`);
    const [scan] = await db.select().from(imageScans).where(eq(imageScans.objectKey, KEY));
    expect(scan!.status).toBe("cleared");
    expect(scan!.detached).toBeNull();
  });

  it("keeps a replacement the owner uploaded while the image was in review", async () => {
    const store = fakeStore();
    store.objects.add(KEY);
    await quarantineImage(db, store, KEY);
    await db
      .update(teams)
      .set({ bannerKey: "team-banners/team-1/new.png" })
      .where(eq(teams.id, "team-1"));

    await restoreImage(db, store, KEY);

    const [team] = await db.select().from(teams).where(eq(teams.id, "team-1"));
    expect(team!.bannerKey).toBe("team-banners/team-1/new.png");
  });

  it("puts a deleted post image row back on its post", async () => {
    const postId = await seedCollabPost(db, "owner");
    const [inserted] = await db
      .insert(collabPostImages)
      .values({ postId, imageKey: KEY, url: "/x", alt: "alt", sortOrder: 2 })
      .returning({ id: collabPostImages.id });
    const store = fakeStore();
    store.objects.add(KEY);
    await quarantineImage(db, store, KEY);
    expect(await db.select().from(collabPostImages)).toHaveLength(0);

    await restoreImage(db, store, KEY);

    const rows = await db.select().from(collabPostImages);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: inserted!.id,
      postId,
      imageKey: KEY,
      alt: "alt",
      sortOrder: 2,
    });
  });
});

describe("purgeImage", () => {
  it("removes the object from both locations and marks the row purged", async () => {
    const store = fakeStore();
    store.objects.add(KEY);
    await quarantineImage(db, store, KEY);

    expect(await purgeImage(db, store, KEY)).toBe(true);

    expect(store.objects.size).toBe(0);
    const [scan] = await db.select().from(imageScans).where(eq(imageScans.objectKey, KEY));
    expect(scan!.status).toBe("purged");
    // The record of where it was attached survives the purge.
    expect(scan!.detached).toMatchObject({ teams: [{ id: "team-1" }] });
  });

  it("takes down an image that was flagged but never quarantined", async () => {
    const store = fakeStore();
    store.objects.add(KEY);

    await purgeImage(db, store, KEY);

    const [team] = await db.select().from(teams).where(eq(teams.id, "team-1"));
    expect(team!.bannerKey).toBeNull();
    expect(store.objects.size).toBe(0);
  });
});

describe("migration backfill", () => {
  it("seeds a pending scan row for every existing upload key", async () => {
    // The migration already ran against an empty DB; re-run its seed
    // statement over rows inserted afterwards to prove the shape is right.
    await db.delete(imageScans);
    await db.insert(user).values({
      id: "u2",
      name: "u2",
      email: "u2@test.invalid",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.insert(developerProfiles).values({ id: "u2", discordId: "d-u2" });
    const postId = await seedCollabPost(db, "u2");
    await db.insert(collabPostImages).values([
      { postId, imageKey: `collab-post-images/${postId}/a.png`, url: "/a" },
      // A legacy value that is not one of our keys must not get a row.
      { postId, imageKey: "12345", url: "/legacy" },
    ]);
    const [{ default: fs }, { default: path }] = await Promise.all([
      import("node:fs"),
      import("node:path"),
    ]);
    const folder = fs
      .readdirSync(path.join(process.cwd(), "drizzle"))
      .find((name) => name.endsWith("_image-scans"))!;
    const sqlText = fs.readFileSync(
      path.join(process.cwd(), "drizzle", folder, "migration.sql"),
      "utf8",
    );
    const seed = sqlText.split("--> statement-breakpoint").find((s) => s.includes("INSERT INTO"))!;
    await db.execute(seed);

    const rows = await db.select().from(imageScans);
    const byKey = (a: unknown[], b: unknown[]) => String(a[0]).localeCompare(String(b[0]));
    expect(
      rows.map((r) => [r.objectKey, r.ownerType, r.ownerId, r.uploaderId, r.status]).sort(byKey),
    ).toEqual(
      [
        [
          `collab-post-images/${postId}/a.png`,
          "collab_post_image",
          String(postId),
          "u2",
          "pending",
        ],
        [KEY, "team_banner", "team-1", "owner", "pending"],
      ].sort(byKey),
    );
  });
});
