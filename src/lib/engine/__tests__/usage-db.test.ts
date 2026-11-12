import type { AssetEntry, ProjectState } from "@jams/engine/project";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  engineAssetDocs,
  engineBlobs,
  engineProjects,
  engineReleaseChannels,
  engineReleaseFiles,
  engineReleaseJamLinks,
  engineReleaseObjects,
  engineReleases,
  itchJams,
  sceneDocs,
} from "@/db/schema";
import { emptyProjectState, seedProjectState } from "@/lib/scene/project-bytes";
import type { TestDb } from "@/test/db";

import { PROJECT_QUOTA } from "../limits";
import { projectUsageReport, releaseUsageReport, storedUsage } from "../usage";
import { PROJECT, seedEngine } from "./harness";

vi.mock("@/db", async () => {
  const { createTestDb } = await import("@/test/db");
  return { db: await createTestDb() } as unknown as typeof import("@/db");
});

const NOW = new Date("2026-11-12T15:00:00Z");
const DAY = 86_400_000;
const hex = (c: string) => c.repeat(64);

const LIVE = hex("a");
const REPLACED = hex("b");
const TRASHED = hex("c");
const REMOVED = hex("d");
const STRAY = hex("e");

const entry = (key: string, sha256: string, bytes: number, deleted = false): AssetEntry => ({
  key,
  id: key,
  kind: "texture",
  path: `art/${key}.png`,
  sha256,
  bytes,
  created: { at: 1, by: "staff" },
  ...(deleted ? { deleted: { at: 2, by: "staff" } } : {}),
});

/** A live asset with a replaced version, a trashed asset, and history of a key that is gone. */
const registry: ProjectState = {
  ...emptyProjectState(PROJECT, "Kitchen"),
  assets: { hero: entry("hero", LIVE, 10), crate: entry("crate", TRASHED, 7, true) },
  history: {
    hero: [
      { sha256: REPLACED, bytes: 5, at: 1, by: "staff" },
      { sha256: LIVE, bytes: 10, at: 2, by: "staff" },
    ],
    crate: [{ sha256: TRASHED, bytes: 7, at: 1, by: "staff" }],
    ghost: [{ sha256: REMOVED, bytes: 3, at: 1, by: "staff" }],
  },
};

const blob = (sha256: string, byteSize: number) => ({
  projectId: PROJECT,
  sha256,
  byteSize,
  contentType: "image/png",
  storageKey: `engine-assets/${PROJECT}/${sha256}`,
});

const releaseId = (version: number) => version.toString(16).padStart(64, "0");

const release = (
  version: number,
  opts: { totalBytes?: number; at?: Date; collected?: boolean },
) => ({
  id: releaseId(version),
  projectId: PROJECT,
  version,
  manifest: opts.collected ? null : "{}",
  manifestBytes: 2,
  totalBytes: opts.totalBytes ?? 1_000,
  fileCount: 2,
  engineVersion: "0.14.1",
  gameId: "kitchen",
  snapshot: hex("1"),
  buildHash: hex("2"),
  target: "web",
  createdAt: opts.at ?? new Date(NOW.getTime() - 20 * DAY),
  collectedAt: opts.collected ? new Date(NOW.getTime() - DAY) : null,
});

let db: TestDb;

beforeEach(async () => {
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
  await db.delete(engineReleaseJamLinks);
  await db.delete(engineReleaseChannels);
  await db.delete(engineReleaseFiles);
  await db.delete(engineReleaseObjects);
  await db.delete(engineReleases);
  await db.delete(sceneDocs);
  await db.delete(engineAssetDocs);
  await db.delete(itchJams);
  await seedEngine(db);
});

describe("storedUsage: assets and docs", () => {
  beforeEach(async () => {
    await db
      .update(engineProjects)
      .set({ state: Buffer.from(seedProjectState(registry)) })
      .where(eq(engineProjects.projectId, PROJECT));
    await db
      .insert(engineBlobs)
      .values([
        blob(LIVE, 10),
        blob(REPLACED, 5),
        blob(TRASHED, 7),
        blob(REMOVED, 3),
        blob(STRAY, 2),
      ]);
    await db
      .insert(sceneDocs)
      .values({ sceneId: `${PROJECT}.level-1`, projectId: PROJECT, byteSize: 40 });
    await db
      .insert(engineAssetDocs)
      .values({ projectId: PROJECT, assetKey: "steel", kind: "material", byteSize: 2 });
  });

  it("counts every stored blob, the trash and replaced versions included", async () => {
    const usage = await storedUsage(db, PROJECT, NOW);
    expect(usage).toMatchObject({
      blobBytes: 27,
      liveBlobBytes: 10,
      trashBytes: 7,
      trashAssets: 1,
      historyBytes: 10,
      docs: 2,
      docBytes: 42,
    });
    expect(usage.liveBlobBytes + usage.trashBytes + usage.historyBytes).toBe(usage.blobBytes);
  });

  it("counts every blob as live when the registry can't be read", async () => {
    await db
      .update(engineProjects)
      .set({ state: null })
      .where(eq(engineProjects.projectId, PROJECT));
    expect(await storedUsage(db, PROJECT, NOW)).toMatchObject({
      blobBytes: 27,
      liveBlobBytes: 27,
      trashBytes: 0,
      trashAssets: 0,
      historyBytes: 0,
    });
  });

  it("is zero for a project with nothing stored", async () => {
    await db.delete(engineBlobs);
    await db.delete(sceneDocs);
    await db.delete(engineAssetDocs);
    expect(await storedUsage(db, PROJECT, NOW)).toEqual({
      blobBytes: 0,
      liveBlobBytes: 0,
      trashBytes: 0,
      trashAssets: 0,
      historyBytes: 0,
      docs: 0,
      docBytes: 0,
      releases: 0,
      keptReleases: 0,
      pinned: { channels: 0, jams: 0 },
      releaseStorageBytes: 0,
      largestRelease: null,
      releasesToday: 0,
      nextCollection: [],
    });
  });
});

describe("storedUsage: releases", () => {
  const SHARED = hex("f");
  const OWN = hex("9");

  beforeEach(async () => {
    await db.insert(engineBlobs).values(blob(LIVE, 10));
    await db
      .insert(engineReleases)
      .values([
        release(1, { totalBytes: 90_000_000, collected: true }),
        ...Array.from({ length: 11 }, (_, i) =>
          release(i + 2, { totalBytes: i === 3 ? 5_000 : 1_000 }),
        ),
        release(13, { at: new Date(NOW.getTime() - 3_600_000) }),
      ]);
    await db.insert(engineReleaseObjects).values([
      {
        projectId: PROJECT,
        sha256: SHARED,
        bytes: 100,
        contentType: "text/javascript",
        storageKey: "k1",
      },
      {
        projectId: PROJECT,
        sha256: OWN,
        bytes: 50,
        contentType: "application/json",
        storageKey: "k2",
      },
    ]);
    await db.insert(engineReleaseFiles).values([
      {
        releaseId: releaseId(2),
        projectId: PROJECT,
        path: "index.js",
        sha256: SHARED,
        bytes: 100,
        role: "code",
        source: "release",
      },
      {
        releaseId: releaseId(2),
        projectId: PROJECT,
        path: "art/hero.png",
        sha256: LIVE,
        bytes: 10,
        role: "asset",
        source: "blob",
      },
      {
        releaseId: releaseId(3),
        projectId: PROJECT,
        path: "index.js",
        sha256: SHARED,
        bytes: 100,
        role: "code",
        source: "release",
      },
      {
        releaseId: releaseId(3),
        projectId: PROJECT,
        path: "data.json",
        sha256: OWN,
        bytes: 50,
        role: "data",
        source: "release",
      },
      {
        releaseId: releaseId(3),
        projectId: PROJECT,
        path: "art/hero.png",
        sha256: LIVE,
        bytes: 10,
        role: "asset",
        source: "blob",
      },
    ]);
    await db.insert(engineReleaseChannels).values([
      { projectId: PROJECT, channel: "production", releaseId: releaseId(12) },
      { projectId: PROJECT, channel: "preview", releaseId: releaseId(13) },
    ]);
    await db.insert(itchJams).values({ jamId: 77, slug: "jam-77", title: "Jam", status: "over" });
    await db
      .insert(engineReleaseJamLinks)
      .values({ projectId: PROJECT, jamId: 77, releaseId: releaseId(2) });
  });

  it("counts each stored release object once and never a blob-sourced file", async () => {
    const usage = await storedUsage(db, PROJECT, NOW);
    expect(usage.releaseStorageBytes).toBe(150);
    expect(usage.blobBytes).toBe(10);
  });

  it("counts versions, kept versions, pins, the largest kept release and today's", async () => {
    expect(await storedUsage(db, PROJECT, NOW)).toMatchObject({
      releases: 13,
      keptReleases: 12,
      pinned: { channels: 2, jams: 1 },
      largestRelease: { version: 5, bytes: 5_000 },
      releasesToday: 1,
    });
  });

  it("forecasts the unpinned releases beyond the newest kept, as ISO dates", async () => {
    const { nextCollection } = await storedUsage(db, PROJECT, NOW);
    // v2 and v3 are outside the newest ten; v2 is the jam's version.
    expect(nextCollection.map((c) => c.version)).toEqual([3]);
    expect(new Date(nextCollection[0]!.at).getTime()).toBeGreaterThanOrEqual(NOW.getTime());
    expect(nextCollection[0]!.at).toMatch(/^\d{4}-\d\d-\d\dT/);
  });

  it("answers getProjectUsage with the usage and one line per quota", async () => {
    const { usage, lines } = await projectUsageReport(PROJECT, NOW);
    expect(usage.releaseStorageBytes).toBe(150);
    expect(lines.find((l) => l.quota === "releaseStorageBytes")).toMatchObject({
      used: 150,
      max: PROJECT_QUOTA.releaseStorageBytes,
      level: "ok",
    });
    expect(lines.find((l) => l.quota === "jamPins")).toMatchObject({ used: 1 });
  });

  it("reports the lines with a new release stored", async () => {
    const usage = await storedUsage(db, PROJECT, NOW);
    const { before, after } = releaseUsageReport(usage, {
      version: 14,
      totalBytes: 9_000,
      addsBytes: 30,
    });
    const of = (lines: typeof before, quota: string) => lines.find((l) => l.quota === quota)!.used;
    expect(of(before, "releaseStorageBytes")).toBe(150);
    expect(of(after, "releaseStorageBytes")).toBe(180);
    expect(of(after, "releasesPerDay")).toBe(2);
    expect(of(after, "releaseBytes")).toBe(9_000);
  });
});
