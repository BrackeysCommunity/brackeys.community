import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { and, eq } from "drizzle-orm";
import IORedis from "ioredis";

import {
  formatSceneVersion,
  liveCompat,
  liveCompatKey,
  liveFiles,
  sceneVersionId,
  sha256 as hashText,
  type SceneVersion,
} from "../../../packages/engine/project/index.ts";
import type { AssetEntry } from "../../../packages/engine/project/types.ts";
import {
  engineBlobs,
  engineLiveReports,
  engineProjects,
  engineReleaseAudit,
  engineReleaseChannels,
  engineReleaseFiles,
  engineReleaseObjects,
  engineReleases,
  engineReleaseUploads,
  engineSaves,
  engineSceneChannels,
  engineSceneVersionFiles,
  engineSceneVersions,
  itchTierHeartbeats,
} from "../../../src/db/schema.ts";
import {
  plannedRelease,
  type PlannedRelease,
} from "../../../src/lib/engine/__tests__/release-fixture.ts";
import {
  engineAssetKey,
  engineReleaseObjectKey,
  engineSaveKey,
} from "../../../src/lib/engine/storage-keys.ts";
import {
  ENGINE_RELEASE_NOTICE_CHANNEL,
  type EngineReleaseNotice,
  parseEngineReleaseNotice,
} from "../../../src/lib/image-quarantine.ts";
import { emptyProjectState, seedProjectState } from "../../../src/lib/scene/project-bytes.ts";
import {
  COLLECTOR_LOCK_SECONDS,
  COLLECTOR_TIER,
  type CollectorDb,
  type CollectorOptions,
  redisCollectorLock,
  redisReleaseNotice,
  runCollector,
  soloCollectorLock,
  startCollectorTimer,
} from "../src/engine/collector.ts";
import { MemoryObjectStore } from "../src/engine/object-store.ts";
import { FakeRedis } from "./fake-redis.ts";
import { newProjectId, seedUser, TEST_DATABASE_URL, testDb, warnSkipped } from "./harness.ts";

const quiet = { captureException() {}, capture() {}, async shutdown() {} };
const DAY = 86_400_000;
const HOUR = 3_600_000;
/** The fake clock's start: a run's time, well clear of the rows other suites write. */
const T0 = new Date("2031-03-10T03:30:00.000Z");
const at = (offsetMs: number) => new Date(T0.getTime() + offsetMs);
const hex = (c: string) => c.repeat(64);

describe("the collector's lock", () => {
  const redis = new FakeRedis();
  const clients: IORedis[] = [];
  const client = () => {
    const c = new IORedis(redis.url, { maxRetriesPerRequest: 1 });
    clients.push(c);
    return c;
  };
  beforeAll(async () => {
    await redis.start();
  });
  afterAll(async () => {
    for (const c of clients) c.disconnect();
    await redis.stop();
  });

  it("a second replica can't take the lock", async () => {
    const first = redisCollectorLock(client(), "test:canvas-sync", "replica-a");
    const second = redisCollectorLock(client(), "test:canvas-sync", "replica-b");
    expect(first.key).toBe("test:canvas-sync:engine:collector:lock");
    expect(await first.acquire()).toBe(true);
    expect(redis.ttl(first.key)).toBeGreaterThan(COLLECTOR_LOCK_SECONDS - 5);

    const lines: string[] = [];
    // The run stops at the lock, before it reads anything.
    const run = await runCollector({
      db: {} as CollectorDb,
      objects: new MemoryObjectStore(),
      lock: second,
      mode: "delete",
      telemetry: quiet,
      log: (line) => lines.push(line),
    });
    expect(run).toEqual({ ran: false, reason: "locked" });
    expect(lines.join("\n")).toContain("another instance holds the lock");
    expect(await second.acquire()).toBe(false);

    // Another environment sharing the Redis has its own lock.
    expect(await redisCollectorLock(client(), "other:canvas-sync", "replica-c").acquire()).toBe(
      true,
    );
  }, 15_000);

  it("a Redis that errors skips the run", async () => {
    const failing = {
      set: async (): Promise<string | null> => {
        throw new Error("connection refused");
      },
    };
    const db = {
      insert: () => {
        throw new Error("no database here");
      },
    } as unknown as CollectorDb;
    const run = await runCollector({
      db,
      objects: null,
      lock: redisCollectorLock(failing, "test:canvas-sync", "a"),
      mode: "delete",
      telemetry: quiet,
      log: () => {},
    });
    expect(run).toEqual({ ran: false, reason: "lock-failed" });
  }, 5_000);
});

describe("the collector's release notice", () => {
  const redis = new FakeRedis();
  const clients: IORedis[] = [];
  beforeAll(async () => {
    await redis.start();
  });
  afterAll(async () => {
    for (const c of clients) c.disconnect();
    await redis.stop();
  });

  it("reaches a subscriber on the frame cache's channel as a notice it parses", async () => {
    const publisher = new IORedis(redis.url, { maxRetriesPerRequest: 1 });
    const subscriber = new IORedis(redis.url, { maxRetriesPerRequest: 1 });
    clients.push(publisher, subscriber);
    const heard = new Promise<[string, string]>((resolve) =>
      subscriber.on("message", (channel: string, message: string) => resolve([channel, message])),
    );
    await subscriber.subscribe(ENGINE_RELEASE_NOTICE_CHANNEL);

    await redisReleaseNotice(publisher)({ releaseIds: [hex("a"), hex("b")], projectIds: [] });

    const [channel, message] = await heard;
    expect(channel).toBe(ENGINE_RELEASE_NOTICE_CHANNEL);
    expect(parseEngineReleaseNotice(message)).toEqual({
      releaseIds: [hex("a"), hex("b")],
      projectIds: [],
    });
  }, 15_000);
});

describe("the collector's timer", () => {
  it("runs at 03:30 UTC and stops between runs", async () => {
    // 40 ms before the run, by a clock that only this test reads.
    const offset = new Date("2031-03-10T03:29:59.960Z").getTime() - Date.now();
    let runs = 0;
    const stop = startCollectorTimer(
      async () => {
        runs++;
      },
      () => new Date(Date.now() + offset),
    );
    const deadline = Date.now() + 3_000;
    while (runs === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
    await stop();
    expect(runs).toBe(1);
  }, 5_000);
});

if (TEST_DATABASE_URL) {
  describe("the collector on Postgres", () => {
    let db: ReturnType<typeof testDb>["db"];
    let end: () => Promise<void>;
    beforeAll(() => {
      ({ db, end } = testDb());
    });
    afterAll(async () => {
      await end();
    });

    /** The releases the last runs purged from the edge, in order. */
    const purged: string[] = [];

    function collector(
      projects: string[],
      options: Partial<CollectorOptions> & { at: Date; lines?: string[] },
    ) {
      const { at: now, lines, ...rest } = options;
      return runCollector({
        db,
        objects: new MemoryObjectStore(),
        lock: soloCollectorLock,
        mode: "delete",
        telemetry: quiet,
        now: () => now,
        log: (line) => lines?.push(line),
        projects,
        pause: async () => {},
        purge: async (releaseId) => void purged.push(releaseId),
        ...rest,
      });
    }

    async function seedProject(
      projectId: string,
      options: { entries?: AssetEntry[]; deletedAt?: Date } = {},
    ): Promise<void> {
      const state = emptyProjectState(projectId, projectId);
      const assets: Record<string, AssetEntry> = {};
      for (const entry of options.entries ?? []) assets[entry.key] = entry;
      await db.insert(engineProjects).values({
        projectId,
        name: projectId,
        state: Buffer.from(seedProjectState({ ...state, assets })),
        deletedAt: options.deletedAt ?? null,
        createdAt: at(-120 * DAY),
      });
    }

    async function seedBlob(
      store: MemoryObjectStore,
      projectId: string,
      sha256: string,
      createdAt: Date,
      bytes = 10,
    ): Promise<string> {
      const storageKey = engineAssetKey(projectId, sha256);
      await db
        .insert(engineBlobs)
        .values({
          projectId,
          sha256,
          byteSize: bytes,
          contentType: "image/png",
          storageKey,
          createdAt,
        })
        .onConflictDoNothing();
      store.put(storageKey);
      return storageKey;
    }

    async function seedObject(
      store: MemoryObjectStore,
      projectId: string,
      sha256: string,
      createdAt: Date,
      bytes = 10,
    ): Promise<string> {
      const storageKey = engineReleaseObjectKey(projectId, sha256);
      await db
        .insert(engineReleaseObjects)
        .values({
          projectId,
          sha256,
          bytes,
          contentType: "application/json",
          storageKey,
          createdAt,
        })
        .onConflictDoNothing();
      store.put(storageKey);
      return storageKey;
    }

    /** The hashes of a release's blob-stored assets; their files are served from the project's blobs. */
    const blobHashes = (release: PlannedRelease) =>
      new Set(
        Object.values(release.manifest.assets)
          .filter((a) => a.storage === "blob")
          .map((a) => a.sha256),
      );

    /** A committed release as the upload leaves it: the row, its file rows and their objects. */
    async function seedRelease(
      store: MemoryObjectStore,
      projectId: string,
      version: number,
      createdAt: Date,
    ): Promise<PlannedRelease> {
      const release = await plannedRelease({ projectId, hallVariant: version });
      const { manifest } = release;
      const blobs = blobHashes(release);
      await db.insert(engineReleases).values({
        id: release.releaseId,
        projectId,
        version,
        manifest: release.text,
        manifestBytes: new TextEncoder().encode(release.text).length,
        totalBytes: manifest.build.files.reduce((sum, f) => sum + f.bytes, 0),
        fileCount: manifest.build.files.length,
        engineVersion: manifest.engine.version,
        gameId: manifest.game.id,
        snapshot: manifest.project.snapshot,
        buildHash: manifest.build.hash,
        target: manifest.build.target,
        createdAt,
      });
      for (const file of manifest.build.files) {
        const source = blobs.has(file.sha256) ? "blob" : "release";
        if (source === "blob") await seedBlob(store, projectId, file.sha256, createdAt, file.bytes);
        else await seedObject(store, projectId, file.sha256, createdAt, file.bytes);
        await db.insert(engineReleaseFiles).values({
          releaseId: release.releaseId,
          projectId,
          path: file.path,
          sha256: file.sha256,
          bytes: file.bytes,
          role: file.role,
          source,
        });
      }
      return release;
    }

    const releaseRow = async (id: string) =>
      (await db.select().from(engineReleases).where(eq(engineReleases.id, id)))[0];
    const fileCount = async (releaseId: string) =>
      (
        await db
          .select({ path: engineReleaseFiles.path })
          .from(engineReleaseFiles)
          .where(eq(engineReleaseFiles.releaseId, releaseId))
      ).length;
    const objectRow = async (projectId: string, sha256: string) =>
      (
        await db
          .select()
          .from(engineReleaseObjects)
          .where(
            and(
              eq(engineReleaseObjects.projectId, projectId),
              eq(engineReleaseObjects.sha256, sha256),
            ),
          )
      )[0];
    const objectCount = async (projectId: string) =>
      (
        await db
          .select({ sha256: engineReleaseObjects.sha256 })
          .from(engineReleaseObjects)
          .where(eq(engineReleaseObjects.projectId, projectId))
      ).length;
    const blobRow = async (projectId: string, sha256: string) =>
      (
        await db
          .select()
          .from(engineBlobs)
          .where(and(eq(engineBlobs.projectId, projectId), eq(engineBlobs.sha256, sha256)))
      )[0];

    /** Twelve releases a month old; the second is production's, so only the first is beyond the kept set. */
    async function twelveReleases(store: MemoryObjectStore, projectId: string) {
      const releases: PlannedRelease[] = [];
      for (let v = 1; v <= 12; v++)
        releases.push(await seedRelease(store, projectId, v, at((v - 40) * DAY)));
      await db.insert(engineReleaseChannels).values({
        projectId,
        channel: "production",
        releaseId: releases[1]!.releaseId,
      });
      return releases;
    }

    const newUserId = () => `u-${crypto.randomUUID().slice(0, 8)}`;

    /** A stored save and its object, last used at `usedAt`. */
    async function seedSave(
      store: MemoryObjectStore,
      save: { userId: string; projectId: string; slot: string; usedAt: Date; bytes?: number },
    ): Promise<string> {
      await db.insert(engineSaves).values({
        userId: save.userId,
        projectId: save.projectId,
        slot: save.slot,
        bytes: save.bytes ?? 100,
        gameVersion: 1,
        meta: { scene: "hall", savedAt: 0, playTicks: 0 },
        writtenAt: save.usedAt,
        usedAt: save.usedAt,
      });
      const key = engineSaveKey(save.userId, save.projectId, save.slot);
      store.put(key);
      return key;
    }

    const saveRows = async (projectId: string) =>
      (
        await db
          .select({ userId: engineSaves.userId, slot: engineSaves.slot })
          .from(engineSaves)
          .where(eq(engineSaves.projectId, projectId))
          .orderBy(engineSaves.slot)
      ).map((r) => r.slot);

    const filesOf = (release: PlannedRelease) =>
      new Set(release.manifest.build.files.map((f) => f.sha256));

    type SeededVersion = { id: string; number: number; sceneId: string; texts: string[] };

    /**
     * A version of the release's second scene as `commit` leaves it: the row,
     * its file rows and the objects of its own texts (its descriptor and the
     * scene). `shared` lists a text the release stores too; `blob` carries a
     * blob in place of the release's texture.
     */
    async function seedVersion(
      store: MemoryObjectStore,
      projectId: string,
      release: PlannedRelease,
      opts: { number: number; createdAt: Date; shared?: string; blob?: string },
    ): Promise<SeededVersion> {
      const { manifest } = release;
      const entry = manifest.flow.scenes.find((s) => s.id !== manifest.flow.start)!;
      const sceneAsset = manifest.assets[entry.id]!;
      const sceneSha = await hashText(`${projectId} ${entry.id} ${opts.number}`);
      const assets: Record<string, SceneVersion["assets"][string]> = {
        [entry.id]: { ...sceneAsset, sha256: sceneSha, file: liveFiles.doc(sceneSha) },
      };
      if (opts.blob) {
        const [blobId, blobAsset] = Object.entries(manifest.assets).find(
          ([, a]) => a.storage === "blob",
        )!;
        assets[blobId] = {
          ...blobAsset,
          sha256: opts.blob,
          file: liveFiles.blob(blobAsset.path, opts.blob),
        };
      }
      const version: SceneVersion = {
        kind: "scene-version",
        v: 1,
        project: projectId,
        scene: entry.id,
        compat: liveCompat(manifest),
        engine: manifest.engine.version,
        base: release.releaseId,
        entry,
        sceneHash: sceneSha.slice(0, 16),
        assets,
      };
      const descriptor = formatSceneVersion(version);
      const id = await sceneVersionId(version);
      const descriptorBytes = new TextEncoder().encode(descriptor).length;
      await db.insert(engineSceneVersions).values({
        id,
        projectId,
        sceneId: entry.id,
        number: opts.number,
        descriptor,
        compatKey: await liveCompatKey(version.compat),
        baseReleaseId: release.releaseId,
        physics: entry.physics,
        sceneHash: sceneSha,
        dataBytes: descriptorBytes + sceneAsset.bytes,
        createdAt: opts.createdAt,
      });
      const rows: (typeof engineSceneVersionFiles.$inferInsert)[] = [
        { sha256: id, bytes: descriptorBytes, role: "version", ext: ".json", source: "release" },
        {
          sha256: sceneSha,
          bytes: sceneAsset.bytes,
          role: "scene",
          ext: ".json",
          source: "release",
        },
      ].map((row) => ({ ...row, versionId: id, projectId }));
      for (const row of rows) await seedObject(store, projectId, row.sha256, opts.createdAt);
      if (opts.shared)
        rows.push({
          versionId: id,
          projectId,
          sha256: opts.shared,
          bytes: 10,
          role: "prefab",
          ext: ".json",
          source: "release",
        });
      if (opts.blob)
        rows.push({
          versionId: id,
          projectId,
          sha256: opts.blob,
          bytes: 10,
          role: "blob",
          ext: ".png",
          source: "blob",
        });
      await db.insert(engineSceneVersionFiles).values(rows);
      return { id, number: opts.number, sceneId: entry.id, texts: [id, sceneSha] };
    }

    /** A release a month old on production, so nothing collects it. */
    async function productionRelease(store: MemoryObjectStore, projectId: string) {
      const release = await seedRelease(store, projectId, 1, at(-60 * DAY));
      await db
        .insert(engineReleaseChannels)
        .values({ projectId, channel: "production", releaseId: release.releaseId });
      return release;
    }

    async function seedReport(versionId: string, userId: string, reportedAt: Date) {
      await seedUser(db, userId);
      await db.insert(engineLiveReports).values({
        versionId,
        userId,
        channel: "preview",
        outcome: "applied",
        at: reportedAt,
      });
    }

    const versionRow = async (id: string) =>
      (await db.select().from(engineSceneVersions).where(eq(engineSceneVersions.id, id)))[0];
    const versionFileCount = async (versionId: string) =>
      (
        await db
          .select({ sha256: engineSceneVersionFiles.sha256 })
          .from(engineSceneVersionFiles)
          .where(eq(engineSceneVersionFiles.versionId, versionId))
      ).length;
    const reportUsers = async (versionId: string) =>
      (
        await db
          .select({ userId: engineLiveReports.userId })
          .from(engineLiveReports)
          .where(eq(engineLiveReports.versionId, versionId))
      )
        .map((r) => r.userId)
        .sort();

    /**
     * Seven versions of one scene, a month old and older: the oldest two are
     * beyond the kept five, and preview points at the second. The first
     * lists one of the release's texts too.
     */
    async function sevenVersions(store: MemoryObjectStore, projectId: string) {
      const release = await productionRelease(store, projectId);
      const sharedText = release.manifest.build.files.find(
        (f) => !blobHashes(release).has(f.sha256),
      )!.sha256;
      const versions: SeededVersion[] = [];
      for (let n = 1; n <= 7; n++)
        versions.push(
          await seedVersion(store, projectId, release, {
            number: n,
            createdAt: at((n - 40) * DAY),
            ...(n === 1 ? { shared: sharedText } : {}),
          }),
        );
      const [, second] = versions as [SeededVersion, SeededVersion];
      await db.insert(engineSceneChannels).values({
        projectId,
        channel: "preview",
        sceneId: second.sceneId,
        versionId: second.id,
        timing: "next-load",
      });
      return { release, versions, sharedText };
    }

    it("collects an unpointed old scene version, and its texts a day later unless a release lists them", async () => {
      const projectId = newProjectId();
      const store = new MemoryObjectStore();
      await seedProject(projectId);
      const { versions, sharedText } = await sevenVersions(store, projectId);
      const [first, second, third] = versions as [SeededVersion, SeededVersion, SeededVersion];
      const alice = newUserId();
      const bob = newUserId();
      await seedReport(first.id, alice, at(-DAY));
      await seedReport(third.id, bob, at(-DAY));

      const run = await collector([projectId], { objects: store, at: T0 });
      if (!run.ran) throw new Error("the run didn't take the lock");
      expect(run.failures).toEqual([]);
      expect(run.actions.map((a) => [a.step, a.target])).toEqual([["scenes", first.id]]);

      const collected = await versionRow(first.id);
      expect(collected?.collectedAt?.getTime()).toBe(T0.getTime());
      expect(collected?.descriptor).toBeNull();
      expect(await versionFileCount(first.id)).toBe(0);
      expect(await reportUsers(first.id)).toEqual([]);
      expect(await reportUsers(third.id)).toEqual([bob]);
      const audit = await db
        .select()
        .from(engineReleaseAudit)
        .where(eq(engineReleaseAudit.projectId, projectId));
      expect(
        audit.map((a) => [a.action, a.actorKind, a.sceneId, a.sceneVersionId, a.detail]),
      ).toEqual([["scene-collect", "system", first.sceneId, first.id, { number: 1 }]]);
      // The pointed version and the five newest stay whole.
      for (const kept of versions.slice(1)) {
        const row = await versionRow(kept.id);
        expect(row?.collectedAt).toBeNull();
        expect(row?.descriptor).not.toBeNull();
      }
      expect(await versionFileCount(second.id)).toBe(2);
      // Its texts outlive it by a day.
      for (const sha256 of first.texts)
        expect(store.has(engineReleaseObjectKey(projectId, sha256))).toBe(true);

      const next = await collector([projectId], { objects: store, at: at(DAY) });
      if (!next.ran) throw new Error("the run didn't take the lock");
      expect(next.failures).toEqual([]);
      expect(next.actions.map((a) => [a.step, a.target]).sort()).toEqual(
        first.texts.map((sha256) => ["orphans", engineReleaseObjectKey(projectId, sha256)]).sort(),
      );
      for (const sha256 of first.texts) {
        expect(store.has(engineReleaseObjectKey(projectId, sha256))).toBe(false);
        expect(await objectRow(projectId, sha256)).toBeUndefined();
      }
      expect(store.has(engineReleaseObjectKey(projectId, sharedText))).toBe(true);
      for (const kept of versions.slice(1))
        for (const sha256 of kept.texts)
          expect(store.has(engineReleaseObjectKey(projectId, sha256))).toBe(true);
    }, 60_000);

    it("keeps a kept scene version's new blob past the blob grace", async () => {
      const projectId = newProjectId();
      const store = new MemoryObjectStore();
      await seedProject(projectId);
      const release = await productionRelease(store, projectId);
      const art = hex("7");
      const orphan = hex("8");
      const artKey = await seedBlob(store, projectId, art, at(-60 * DAY));
      const orphanKey = await seedBlob(store, projectId, orphan, at(-60 * DAY));
      const version = await seedVersion(store, projectId, release, {
        number: 1,
        createdAt: at(-60 * DAY),
        blob: art,
      });
      // Only the version's descriptor keeps it: no file row lists it.
      await db
        .delete(engineSceneVersionFiles)
        .where(
          and(
            eq(engineSceneVersionFiles.versionId, version.id),
            eq(engineSceneVersionFiles.sha256, art),
          ),
        );

      const run = await collector([projectId], { objects: store, at: T0 });
      expect(run.ran && run.failures).toEqual([]);
      expect(run.ran && run.actions).toEqual([
        { step: "blobs", projectId, target: orphanKey, bytes: 10 },
      ]);
      expect(store.has(artKey)).toBe(true);
      expect((await blobRow(projectId, art))?.lastReferencedAt?.getTime()).toBe(T0.getTime());
      expect(store.has(orphanKey)).toBe(false);
    }, 60_000);

    it("deletes live reports older than 30 days", async () => {
      const projectId = newProjectId();
      const store = new MemoryObjectStore();
      await seedProject(projectId);
      const release = await productionRelease(store, projectId);
      const version = await seedVersion(store, projectId, release, {
        number: 1,
        createdAt: at(-60 * DAY),
      });
      const old = newUserId();
      const recent = newUserId();
      await seedReport(version.id, old, at(-31 * DAY));
      await seedReport(version.id, recent, at(-29 * DAY));

      const run = await collector([projectId], { objects: store, at: T0 });
      if (!run.ran) throw new Error("the run didn't take the lock");
      expect(run.failures).toEqual([]);
      expect(run.actions).toEqual([
        { step: "reports", projectId, target: `${version.id}:${old}`, bytes: 0 },
      ]);
      expect(run.totals.reports).toEqual({ count: 1, bytes: 0 });
      expect(await reportUsers(version.id)).toEqual([recent]);
    }, 60_000);

    it("in report mode collects no scene version and deletes no report", async () => {
      const projectId = newProjectId();
      const store = new MemoryObjectStore();
      await seedProject(projectId);
      const { versions } = await sevenVersions(store, projectId);
      const third = versions[2]!;
      await seedReport(third.id, newUserId(), at(-40 * DAY));

      const tables = async () => ({
        versions: (
          await db
            .select({
              id: engineSceneVersions.id,
              collectedAt: engineSceneVersions.collectedAt,
              descriptor: engineSceneVersions.descriptor,
            })
            .from(engineSceneVersions)
            .where(eq(engineSceneVersions.projectId, projectId))
        ).sort((a, b) => a.id.localeCompare(b.id)),
        files: (
          await db
            .select({ sha256: engineSceneVersionFiles.sha256 })
            .from(engineSceneVersionFiles)
            .where(eq(engineSceneVersionFiles.projectId, projectId))
        ).length,
        reports: await reportUsers(third.id),
        objects: await objectCount(projectId),
        audit: (
          await db
            .select({ id: engineReleaseAudit.id })
            .from(engineReleaseAudit)
            .where(eq(engineReleaseAudit.projectId, projectId))
        ).length,
      });
      const before = await tables();

      const report = await collector([projectId], { objects: store, mode: "report", at: T0 });
      if (!report.ran) throw new Error("the report run didn't take the lock");
      expect(report.failures).toEqual([]);
      expect(report.actions.map((a) => a.step)).toEqual(["scenes", "reports"]);
      expect(await tables()).toEqual(before);
      expect(store.removed).toEqual([]);

      const run = await collector([projectId], { objects: store, at: T0 });
      if (!run.ran) throw new Error("the delete run didn't take the lock");
      expect(run.actions).toEqual(report.actions);
      expect((await versionRow(versions[0]!.id))?.collectedAt?.getTime()).toBe(T0.getTime());
      expect(await reportUsers(third.id)).toEqual([]);
    }, 60_000);

    it("collects an unpinned old release and deletes its unshared objects; keeps a pinned one", async () => {
      const projectId = newProjectId();
      const store = new MemoryObjectStore();
      await seedProject(projectId);
      const releases = await twelveReleases(store, projectId);
      const [first, second] = releases as [PlannedRelease, PlannedRelease];
      const others = new Set(releases.slice(1).flatMap((r) => [...filesOf(r)]));
      const unshared = [...filesOf(first)].filter((h) => !others.has(h));
      const shared = [...filesOf(first)].filter((h) => others.has(h));
      expect(unshared.length).toBeGreaterThan(0);
      expect(shared.length).toBeGreaterThan(0);

      purged.length = 0;
      const run = await collector([projectId], { objects: store, at: T0 });
      if (!run.ran) throw new Error("the run didn't take the lock");
      expect(run.failures).toEqual([]);
      expect(purged).toEqual([first.releaseId]);

      const collected = await releaseRow(first.releaseId);
      expect(collected?.collectedAt?.getTime()).toBe(T0.getTime());
      expect(collected?.manifest).toBeNull();
      expect(await fileCount(first.releaseId)).toBe(0);
      const audit = await db
        .select()
        .from(engineReleaseAudit)
        .where(eq(engineReleaseAudit.projectId, projectId));
      expect(audit.map((a) => [a.action, a.actorKind, a.releaseId])).toEqual([
        ["collect", "system", first.releaseId],
      ]);

      for (const sha256 of unshared) {
        expect(store.has(engineReleaseObjectKey(projectId, sha256))).toBe(false);
        expect(await objectRow(projectId, sha256)).toBeUndefined();
      }
      for (const sha256 of shared) {
        if (blobHashes(first).has(sha256)) continue;
        expect(store.has(engineReleaseObjectKey(projectId, sha256))).toBe(true);
      }

      const pinned = await releaseRow(second.releaseId);
      expect(pinned?.collectedAt).toBeNull();
      expect(pinned?.manifest).toBe(second.text);
      for (const release of releases.slice(2))
        expect((await releaseRow(release.releaseId))?.collectedAt).toBeNull();
      expect(run.actions.filter((a) => a.step === "releases").map((a) => a.target)).toEqual([
        first.releaseId,
      ]);

      // Nothing more to do the next day.
      const again = await collector([projectId], { objects: store, at: at(DAY) });
      expect(again.ran && again.actions).toEqual([]);
    }, 60_000);

    it("announces the releases it collected once, after their files are gone", async () => {
      const projectId = newProjectId();
      const store = new MemoryObjectStore();
      await seedProject(projectId);
      const releases = await twelveReleases(store, projectId);
      const [first] = releases as [PlannedRelease];
      const others = new Set(releases.slice(1).flatMap((r) => [...filesOf(r)]));
      const unshared = [...filesOf(first)].filter((h) => !others.has(h));
      expect(unshared.length).toBeGreaterThan(0);

      const notices: EngineReleaseNotice[] = [];
      /** What was still stored, and whether the row was collected, when each notice went out. */
      const seen: { stored: number; collected: boolean }[] = [];
      const announce = async (notice: EngineReleaseNotice) => {
        notices.push(notice);
        seen.push({
          stored: unshared.filter((h) => store.has(engineReleaseObjectKey(projectId, h))).length,
          collected: (await releaseRow(first.releaseId))?.collectedAt != null,
        });
      };

      const report = await collector([projectId], {
        objects: store,
        at: T0,
        mode: "report",
        announce,
      });
      expect(report.ran && report.actions.length).toBeGreaterThan(0);
      expect(notices).toEqual([]);

      const run = await collector([projectId], { objects: store, at: T0, announce });
      expect(run.ran && run.failures).toEqual([]);
      expect(notices).toEqual([{ releaseIds: [first.releaseId], projectIds: [] }]);
      expect(seen).toEqual([{ stored: 0, collected: true }]);

      // Nothing collected the next day, so nothing announced.
      await collector([projectId], { objects: store, at: at(DAY), announce });
      expect(notices).toHaveLength(1);
    }, 60_000);

    it("a release notice that fails leaves the run a success", async () => {
      const projectId = newProjectId();
      const store = new MemoryObjectStore();
      await seedProject(projectId);
      const [first] = (await twelveReleases(store, projectId)) as [PlannedRelease];

      const lines: string[] = [];
      const run = await collector([projectId], {
        objects: store,
        at: T0,
        lines,
        announce: async () => {
          throw new Error("connection refused");
        },
      });
      if (!run.ran) throw new Error("the run didn't take the lock");
      expect(run.failures).toEqual([]);
      expect((await releaseRow(first.releaseId))?.collectedAt?.getTime()).toBe(T0.getTime());
      expect(lines.join("\n")).toContain(
        "release notice for 1 release(s) failed: connection refused",
      );
      const [beat] = await db
        .select()
        .from(itchTierHeartbeats)
        .where(eq(itchTierHeartbeats.tier, COLLECTOR_TIER));
      expect(beat?.lastError).toBeNull();
    }, 60_000);

    it("deletes an orphan blob after the grace and keeps a pinned snapshot's blob", async () => {
      const projectId = newProjectId();
      const store = new MemoryObjectStore();
      const live = hex("1");
      const orphan = hex("2");
      const recent = hex("3");
      await seedProject(projectId, {
        entries: [
          {
            key: "crate",
            id: "crate",
            kind: "texture",
            path: "art/crate.png",
            sha256: live,
            bytes: 10,
            created: { at: 1, by: "alice" },
          },
        ],
      });
      const release = await seedRelease(store, projectId, 1, at(-60 * DAY));
      await db
        .insert(engineReleaseChannels)
        .values({ projectId, channel: "production", releaseId: release.releaseId });
      const [snapshotBlob] = [...blobHashes(release)];
      if (!snapshotBlob) throw new Error("the fixture release has no blob asset");
      // Only the snapshot keeps it: no file row lists it.
      await db
        .delete(engineReleaseFiles)
        .where(
          and(
            eq(engineReleaseFiles.releaseId, release.releaseId),
            eq(engineReleaseFiles.sha256, snapshotBlob),
          ),
        );
      await seedBlob(store, projectId, live, at(-60 * DAY));
      const orphanKey = await seedBlob(store, projectId, orphan, at(-40 * DAY));
      await seedBlob(store, projectId, recent, at(-10 * DAY));

      const run = await collector([projectId], { objects: store, at: T0 });
      expect(run.ran && run.failures).toEqual([]);
      expect(run.ran && run.actions).toEqual([
        { step: "blobs", projectId, target: orphanKey, bytes: 10 },
      ]);
      expect(store.has(orphanKey)).toBe(false);
      expect(await blobRow(projectId, orphan)).toBeUndefined();
      expect(store.has(engineAssetKey(projectId, snapshotBlob))).toBe(true);
      expect(await blobRow(projectId, snapshotBlob)).toBeDefined();
      expect((await blobRow(projectId, live))?.lastReferencedAt?.getTime()).toBe(T0.getTime());
      // Unreferenced but inside the grace: kept, its clock left alone.
      expect((await blobRow(projectId, recent))?.lastReferencedAt).toBeNull();
      expect(store.has(engineAssetKey(projectId, recent))).toBe(true);

      // Twenty-one days on, it has been quiet for the whole grace.
      const later = await collector([projectId], { objects: store, at: at(21 * DAY) });
      expect(later.ran && later.actions.map((a) => a.target)).toEqual([
        engineAssetKey(projectId, recent),
      ]);
    }, 60_000);

    it("keeps a due blob that a release committed after the plan serves", async () => {
      const projectId = newProjectId();
      const store = new MemoryObjectStore();
      await seedProject(projectId);
      const blob = hex("4");
      const key = await seedBlob(store, projectId, blob, at(-40 * DAY));
      const release = await plannedRelease({ projectId });
      // A begin and commit landing between the plan and the blob's removal: begin counted
      // the blob as held, so the release serves it as one of its files.
      let committed = false;
      const racing = new Proxy(db, {
        get(target, prop) {
          const value = Reflect.get(target, prop, target);
          if (prop !== "transaction" || committed)
            return typeof value === "function" ? value.bind(target) : value;
          return async (...args: Parameters<typeof db.transaction>) => {
            committed = true;
            await db.insert(engineReleases).values({
              id: release.releaseId,
              projectId,
              version: 1,
              manifest: release.text,
              manifestBytes: new TextEncoder().encode(release.text).length,
              totalBytes: 10,
              fileCount: 1,
              engineVersion: release.manifest.engine.version,
              gameId: release.manifest.game.id,
              snapshot: release.manifest.project.snapshot,
              buildHash: release.manifest.build.hash,
              target: release.manifest.build.target,
              createdAt: T0,
            });
            await db.insert(engineReleaseFiles).values({
              releaseId: release.releaseId,
              projectId,
              path: `assets/${blob}.png`,
              sha256: blob,
              bytes: 10,
              role: "asset",
              source: "blob",
            });
            return target.transaction(...args);
          };
        },
      });
      const lines: string[] = [];

      const run = await collector([projectId], { db: racing, objects: store, at: T0, lines });
      expect(run.ran && run.failures).toEqual([]);
      expect(committed).toBe(true);
      expect(run.ran && run.actions).toEqual([
        { step: "blobs", projectId, target: key, bytes: 10 },
      ]);
      expect(store.has(key)).toBe(true);
      expect(await blobRow(projectId, blob)).toBeDefined();
      expect(lines.some((l) => l.startsWith(`[collector] kept ${key}`))).toBe(true);
    }, 60_000);

    it("removes an expired upload, and its objects a day later", async () => {
      const projectId = newProjectId();
      const store = new MemoryObjectStore();
      await seedProject(projectId);
      const release = await plannedRelease({ projectId });
      const begun = at(-30 * HOUR);
      const [upload] = await db
        .insert(engineReleaseUploads)
        .values({
          projectId,
          manifest: release.text,
          releaseId: release.releaseId,
          actorKind: "user",
          createdAt: begun,
          expiresAt: new Date(begun.getTime() + 24 * HOUR),
        })
        .returning({ id: engineReleaseUploads.id });
      const file = release.manifest.build.files.find((f) => !blobHashes(release).has(f.sha256))!;
      // The one file put before the upload went quiet, an hour after `begin`.
      const key = await seedObject(store, projectId, file.sha256, at(-29 * HOUR), file.bytes);

      // Half a day after `begin`: the upload is still open and its file in flight.
      const early = await collector([projectId], { objects: store, at: at(-18 * HOUR) });
      expect(early.ran && early.actions).toEqual([]);

      const run = await collector([projectId], { objects: store, at: T0 });
      expect(run.ran && run.actions).toEqual([
        { step: "orphans", projectId, target: key, bytes: file.bytes },
        { step: "uploads", projectId, target: upload!.id, bytes: 0 },
      ]);
      expect(store.has(key)).toBe(false);
      expect(await objectRow(projectId, file.sha256)).toBeUndefined();
      const uploads = await db
        .select()
        .from(engineReleaseUploads)
        .where(eq(engineReleaseUploads.projectId, projectId));
      expect(uploads).toEqual([]);
    }, 60_000);

    it("purges a project deleted 30 days ago, not one deleted 29 days ago", async () => {
      const recent = newProjectId();
      const old = newProjectId();
      const store = new MemoryObjectStore();
      await seedProject(recent, { deletedAt: at(-29 * DAY) });
      await seedProject(old, { deletedAt: at(-31 * DAY) });
      const keys: string[] = [];
      for (const projectId of [recent, old]) {
        keys.push(await seedBlob(store, projectId, hex("a"), at(-90 * DAY)));
        keys.push(await seedObject(store, projectId, hex("b"), at(-90 * DAY)));
        // An object whose row went missing: found by its prefix.
        const stray = engineReleaseObjectKey(projectId, hex("c"));
        store.put(stray);
        keys.push(stray);
      }

      const run = await collector([recent, old], { objects: store, at: T0 });
      expect(run.ran && run.failures).toEqual([]);
      const [recentBlob, recentObject, recentStray, oldBlob, oldObject, oldStray] = keys as [
        string,
        string,
        string,
        string,
        string,
        string,
      ];
      expect(run.ran && run.actions.map((a) => [a.step, a.target])).toEqual([
        ["projects", oldBlob],
        ["projects", oldObject],
        ["projects", oldStray],
        ["projects", old],
      ]);
      for (const key of [oldBlob, oldObject, oldStray]) expect(store.has(key)).toBe(false);
      for (const key of [recentBlob, recentObject, recentStray]) expect(store.has(key)).toBe(true);
      expect(
        await db.select().from(engineProjects).where(eq(engineProjects.projectId, old)),
      ).toEqual([]);
      expect(await blobRow(old, hex("a"))).toBeUndefined();
      expect(
        await db.select().from(engineProjects).where(eq(engineProjects.projectId, recent)),
      ).toHaveLength(1);
    }, 60_000);

    it("in report mode deletes nothing and logs the plan delete mode then carries out", async () => {
      const projectId = newProjectId();
      const purged = newProjectId();
      const store = new MemoryObjectStore();
      await seedProject(projectId);
      await twelveReleases(store, projectId);
      await seedBlob(store, projectId, hex("d"), at(-45 * DAY));
      await seedProject(purged, { deletedAt: at(-40 * DAY) });
      await seedBlob(store, purged, hex("e"), at(-90 * DAY));

      const tables = async () => ({
        releases: await db
          .select({ id: engineReleases.id, collectedAt: engineReleases.collectedAt })
          .from(engineReleases)
          .where(eq(engineReleases.projectId, projectId)),
        files: (
          await db
            .select({ path: engineReleaseFiles.path })
            .from(engineReleaseFiles)
            .where(eq(engineReleaseFiles.projectId, projectId))
        ).length,
        objects: (
          await db
            .select({ sha256: engineReleaseObjects.sha256 })
            .from(engineReleaseObjects)
            .where(eq(engineReleaseObjects.projectId, projectId))
        ).length,
        blobs: (
          await db
            .select({ sha256: engineBlobs.sha256 })
            .from(engineBlobs)
            .where(eq(engineBlobs.projectId, projectId))
        ).length,
        projects: (
          await db
            .select({ id: engineProjects.projectId })
            .from(engineProjects)
            .where(eq(engineProjects.projectId, purged))
        ).length,
      });
      const before = await tables();
      const keysBefore = [...store.objects.keys()].sort();

      const reported: string[] = [];
      const report = await collector([projectId, purged], {
        objects: store,
        mode: "report",
        at: T0,
        lines: reported,
      });
      if (!report.ran) throw new Error("the report run didn't take the lock");
      expect(report.failures).toEqual([]);
      expect(new Set(report.actions.map((a) => a.step))).toEqual(
        new Set(["releases", "orphans", "blobs", "projects"]),
      );
      expect(await tables()).toEqual(before);
      expect([...store.objects.keys()].sort()).toEqual(keysBefore);
      expect(store.removed).toEqual([]);

      const done: string[] = [];
      const run = await collector([projectId, purged], { objects: store, at: T0, lines: done });
      if (!run.ran) throw new Error("the delete run didn't take the lock");
      expect(run.actions).toEqual(report.actions);
      const planned = (lines: string[], verb: string) =>
        lines
          .filter((l) => l.startsWith(`[collector] ${verb} `))
          .map((l) => l.slice(verb.length + 13));
      expect(planned(done, "deleting")).toEqual(planned(reported, "would delete"));
      expect(planned(done, "deleting")).toHaveLength(run.actions.length);
      expect(store.removed.sort()).toEqual(
        run.actions
          .filter((a) => a.target.includes("/"))
          .map((a) => a.target)
          .sort(),
      );

      const [heartbeat] = await db
        .select()
        .from(itchTierHeartbeats)
        .where(eq(itchTierHeartbeats.tier, COLLECTOR_TIER));
      expect(heartbeat?.lastError).toBeNull();
      expect(heartbeat?.lastOkAt).toBeInstanceOf(Date);
    }, 90_000);

    it("recovers on the next run from a crash between an object and its row", async () => {
      const projectId = newProjectId();
      const store = new MemoryObjectStore();
      await seedProject(projectId);
      const orphan = hex("f");
      const key = await seedBlob(store, projectId, orphan, at(-40 * DAY));
      let crashes = 1;
      const crashing = {
        list: (prefix: string) => store.list(prefix),
        async remove(target: string) {
          await store.remove(target);
          if (crashes-- > 0) throw new Error("the process stopped here");
        },
      };
      const captured: unknown[] = [];

      const first = await collector([projectId], {
        objects: crashing,
        at: T0,
        telemetry: { ...quiet, captureException: (error) => captured.push(error) },
      });
      expect(first.ran && first.failures).toEqual([
        { projectId, error: "the process stopped here" },
      ]);
      expect(captured).toHaveLength(1);
      expect(store.has(key)).toBe(false);
      expect(await blobRow(projectId, orphan)).toBeDefined();
      const [failed] = await db
        .select()
        .from(itchTierHeartbeats)
        .where(eq(itchTierHeartbeats.tier, COLLECTOR_TIER));
      expect(failed?.lastError).toContain("the process stopped here");

      const next = await collector([projectId], { objects: store, at: at(DAY) });
      expect(next.ran && next.failures).toEqual([]);
      expect(next.ran && next.actions.map((a) => a.target)).toEqual([key]);
      expect(await blobRow(projectId, orphan)).toBeUndefined();
    }, 60_000);

    it("expires a save unused for 181 days and keeps one used 179 days ago", async () => {
      const projectId = newProjectId();
      const userId = newUserId();
      const store = new MemoryObjectStore();
      await seedProject(projectId);
      await seedUser(db, userId);
      const old = await seedSave(store, {
        userId,
        projectId,
        slot: "old",
        usedAt: at(-181 * DAY),
        bytes: 321,
      });
      const recent = await seedSave(store, {
        userId,
        projectId,
        slot: "recent",
        usedAt: at(-179 * DAY),
      });

      const run = await collector([projectId], { objects: store, at: T0 });
      if (!run.ran) throw new Error("the run didn't take the lock");
      expect(run.failures).toEqual([]);
      expect(run.actions).toEqual([{ step: "saves", projectId, target: old, bytes: 321 }]);
      expect(run.totals.saves).toEqual({ count: 1, bytes: 321 });
      expect(store.has(old)).toBe(false);
      expect(store.has(recent)).toBe(true);
      expect(await saveRows(projectId)).toEqual(["recent"]);

      // Two days on, the other one has gone quiet for the whole period too.
      const later = await collector([projectId], { objects: store, at: at(2 * DAY) });
      expect(later.ran && later.actions.map((a) => a.target)).toEqual([recent]);
      expect(await saveRows(projectId)).toEqual([]);
    }, 60_000);

    it("keeps a save a listing used, before the run or between its plan and the deletion", async () => {
      const projectId = newProjectId();
      const userId = newUserId();
      const store = new MemoryObjectStore();
      await seedProject(projectId);
      await seedUser(db, userId);
      const listed = await seedSave(store, {
        userId,
        projectId,
        slot: "listed",
        usedAt: at(-200 * DAY),
      });
      const racing = await seedSave(store, {
        userId,
        projectId,
        slot: "racing",
        usedAt: at(-200 * DAY),
      });
      // A listing bumps `used_at` on every save it returns.
      await db
        .update(engineSaves)
        .set({ usedAt: at(-HOUR) })
        .where(and(eq(engineSaves.projectId, projectId), eq(engineSaves.slot, "listed")));

      let bumped = false;
      const listing = new Proxy(db, {
        get(target, prop) {
          const value = Reflect.get(target, prop, target);
          if (prop !== "transaction" || bumped)
            return typeof value === "function" ? value.bind(target) : value;
          return async (...args: Parameters<typeof db.transaction>) => {
            bumped = true;
            await db
              .update(engineSaves)
              .set({ usedAt: T0 })
              .where(and(eq(engineSaves.projectId, projectId), eq(engineSaves.slot, "racing")));
            return target.transaction(...args);
          };
        },
      });
      const lines: string[] = [];

      const run = await collector([projectId], { db: listing, objects: store, at: T0, lines });
      expect(run.ran && run.failures).toEqual([]);
      expect(bumped).toBe(true);
      expect(run.ran && run.actions.map((a) => a.target)).toEqual([racing]);
      expect(lines.some((l) => l.startsWith(`[collector] kept ${racing}`))).toBe(true);
      expect(store.has(listed)).toBe(true);
      expect(store.has(racing)).toBe(true);
      expect(store.removed).toEqual([]);
      expect(await saveRows(projectId)).toEqual(["listed", "racing"]);
    }, 60_000);

    it("deletes a purged project's saves' objects before its row, which takes the save rows", async () => {
      const old = newProjectId();
      const recent = newProjectId();
      const alice = newUserId();
      const bob = newUserId();
      const store = new MemoryObjectStore();
      await seedProject(old, { deletedAt: at(-31 * DAY) });
      await seedProject(recent, { deletedAt: at(-29 * DAY) });
      await seedUser(db, alice);
      await seedUser(db, bob);
      // In use yesterday: only the purge removes these.
      const aliceSave = await seedSave(store, {
        userId: alice,
        projectId: old,
        slot: "a",
        usedAt: at(-DAY),
      });
      const bobSave = await seedSave(store, {
        userId: bob,
        projectId: old,
        slot: "b",
        usedAt: at(-DAY),
      });
      // A project still inside its 30 days keeps its saves, unless they expire.
      const kept = await seedSave(store, {
        userId: alice,
        projectId: recent,
        slot: "kept",
        usedAt: at(-DAY),
      });
      const expired = await seedSave(store, {
        userId: alice,
        projectId: recent,
        slot: "expired",
        usedAt: at(-181 * DAY),
      });

      const run = await collector([old, recent], { objects: store, at: T0 });
      expect(run.ran && run.failures).toEqual([]);
      expect(run.ran && run.actions.map((a) => [a.step, a.target])).toEqual([
        ["saves", expired],
        ...[aliceSave, bobSave].sort().map((key) => ["projects", key]),
        ["projects", old],
      ]);
      expect(store.has(aliceSave)).toBe(false);
      expect(store.has(bobSave)).toBe(false);
      expect(store.has(expired)).toBe(false);
      expect(store.has(kept)).toBe(true);
      expect(await saveRows(old)).toEqual([]);
      expect(await saveRows(recent)).toEqual(["kept"]);
      expect(
        await db.select().from(engineProjects).where(eq(engineProjects.projectId, old)),
      ).toEqual([]);
    }, 60_000);

    it("in report mode plans expired saves, more than a page of them, and deletes none", async () => {
      const projectId = newProjectId();
      const purged = newProjectId();
      const store = new MemoryObjectStore();
      await seedProject(projectId);
      await seedProject(purged, { deletedAt: at(-40 * DAY) });
      const users = Array.from({ length: 501 }, newUserId);
      for (const userId of users) await seedUser(db, userId);
      await db.insert(engineSaves).values(
        users.map((userId) => ({
          userId,
          projectId,
          slot: "auto",
          bytes: 10,
          gameVersion: 1,
          meta: { scene: "hall", savedAt: 0, playTicks: 0 },
          usedAt: at(-200 * DAY),
        })),
      );
      for (const userId of users) store.put(engineSaveKey(userId, projectId, "auto"));
      const purgedSave = await seedSave(store, {
        userId: users[0]!,
        projectId: purged,
        slot: "a",
        usedAt: at(-DAY),
      });
      const keysBefore = [...store.objects.keys()].sort();
      const captured: Record<string, unknown>[] = [];
      const lines: string[] = [];

      const report = await collector([projectId, purged], {
        objects: store,
        mode: "report",
        at: T0,
        lines,
        telemetry: { ...quiet, capture: (_event, properties) => captured.push(properties ?? {}) },
      });
      if (!report.ran) throw new Error("the report run didn't take the lock");
      expect(report.failures).toEqual([]);
      expect(report.totals.saves).toEqual({ count: 501, bytes: 5010 });
      expect(report.actions.filter((a) => a.step === "projects").map((a) => a.target)).toEqual([
        purgedSave,
        purged,
      ]);
      expect(store.removed).toEqual([]);
      expect([...store.objects.keys()].sort()).toEqual(keysBefore);
      expect(await saveRows(projectId)).toHaveLength(501);
      expect(await saveRows(purged)).toEqual(["a"]);
      expect(captured[0]).toMatchObject({ saves_count: 501, saves_bytes: 5010 });
      expect(lines.some((l) => l.includes("saves 501 ("))).toBe(true);

      const run = await collector([projectId, purged], { objects: store, at: T0 });
      expect(run.ran && run.failures).toEqual([]);
      expect(run.ran && run.totals.saves.count).toBe(501);
      expect(await saveRows(projectId)).toEqual([]);
      expect(await saveRows(purged)).toEqual([]);
      expect(store.removed).toHaveLength(502);
    }, 120_000);

    it("without a bucket collects releases but leaves objects and their rows", async () => {
      const projectId = newProjectId();
      const store = new MemoryObjectStore();
      await seedProject(projectId);
      const [first] = await twelveReleases(store, projectId);
      const orphan = hex("9");
      await seedBlob(store, projectId, orphan, at(-40 * DAY));
      const lines: string[] = [];
      const objectsBefore = await objectCount(projectId);

      const run = await collector([projectId], { objects: null, at: T0, lines });
      expect(run.ran && run.objects).toBe(false);
      expect((await releaseRow(first!.releaseId))?.collectedAt?.getTime()).toBe(T0.getTime());
      expect(await blobRow(projectId, orphan)).toBeDefined();
      expect(lines.some((l) => l.startsWith("[collector] would delete blobs"))).toBe(true);
      expect(await objectCount(projectId)).toBe(objectsBefore);
      expect(run.ran && run.actions.some((a) => a.step === "orphans")).toBe(true);
      expect(store.removed).toEqual([]);
    }, 60_000);
  });
} else {
  warnSkipped("the collector on Postgres", "CANVAS_SYNC_TEST_DATABASE_URL");
}
