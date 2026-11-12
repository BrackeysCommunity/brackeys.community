import { and, asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  engineBlobs,
  engineProjects,
  engineReleaseAudit,
  engineReleaseFiles,
  engineReleaseObjects,
  engineReleases,
  imageScans,
} from "@/db/schema";
import {
  ENGINE_QUARANTINE_REASON,
  engineHashesUnderReview,
  engineObjectOf,
  type ImageObjectStore,
  purgeImage,
  quarantineImage,
  restoreImage,
} from "@/lib/image-quarantine";
import { createTestDb, seedUser, type TestDb } from "@/test/db";

import { engineAssetKey, engineReleaseObjectKey } from "../storage-keys";

const PROJECT = "kitchen";
const IMAGE = "c".repeat(64);
const OTHER_IMAGE = "d".repeat(64);
const SCRIPT = "e".repeat(64);
const BLOB = "f".repeat(64);
const V1 = "1".repeat(64);
const V2 = "2".repeat(64);
const V3 = "3".repeat(64);
const IMAGE_KEY = engineReleaseObjectKey(PROJECT, IMAGE);

let db: TestDb;
/** The releases each takedown purged from the edge, in order. */
let purged: string[] = [];
const takedown = { purge: async (releaseId: string) => void purged.push(releaseId) };

/** Records every bucket call; a hosted game's image must never reach it. */
function recordingStore(): ImageObjectStore & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async move(from, to) {
      calls.push(`move ${from} ${to}`);
    },
    async remove(key) {
      calls.push(`remove ${key}`);
    },
  };
}

async function seedRelease(id: string, version: number, files: [string, string, string][]) {
  await db.insert(engineReleases).values({
    id,
    projectId: PROJECT,
    version,
    manifest: "{}",
    manifestBytes: 2,
    totalBytes: 10,
    fileCount: files.length,
    engineVersion: "0.14.1",
    gameId: "tactics",
    snapshot: "a".repeat(64),
    buildHash: "b".repeat(64),
    target: "web",
  });
  for (const [path, sha256, source] of files) {
    await db.insert(engineReleaseFiles).values({
      releaseId: id,
      projectId: PROJECT,
      path,
      sha256,
      bytes: 4,
      role: path.endsWith(".js") ? "code" : "asset",
      source,
    });
  }
}

async function seedScan(objectKey: string, ownerType: "engine_blob" | "engine_release_file") {
  await db.insert(imageScans).values({
    objectKey,
    ownerType,
    ownerId: PROJECT,
    uploaderId: "owner",
    status: "scanned",
  });
}

beforeEach(async () => {
  purged = [];
  db = await createTestDb();
  await seedUser(db, "owner");
  await seedUser(db, "staff");
  await db.insert(engineProjects).values({ projectId: PROJECT, name: "Kitchen" });
  for (const sha256 of [IMAGE, OTHER_IMAGE, SCRIPT]) {
    await db.insert(engineReleaseObjects).values({
      projectId: PROJECT,
      sha256,
      bytes: 4,
      contentType: "image/png",
      storageKey: engineReleaseObjectKey(PROJECT, sha256),
    });
  }
  await db.insert(engineBlobs).values({
    projectId: PROJECT,
    sha256: BLOB,
    byteSize: 4,
    contentType: "image/png",
    storageKey: engineAssetKey(PROJECT, BLOB),
  });
  await seedRelease(V1, 1, [
    ["assets/hero.png", IMAGE, "release"],
    ["assets/app.js", SCRIPT, "release"],
  ]);
  await seedRelease(V2, 2, [
    ["assets/hero-copy.png", IMAGE, "release"],
    ["assets/tiles.png", BLOB, "blob"],
  ]);
  await seedRelease(V3, 3, [["assets/app.js", SCRIPT, "release"]]);
  await seedScan(IMAGE_KEY, "engine_release_file");
});

const releases = async () =>
  Object.fromEntries(
    (
      await db
        .select({
          version: engineReleases.version,
          hiddenAt: engineReleases.hiddenAt,
          hiddenReason: engineReleases.hiddenReason,
        })
        .from(engineReleases)
        .orderBy(asc(engineReleases.version))
    ).map((r) => [r.version, r.hiddenAt === null ? null : r.hiddenReason]),
  );

const quarantinedAt = async (sha256: string) =>
  (
    await db
      .select({ at: engineReleaseObjects.quarantinedAt })
      .from(engineReleaseObjects)
      .where(
        and(eq(engineReleaseObjects.projectId, PROJECT), eq(engineReleaseObjects.sha256, sha256)),
      )
  )[0]?.at ?? null;

const audit = async () =>
  (await db.select().from(engineReleaseAudit).orderBy(asc(engineReleaseAudit.id))).map((r) => [
    r.action,
    r.actorKind,
    r.actorId,
    r.releaseId,
  ]);

const scanStatus = async (objectKey: string) =>
  (
    await db
      .select({ status: imageScans.status })
      .from(imageScans)
      .where(eq(imageScans.objectKey, objectKey))
  )[0]?.status;

describe("engineObjectOf", () => {
  it("reads the project and hash off a blob or release-file key, and nothing else", () => {
    expect(engineObjectOf(IMAGE_KEY)).toEqual({
      projectId: PROJECT,
      sha256: IMAGE,
      source: "release",
    });
    expect(engineObjectOf(engineAssetKey(PROJECT, BLOB))).toEqual({
      projectId: PROJECT,
      sha256: BLOB,
      source: "blob",
    });
    expect(engineObjectOf("team-banners/team-1/abc.png")).toBeNull();
    expect(engineObjectOf(`engine-releases/${PROJECT}/not-a-hash`)).toBeNull();
    expect(engineObjectOf(`engine-saves/u/${PROJECT}/slot-1`)).toBeNull();
  });
});

describe("a flagged release image", () => {
  it("hides every release listing it, stamps the object, and never moves it", async () => {
    const store = recordingStore();
    const refs = await quarantineImage(db, store, IMAGE_KEY, takedown);

    expect(store.calls).toEqual([]);
    expect(refs?.engineReleases.sort()).toEqual([V1, V2]);
    expect(await releases()).toEqual({
      1: ENGINE_QUARANTINE_REASON,
      2: ENGINE_QUARANTINE_REASON,
      3: null,
    });
    expect(await quarantinedAt(IMAGE)).toBeInstanceOf(Date);
    expect(await quarantinedAt(SCRIPT)).toBeNull();
    expect(await scanStatus(IMAGE_KEY)).toBe("quarantined");
    expect([...purged].sort()).toEqual([V1, V2]);
    const rows = await audit();
    expect(rows).toHaveLength(2);
    expect(
      rows.every(
        ([action, kind, actor]) => action === "hide" && kind === "system" && actor === null,
      ),
    ).toBe(true);
    expect(rows.map((r) => String(r[3])).sort((a, b) => a.localeCompare(b))).toEqual([V1, V2]);
  });

  it("is idempotent when the job retries", async () => {
    const store = recordingStore();
    await quarantineImage(db, store, IMAGE_KEY, takedown);
    await db
      .update(imageScans)
      .set({ status: "scanned" })
      .where(eq(imageScans.objectKey, IMAGE_KEY));
    const again = await quarantineImage(db, store, IMAGE_KEY, takedown);
    expect(again?.engineReleases.sort()).toEqual([V1, V2]);
    expect(await audit()).toHaveLength(2);
    expect(purged).toHaveLength(2);
  });

  it("leaves a release staff hid for another reason as it was", async () => {
    await db
      .update(engineReleases)
      .set({ hiddenAt: new Date(), hiddenById: "staff", hiddenReason: "Reported for spam." })
      .where(eq(engineReleases.id, V1));
    const store = recordingStore();
    const refs = await quarantineImage(db, store, IMAGE_KEY, takedown);
    expect(refs?.engineReleases).toEqual([V2]);
    expect(purged).toEqual([V2]);

    await restoreImage(db, store, IMAGE_KEY);
    expect(await releases()).toEqual({ 1: "Reported for spam.", 2: null, 3: null });
  });

  it("dismissing restores the releases and clears the stamp, still without moving it", async () => {
    const store = recordingStore();
    await quarantineImage(db, store, IMAGE_KEY, takedown);
    expect(await restoreImage(db, store, IMAGE_KEY)).toBe(true);

    expect(store.calls).toEqual([]);
    expect(await releases()).toEqual({ 1: null, 2: null, 3: null });
    expect(await quarantinedAt(IMAGE)).toBeNull();
    expect(await scanStatus(IMAGE_KEY)).toBe("cleared");
    const rows = await audit();
    expect(rows.map((r) => [r[0], r[1]])).toEqual([
      ["hide", "system"],
      ["hide", "system"],
      ["unhide", "system"],
      ["unhide", "system"],
    ]);
  });

  it("keeps a release hidden while it lists another image under review", async () => {
    const otherKey = engineReleaseObjectKey(PROJECT, OTHER_IMAGE);
    await db.insert(engineReleaseFiles).values({
      releaseId: V1,
      projectId: PROJECT,
      path: "assets/villain.png",
      sha256: OTHER_IMAGE,
      bytes: 4,
      role: "asset",
      source: "release",
    });
    await seedScan(otherKey, "engine_release_file");
    const store = recordingStore();
    await quarantineImage(db, store, IMAGE_KEY, takedown);
    await quarantineImage(db, store, otherKey, takedown);

    await restoreImage(db, store, IMAGE_KEY);
    expect(await releases()).toEqual({ 1: ENGINE_QUARANTINE_REASON, 2: null, 3: null });

    await restoreImage(db, store, otherKey);
    expect(await releases()).toEqual({ 1: null, 2: null, 3: null });
  });

  it("a flagged project blob hides the releases listing its hash", async () => {
    const blobKey = engineAssetKey(PROJECT, BLOB);
    await seedScan(blobKey, "engine_blob");
    const store = recordingStore();
    const refs = await quarantineImage(db, store, blobKey, takedown);

    expect(store.calls).toEqual([]);
    expect(refs?.engineReleases).toEqual([V2]);
    expect(await releases()).toEqual({ 1: null, 2: ENGINE_QUARANTINE_REASON, 3: null });
    expect([...(await engineHashesUnderReview(db, PROJECT, [BLOB, IMAGE, SCRIPT]))]).toEqual([
      BLOB,
    ]);

    await restoreImage(db, store, blobKey);
    expect(await releases()).toEqual({ 1: null, 2: null, 3: null });
    expect(await engineHashesUnderReview(db, PROJECT, [BLOB])).toEqual(new Set());
  });

  it("confirming keeps the bytes (shared by hash) and the releases hidden", async () => {
    const store = recordingStore();
    await quarantineImage(db, store, IMAGE_KEY, takedown);
    expect(await purgeImage(db, store, IMAGE_KEY, takedown)).toBe(true);

    expect(store.calls).toEqual([]);
    // Purged once, when the quarantine hid them.
    expect(purged).toHaveLength(2);
    expect(await scanStatus(IMAGE_KEY)).toBe("purged");
    expect(await releases()).toEqual({
      1: ENGINE_QUARANTINE_REASON,
      2: ENGINE_QUARANTINE_REASON,
      3: null,
    });
    expect(await engineHashesUnderReview(db, PROJECT, [IMAGE, SCRIPT])).toEqual(new Set([IMAGE]));
  });

  it("a takedown whose edge purge fails still hides the releases", async () => {
    const store = recordingStore();
    const refs = await quarantineImage(db, store, IMAGE_KEY, {
      purge: async () => {
        throw new Error("Cloudflare is down");
      },
    });
    expect(refs?.engineReleases.sort()).toEqual([V1, V2]);
    expect(await scanStatus(IMAGE_KEY)).toBe("quarantined");
  });

  it("confirming an image that was only flagged hides its releases too", async () => {
    const store = recordingStore();
    await purgeImage(db, store, IMAGE_KEY, takedown);
    expect(store.calls).toEqual([]);
    expect([...purged].sort()).toEqual([V1, V2]);
    expect(await releases()).toEqual({
      1: ENGINE_QUARANTINE_REASON,
      2: ENGINE_QUARANTINE_REASON,
      3: null,
    });
  });
});
