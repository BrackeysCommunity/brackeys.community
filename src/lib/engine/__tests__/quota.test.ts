import type { ProjectUsage, QuotaPolicy } from "@jams/engine/project";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { engineAssetDocs, engineBlobs, sceneDocs } from "@/db/schema";
import { formatBytes, formatCount } from "@/lib/format-bytes";
import { SITE } from "@/lib/legal-meta";
import type { TestDb } from "@/test/db";

import {
  BLOB_GRACE_DAYS,
  LIVE_LIMITS,
  PROJECT_QUOTA,
  QUOTA_WARN_RATIO,
  RELEASE_GRACE_DAYS,
} from "../limits";
import {
  checkJamPinQuota,
  checkLiveChannelQuota,
  checkLiveQuota,
  checkQuota,
  checkReleaseQuota,
  ENGINE_QUOTA,
  quotaAmount,
  quotaLabel,
  siteQuotaPolicy,
  UNLIMITED_QUOTA,
  usageLevel,
  usageLines,
  usageNotice,
  type LiveQuotaInput,
  type QuotaName,
  type ReleaseQuotaInput,
  type SiteQuotaVerdict,
  type StoredUsageCounts,
} from "../quota";
import { storedProjectUsage } from "../usage";
import { fakeMinio } from "./fake-minio";
import { engineRoutes, PNG, PROJECT, seedEngine, upload } from "./harness";

vi.mock("@/db", async () => {
  const { createTestDb } = await import("@/test/db");
  return { db: await createTestDb() } as unknown as typeof import("@/db");
});
vi.mock("@/lib/profile-project-image-storage", async () => {
  const { isMissingObjectError } = await import("./fake-minio");
  return { getMinioClient: () => null, isMissingObject: isMissingObjectError };
});
vi.mock("@/lib/media-scan", () => ({ requestUploadScan: async () => {} }));
vi.mock("@/lib/posthog-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/posthog-server")>()),
  isServerFlagEnabled: async () => true,
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => true }));

const MiB = 1_048_576;
const emptyUsage: ProjectUsage = { docs: 0, docBytes: 0, blobs: 0, blobBytes: 0, trashBytes: 0 };

const refused = (verdict: SiteQuotaVerdict) => {
  if (verdict.ok) throw new Error("expected a refusal");
  return verdict;
};

describe("quotaLabel", () => {
  const ALL: QuotaName[] = [
    "assetBytes",
    "docs",
    "docBytes",
    "releaseBytes",
    "releaseFiles",
    "releaseFileBytes",
    "releaseStorageBytes",
    "jamPins",
    "releasesPerDay",
    "liveVersionBytes",
    "liveVersionsPerDay",
  ];

  it("names every quota once, in lower case for the middle of a sentence", () => {
    const labels = ALL.map(quotaLabel);
    expect(new Set(labels).size).toBe(ALL.length);
    for (const label of labels) expect(label).toBe(label.toLowerCase());
    expect(quotaLabel("assetBytes")).toBe("asset storage");
    expect(quotaLabel("releaseStorageBytes")).toBe("release storage");
    expect(quotaLabel("jamPins")).toBe("jam versions");
    expect(quotaLabel("liveVersionsPerDay")).toBe("scene versions today");
  });

  it("writes an amount in the quota's own unit", () => {
    expect(quotaAmount("releaseStorageBytes", 440 * MiB)).toBe(formatBytes(440 * MiB));
    expect(quotaAmount("docs", 1_000)).toBe(formatCount(1_000));
    expect(quotaAmount("jamPins", 8)).toBe("8");
    expect(quotaAmount("liveVersionBytes", 2 * MiB)).toBe("2 MB");
    expect(quotaAmount("liveVersionsPerDay", 100)).toBe("100");
  });
});

describe("siteQuotaPolicy", () => {
  const policy = siteQuotaPolicy();
  const max = PROJECT_QUOTA.assetBytes;
  const atBlobBytes = (blobBytes: number): ProjectUsage => ({ ...emptyUsage, blobs: 1, blobBytes });

  it.each([
    ["max - 1", max - 2, true],
    ["max", max - 1, true],
    ["max + 1", max, false],
  ])("holds asset storage at %s after the upload", (_, stored, ok) => {
    expect(policy.check(atBlobBytes(stored), { blobs: 1, blobBytes: 1 }).ok).toBe(ok);
  });

  it("refuses asset storage with the limit, what the project holds, the max and the words", () => {
    const verdict = refused(
      policy.check(atBlobBytes(251 * MiB), { blobs: 1, blobBytes: 12 * MiB }),
    );
    expect(verdict).toEqual({
      ok: false,
      limit: "assetBytes",
      used: 251 * MiB,
      max,
      message: `This project's asset storage is full: 251 MB of ${formatBytes(max)} used, and this file is 12 MB.`,
      hint: `Empty the trash or delete assets you don't use. Replaced versions free up ${BLOB_GRACE_DAYS} days after they were replaced.`,
    });
    expect(verdict.message).toContain("256 MB");
  });

  it.each([
    ["max - 1", PROJECT_QUOTA.docs - 2, true],
    ["max", PROJECT_QUOTA.docs - 1, true],
    ["max + 1", PROJECT_QUOTA.docs, false],
  ])("holds the document count at %s after the new doc", (_, docs, ok) => {
    expect(policy.check({ ...emptyUsage, docs }, { docs: 1 }).ok).toBe(ok);
  });

  it("refuses a document past the count in the stated words", () => {
    const verdict = refused(policy.check({ ...emptyUsage, docs: 1_000 }, { docs: 1 }));
    expect(verdict).toMatchObject({ limit: "docs", used: 1_000, max: 1_000 });
    expect(verdict.message).toBe(
      `This project already has ${formatCount(PROJECT_QUOTA.docs)} documents, the most a hosted project can have.`,
    );
    expect(verdict.message).toContain("1,000");
    expect(verdict.hint).toBe(
      "Delete scenes, prefabs or data you don't use, then empty the trash.",
    );
  });

  it.each([
    ["max - 1", PROJECT_QUOTA.docBytes - 1, true],
    ["max", PROJECT_QUOTA.docBytes, true],
    ["max + 1", PROJECT_QUOTA.docBytes + 1, false],
  ])("checks document bytes at %s when a doc is created", (_, docBytes, ok) => {
    expect(policy.check({ ...emptyUsage, docs: 1, docBytes }, { docs: 1 }).ok).toBe(ok);
  });

  it("never checks document bytes for a blob upload or a store", () => {
    const over = { ...emptyUsage, docs: 1, docBytes: PROJECT_QUOTA.docBytes * 2 };
    expect(policy.check(over, { blobs: 1, blobBytes: 1 }).ok).toBe(true);
    expect(policy.check(over, {}).ok).toBe(true);
    const verdict = refused(policy.check(over, { docs: 1 }));
    expect(verdict).toMatchObject({ limit: "docBytes", max: PROJECT_QUOTA.docBytes });
    expect(verdict.message).toBe(
      `This project's documents use ${formatBytes(over.docBytes)}, the most a hosted project can store.`,
    );
  });

  it("takes a staff-raised project's numbers only through the parameter", () => {
    const raised = siteQuotaPolicy({ overrides: { docs: 1_500 } });
    expect(raised.check({ ...emptyUsage, docs: 1_200 }, { docs: 1 }).ok).toBe(true);
    expect(refused(raised.check({ ...emptyUsage, docs: 1_500 }, { docs: 1 }))).toMatchObject({
      limit: "docs",
      max: 1_500,
    });
    expect(siteQuotaPolicy().check({ ...emptyUsage, docs: 1_200 }, { docs: 1 }).ok).toBe(false);
    expect(PROJECT_QUOTA.docs).toBe(1_000);
  });

  it("is what hosted projects are held to", () => {
    expect(ENGINE_QUOTA.check(atBlobBytes(max), { blobs: 1, blobBytes: 1 })).toMatchObject({
      ok: false,
      limit: "assetBytes",
    });
  });
});

describe("checkReleaseQuota", () => {
  const small: ReleaseQuotaInput = {
    totalBytes: 10 * MiB,
    files: 40,
    largestFile: { path: "assets/theme.ogg", bytes: 4 * MiB },
    addsBytes: 2 * MiB,
    today: 0,
    project: "tactics",
  };
  const stored = { releaseStorageBytes: 0 };
  const check = (release: Partial<ReleaseQuotaInput>, storage = 0) =>
    checkReleaseQuota({ releaseStorageBytes: storage }, { ...small, ...release });

  it("lets a small release through", () => {
    expect(checkReleaseQuota(stored, small)).toEqual({ ok: true });
  });

  const cases: [QuotaName, (n: number) => SiteQuotaVerdict, number][] = [
    ["releaseBytes", (n) => check({ totalBytes: n }), PROJECT_QUOTA.releaseBytes],
    ["releaseFiles", (n) => check({ files: n }), PROJECT_QUOTA.releaseFiles],
    [
      "releaseFileBytes",
      (n) => check({ largestFile: { path: "assets/theme.ogg", bytes: n } }),
      PROJECT_QUOTA.releaseFileBytes,
    ],
    [
      "releaseStorageBytes",
      (n) => check({ addsBytes: 1 }, n - 1),
      PROJECT_QUOTA.releaseStorageBytes,
    ],
    ["releasesPerDay", (n) => check({ today: n - 1 }), PROJECT_QUOTA.releasesPerDay],
  ];

  it.each(cases)("holds %s at max - 1, max and max + 1", (limit, at, max) => {
    expect(at(max - 1).ok).toBe(true);
    expect(at(max).ok).toBe(true);
    expect(refused(at(max + 1)).limit).toBe(limit);
    expect(refused(at(max + 1)).max).toBe(max);
  });

  it("words a too-large release with the largest file and the export command", () => {
    const verdict = refused(
      check({ totalBytes: 131 * MiB, largestFile: { path: "assets/theme.ogg", bytes: 30 * MiB } }),
    );
    expect(verdict).toMatchObject({ limit: "releaseBytes", used: 131 * MiB });
    expect(verdict.message).toBe(
      `This release is 131 MB; releases on ${SITE.name} are limited to ${formatBytes(PROJECT_QUOTA.releaseBytes)}.`,
    );
    expect(verdict.hint).toBe(
      "The largest file is assets/theme.ogg (30 MB). Shrink it, or export for itch.io instead: vp run scene game export tactics --zip",
    );
  });

  it("words the file count, the largest file, storage and the day", () => {
    expect(refused(check({ files: 2_412 })).message).toBe(
      `This release has 2,412 files; releases on ${SITE.name} are limited to ${formatCount(PROJECT_QUOTA.releaseFiles)}.`,
    );
    expect(
      refused(check({ largestFile: { path: "assets/theme.ogg", bytes: 48 * MiB } })).message,
    ).toBe(
      `assets/theme.ogg is 48 MB; one file in a release is limited to ${formatBytes(PROJECT_QUOTA.releaseFileBytes)}.`,
    );
    const storage = refused(check({ addsBytes: 30 * MiB }, 498 * MiB));
    expect(storage).toMatchObject({ used: 498 * MiB, max: PROJECT_QUOTA.releaseStorageBytes });
    expect(storage.message).toBe(
      `This release adds 30 MB, and the project's releases already use 498 MB of ${formatBytes(PROJECT_QUOTA.releaseStorageBytes)}.`,
    );
    expect(storage.hint).toContain(
      `outside the 10 newest are removed ${RELEASE_GRACE_DAYS} days after publishing unless pinned`,
    );
    const day = refused(check({ today: 20 }));
    expect(day.message).toBe(
      `This project has published ${PROJECT_QUOTA.releasesPerDay} releases today, the most per day.`,
    );
    expect(day.hint).toBe("Try again after midnight UTC.");
  });

  it("answers the first quota that refuses: size before files before storage", () => {
    expect(refused(check({ totalBytes: 200 * MiB, files: 3_000 }, 600 * MiB)).limit).toBe(
      "releaseBytes",
    );
    expect(refused(check({ files: 3_000, today: 30 }, 600 * MiB)).limit).toBe("releaseFiles");
    expect(refused(check({ today: 30 }, 600 * MiB)).limit).toBe("releaseStorageBytes");
  });

  it("takes overrides only through the parameter", () => {
    const release = { ...small, totalBytes: 150 * MiB };
    expect(checkReleaseQuota(stored, release).ok).toBe(false);
    expect(checkReleaseQuota(stored, release, { overrides: { releaseBytes: 200 * MiB } })).toEqual({
      ok: true,
    });
  });
});

describe("checkLiveQuota", () => {
  const small: LiveQuotaInput = { dataBytes: 14 * 1_024, addsBytes: 4 * 1_024, today: 6 };
  const check = (version: Partial<LiveQuotaInput>, storage = 0) =>
    checkLiveQuota({ releaseStorageBytes: storage }, { ...small, ...version });

  it("lets a small version through", () => {
    expect(check({})).toEqual({ ok: true });
  });

  const cases: [QuotaName, (n: number) => SiteQuotaVerdict, number][] = [
    ["liveVersionBytes", (n) => check({ dataBytes: n }), LIVE_LIMITS.versionDataBytes],
    [
      "releaseStorageBytes",
      (n) => check({ addsBytes: 1 }, n - 1),
      PROJECT_QUOTA.releaseStorageBytes,
    ],
    ["liveVersionsPerDay", (n) => check({ today: n - 1 }), LIVE_LIMITS.versionsPerDay],
  ];

  it.each(cases)("holds %s at max - 1, max and max + 1", (limit, at, max) => {
    expect(at(max - 1).ok).toBe(true);
    expect(at(max).ok).toBe(true);
    expect(refused(at(max + 1)).limit).toBe(limit);
    expect(refused(at(max + 1)).max).toBe(max);
  });

  it("words a too-large version with its size and the cap", () => {
    const verdict = refused(check({ dataBytes: 2.4 * MiB }));
    expect(verdict).toMatchObject({
      limit: "liveVersionBytes",
      used: 2.4 * MiB,
      max: LIVE_LIMITS.versionDataBytes,
    });
    expect(verdict.message).toBe(
      `This scene version is 2.4 MB; a live scene's data is limited to ${formatBytes(LIVE_LIMITS.versionDataBytes)}.`,
    );
    expect(verdict.hint).toBe(
      "Split the level into sublevels, or move repeated entities into a prefab or bulk entries.",
    );
  });

  it("skips the day's count for a version already stored", () => {
    expect(check({ today: null })).toEqual({ ok: true });
    expect(refused(check({ today: null, dataBytes: 3 * MiB })).limit).toBe("liveVersionBytes");
  });

  it("words the day's count from the limit", () => {
    const verdict = refused(check({ today: LIVE_LIMITS.versionsPerDay }));
    expect(verdict).toMatchObject({ limit: "liveVersionsPerDay", used: 100, max: 100 });
    expect(verdict.message).toBe(
      `This project has published ${LIVE_LIMITS.versionsPerDay} scene versions today, the most per day.`,
    );
    expect(verdict.hint).toBe("Try again after midnight UTC, or publish a release.");
  });

  it("words release storage as the scene version's addition", () => {
    const verdict = refused(check({ addsBytes: 30 * MiB }, 498 * MiB));
    expect(verdict).toMatchObject({
      limit: "releaseStorageBytes",
      used: 498 * MiB,
      max: PROJECT_QUOTA.releaseStorageBytes,
    });
    expect(verdict.message).toBe(
      `This scene version adds 30 MB, and the project's releases already use 498 MB of ${formatBytes(PROJECT_QUOTA.releaseStorageBytes)}.`,
    );
    expect(verdict.hint).toContain(
      `each scene keeps its ${LIVE_LIMITS.keptPerScene} newest versions plus those on a channel`,
    );
  });

  it("answers the first quota that refuses: data before storage before the day", () => {
    const all = { dataBytes: 3 * MiB, addsBytes: 30 * MiB, today: 100 };
    expect(refused(check(all, 500 * MiB)).limit).toBe("liveVersionBytes");
    expect(refused(check({ ...all, dataBytes: 1 }, 500 * MiB)).limit).toBe("releaseStorageBytes");
    expect(refused(check({ ...all, dataBytes: 1 })).limit).toBe("liveVersionsPerDay");
  });

  it("takes a staff-raised release storage through the parameter, never the live caps", () => {
    const stored = { releaseStorageBytes: 512 * MiB };
    expect(checkLiveQuota(stored, small).ok).toBe(false);
    const raised = { overrides: { releaseStorageBytes: 1_024 * MiB } };
    expect(checkLiveQuota(stored, small, raised)).toEqual({ ok: true });
    expect(refused(checkLiveQuota(stored, { ...small, dataBytes: 3 * MiB }, raised)).limit).toBe(
      "liveVersionBytes",
    );
  });
});

describe("checkLiveChannelQuota", () => {
  const max = PROJECT_QUOTA.releaseBytes;

  it("holds a channel's release plus its live scenes at max - 1, max and max + 1", () => {
    expect(checkLiveChannelQuota("production", max - 1).ok).toBe(true);
    expect(checkLiveChannelQuota("production", max).ok).toBe(true);
    expect(refused(checkLiveChannelQuota("production", max + 1))).toMatchObject({
      limit: "releaseBytes",
      used: max + 1,
      max,
    });
  });

  it("words the channel's size with the site's name", () => {
    const verdict = refused(checkLiveChannelQuota("production", 104 * MiB));
    expect(verdict.message).toBe(
      `With this scene the game on production would be 104 MB; a game on ${SITE.name} is limited to ${formatBytes(max)}.`,
    );
    expect(verdict.hint).toBe(
      "Publish a release instead: it replaces the live scenes, so their extra files stop counting.",
    );
  });

  it("takes a staff-raised release size through the parameter", () => {
    expect(
      checkLiveChannelQuota("preview", 150 * MiB, { overrides: { releaseBytes: 200 * MiB } }),
    ).toEqual({ ok: true });
  });
});

describe("checkJamPinQuota", () => {
  it("holds jam pins at the max", () => {
    expect(checkJamPinQuota(PROJECT_QUOTA.jamPins - 1).ok).toBe(true);
    const verdict = refused(checkJamPinQuota(PROJECT_QUOTA.jamPins));
    expect(verdict).toMatchObject({ limit: "jamPins", used: 8, max: 8 });
    expect(verdict.message).toBe(
      `This project already pins ${PROJECT_QUOTA.jamPins} jam versions, the most it can.`,
    );
  });
});

describe("usageLines", () => {
  const stored: StoredUsageCounts = {
    blobBytes: 41 * MiB,
    docs: 212,
    docBytes: 3 * MiB,
    releaseStorageBytes: 120 * MiB,
    largestRelease: { version: 7, bytes: 38 * MiB },
    pinned: { channels: 2, jams: 1 },
    releasesToday: 3,
    liveToday: 6,
  };

  it("gives one line per stored quota, each against its max", () => {
    expect(usageLines(stored).map((l) => [l.quota, l.used, l.max])).toEqual([
      ["assetBytes", 41 * MiB, PROJECT_QUOTA.assetBytes],
      ["docs", 212, PROJECT_QUOTA.docs],
      ["docBytes", 3 * MiB, PROJECT_QUOTA.docBytes],
      ["releaseBytes", 38 * MiB, PROJECT_QUOTA.releaseBytes],
      ["releaseStorageBytes", 120 * MiB, PROJECT_QUOTA.releaseStorageBytes],
      ["jamPins", 1, PROJECT_QUOTA.jamPins],
      ["releasesPerDay", 3, PROJECT_QUOTA.releasesPerDay],
      ["liveVersionsPerDay", 6, LIVE_LIMITS.versionsPerDay],
    ]);
    expect(usageLines(stored).every((l) => l.level === "ok")).toBe(true);
  });

  it("warns from the 80% boundary and is full at the max", () => {
    const docsAt = (docs: number) => usageLines({ ...stored, docs })[1]!;
    const boundary = PROJECT_QUOTA.docs * QUOTA_WARN_RATIO;
    expect(docsAt(boundary - 1)).toMatchObject({ level: "ok" });
    expect(docsAt(boundary)).toMatchObject({ level: "warn", ratio: QUOTA_WARN_RATIO });
    expect(docsAt(PROJECT_QUOTA.docs - 1)).toMatchObject({ level: "warn" });
    expect(docsAt(PROJECT_QUOTA.docs)).toMatchObject({ level: "full", ratio: 1 });
    expect(docsAt(PROJECT_QUOTA.docs + 1)).toMatchObject({ level: "full" });
    expect([0.79, 0.8, 0.99, 1].map(usageLevel)).toEqual(["ok", "warn", "warn", "full"]);
  });

  it("warns of today's scene versions from the 80% line", () => {
    const today = (liveToday: number) =>
      usageLines({ ...stored, liveToday }).find((l) => l.quota === "liveVersionsPerDay")!;
    const boundary = LIVE_LIMITS.versionsPerDay * QUOTA_WARN_RATIO;
    expect(today(boundary - 1)).toMatchObject({ level: "ok" });
    expect(today(boundary)).toMatchObject({ level: "warn", ratio: QUOTA_WARN_RATIO });
    expect(today(LIVE_LIMITS.versionsPerDay - 1)).toMatchObject({ level: "warn" });
    expect(today(LIVE_LIMITS.versionsPerDay)).toMatchObject({ level: "full", ratio: 1 });
    expect(today(LIVE_LIMITS.versionsPerDay + 1)).toMatchObject({ level: "full" });
  });

  it("warns of a scene version's data from the 80% line", () => {
    const at = (bytes: number) => usageLevel(bytes / LIVE_LIMITS.versionDataBytes);
    const boundary = LIVE_LIMITS.versionDataBytes * QUOTA_WARN_RATIO;
    expect([boundary - 1, boundary, LIVE_LIMITS.versionDataBytes].map(at)).toEqual([
      "ok",
      "warn",
      "full",
    ]);
  });

  it("counts no release as zero", () => {
    expect(usageLines({ ...stored, largestRelease: null })[3]).toMatchObject({ used: 0 });
  });

  it("measures against a staff-raised project's numbers only when given", () => {
    const raised = usageLines({ ...stored, docs: 900 }, { overrides: { docs: 2_000 } });
    expect(raised[1]).toMatchObject({ max: 2_000, level: "ok" });
    expect(usageLines({ ...stored, docs: 900 })[1]).toMatchObject({ max: 1_000, level: "warn" });
  });

  it("states the nearly-full and full notices from the limits", () => {
    expect(usageNotice("ok")).toBeNull();
    expect(usageNotice("warn")).toBe(
      `Nearly full. Releases outside the ${PROJECT_QUOTA.releasesKept} newest are removed ${RELEASE_GRACE_DAYS} days after publishing unless pinned; unpin jam versions you no longer need.`,
    );
    expect(usageNotice("full")).toBe(
      "Full. New releases are refused until releases are removed or unpinned.",
    );
  });
});

let db: TestDb;

describe("quota at blob upload", () => {
  beforeEach(async () => {
    ({ db } = (await import("@/db")) as unknown as { db: TestDb });
    await db.delete(sceneDocs);
    await db.delete(engineAssetDocs);
    await seedEngine(db);
  });

  /** At most `max` blob bytes per project. */
  const blobBytesAtMost = (max: number) => {
    const seen: { usage: ProjectUsage; add: Partial<ProjectUsage> }[] = [];
    const policy: QuotaPolicy = {
      check(usage, add) {
        seen.push({ usage, add });
        const used = usage.blobBytes + (add.blobBytes ?? 0);
        return used <= max
          ? { ok: true }
          : {
              ok: false,
              limit: "blobBytes",
              used,
              max,
              message: `The project's files would take ${used} bytes; it has room for ${max}.`,
            };
      },
    };
    return { policy, seen };
  };

  it("reaches the client as quota-exceeded with the limit, used and max", async () => {
    const { policy } = blobBytesAtMost(PNG.byteLength + 3);
    const routes = engineRoutes(fakeMinio(), { quota: policy });
    expect((await routes(upload(PNG)))!.status).toBe(201);

    const response = (await routes(upload(new Uint8Array([1, 2, 3, 4]), { kind: "audio" })))!;
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toMatchObject({
      code: "quota-exceeded",
      limit: "blobBytes",
      used: PNG.byteLength + 4,
      max: PNG.byteLength + 3,
      issue: { code: "quota-exceeded", severity: "error" },
    });
    expect(body.message).toContain(String(PNG.byteLength + 3));
    expect(await db.select().from(engineBlobs)).toHaveLength(1);
  });

  it("asks the policy with what the project stores and what the upload adds", async () => {
    const { policy, seen } = blobBytesAtMost(1_000);
    const routes = engineRoutes(fakeMinio(), { quota: policy });
    await routes(upload(PNG));
    await routes(upload(new Uint8Array([9, 9]), { kind: "audio" }));
    expect(seen[1]).toEqual({
      usage: { docs: 0, docBytes: 0, blobs: 1, blobBytes: PNG.byteLength, trashBytes: 0 },
      add: { blobs: 1, blobBytes: 2 },
    });
  });

  it("isn't consulted for bytes the project already holds", async () => {
    const { policy, seen } = blobBytesAtMost(PNG.byteLength);
    const routes = engineRoutes(fakeMinio(), { quota: policy });
    await routes(upload(PNG));
    expect((await routes(upload(PNG)))!.status).toBe(200);
    expect(seen).toHaveLength(1);
  });

  it("holds uploads to the site's asset storage by default, with the words and hint", async () => {
    await db.insert(engineBlobs).values({
      projectId: PROJECT,
      sha256: "a".repeat(64),
      byteSize: PROJECT_QUOTA.assetBytes - 2,
      contentType: "audio/ogg",
      storageKey: `engine-assets/${PROJECT}/${"a".repeat(64)}`,
    });
    const routes = engineRoutes(fakeMinio());
    const response = (await routes(
      upload(new Uint8Array([1, 2, 3]), { kind: "audio", type: "audio/ogg" }),
    ))!;
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: "quota-exceeded",
      limit: "assetBytes",
      used: PROJECT_QUOTA.assetBytes - 2,
      max: PROJECT_QUOTA.assetBytes,
      message: expect.stringContaining("256 MB"),
      hint: expect.stringContaining(`${BLOB_GRACE_DAYS} days`),
      issue: { code: "quota-exceeded", hint: expect.stringContaining("Empty the trash") },
    });
    expect(
      (await routes(upload(new Uint8Array([1, 2]), { kind: "audio", type: "audio/ogg" })))!.status,
    ).toBe(201);
  });

  it("leaves UNLIMITED_QUOTA for dev servers and tests", async () => {
    expect(UNLIMITED_QUOTA.check(await storedProjectUsage(PROJECT), { blobBytes: 1e12 })).toEqual({
      ok: true,
    });
  });
});

describe("storedProjectUsage", () => {
  beforeEach(async () => {
    ({ db } = (await import("@/db")) as unknown as { db: TestDb });
    await db.delete(sceneDocs);
    await db.delete(engineAssetDocs);
    await seedEngine(db);
  });

  it("counts the project's scene and asset docs and its blobs, and nobody else's", async () => {
    await db.insert(sceneDocs).values([
      { sceneId: `${PROJECT}.level-1`, projectId: PROJECT, byteSize: 100 },
      { sceneId: "other.level-1", byteSize: 999 },
    ]);
    await db.insert(engineAssetDocs).values({
      projectId: PROJECT,
      assetKey: "steel",
      kind: "material",
      byteSize: 20,
    });
    await db.insert(engineBlobs).values({
      projectId: PROJECT,
      sha256: "a".repeat(64),
      byteSize: 7,
      contentType: "image/png",
      storageKey: `engine-assets/${PROJECT}/${"a".repeat(64)}`,
    });
    expect(await storedProjectUsage(PROJECT)).toEqual({
      docs: 2,
      docBytes: 120,
      blobs: 1,
      blobBytes: 7,
      trashBytes: 0,
    });
  });
});

describe("checkQuota", () => {
  it("is null when the policy allows", () => {
    expect(checkQuota(UNLIMITED_QUOTA, emptyUsage, { blobs: 1 })).toBeNull();
  });

  it("carries the verdict's numbers and an issue", () => {
    const refusal = checkQuota(
      { check: () => ({ ok: false, limit: "blobBytes", used: 5, max: 0, message: "No room." }) },
      emptyUsage,
      { blobBytes: 5 },
    );
    expect(refusal).toMatchObject({
      code: "quota-exceeded",
      limit: "blobBytes",
      used: 5,
      max: 0,
      issue: { code: "quota-exceeded", got: "5" },
    });
    expect(refusal).not.toHaveProperty("hint");
  });

  it("carries the site policy's hint into the body and the issue", () => {
    const refusal = checkQuota(siteQuotaPolicy(), { ...emptyUsage, docs: 1_000 }, { docs: 1 });
    expect(refusal).toMatchObject({
      limit: "docs",
      used: 1_000,
      max: 1_000,
      hint: "Delete scenes, prefabs or data you don't use, then empty the trash.",
      issue: { hint: "Delete scenes, prefabs or data you don't use, then empty the trash." },
    });
  });
});
