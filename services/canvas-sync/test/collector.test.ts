import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { and, eq } from "drizzle-orm";
import IORedis from "ioredis";

import type { AssetEntry } from "../../../packages/engine/project/types.ts";
import {
  engineBlobs,
  engineProjects,
  engineReleaseAudit,
  engineReleaseChannels,
  engineReleaseFiles,
  engineReleaseObjects,
  engineReleases,
  engineReleaseUploads,
  itchTierHeartbeats,
} from "../../../src/db/schema.ts";
import {
  plannedRelease,
  type PlannedRelease,
} from "../../../src/lib/engine/__tests__/release-fixture.ts";
import { engineAssetKey, engineReleaseObjectKey } from "../../../src/lib/engine/storage-keys.ts";
import { emptyProjectState, seedProjectState } from "../../../src/lib/scene/project-bytes.ts";
import {
  COLLECTOR_LOCK_SECONDS,
  COLLECTOR_TIER,
  type CollectorDb,
  type CollectorOptions,
  redisCollectorLock,
  runCollector,
  soloCollectorLock,
  startCollectorTimer,
} from "../src/engine/collector.ts";
import { MemoryObjectStore } from "../src/engine/object-store.ts";
import { FakeRedis } from "./fake-redis.ts";
import { newProjectId, TEST_DATABASE_URL, testDb, warnSkipped } from "./harness.ts";

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

    const filesOf = (release: PlannedRelease) =>
      new Set(release.manifest.build.files.map((f) => f.sha256));

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

      const run = await collector([projectId], { objects: store, at: T0 });
      if (!run.ran) throw new Error("the run didn't take the lock");
      expect(run.failures).toEqual([]);

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
