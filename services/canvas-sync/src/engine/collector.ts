import { and, asc, eq, gt, inArray, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import type { PgAsyncDatabase } from "drizzle-orm/pg-core";

import {
  parseReleaseManifest,
  projectView,
  releaseSnapshot,
  unreferencedBlobs,
  type ProjectSnapshot,
} from "../../../../packages/engine/project/index.ts";
import {
  engineBlobs,
  engineProjects,
  engineReleaseChannels,
  engineReleaseFiles,
  engineReleaseJamLinks,
  engineReleaseObjects,
  engineReleases,
  engineReleaseUploads,
  engineSaves,
  itchTierHeartbeats,
} from "../../../../src/db/schema.ts";
import { purgeShell } from "../../../../src/lib/cloudflare-purge.ts";
import {
  blobsDue,
  nextCollectorRun,
  releasesToCollect,
  savesDue,
} from "../../../../src/lib/engine/collect-plan.ts";
import {
  BLOB_GRACE_DAYS,
  ORPHAN_FILE_GRACE_HOURS,
  PROJECT_PURGE_DAYS,
} from "../../../../src/lib/engine/limits.ts";
import { writeAudit } from "../../../../src/lib/engine/release-audit.ts";
import { engineProjectPrefixes, engineSaveKey } from "../../../../src/lib/engine/storage-keys.ts";
import { formatBytes } from "../../../../src/lib/format-bytes.ts";
import { readProjectState } from "../../../../src/lib/scene/project-bytes.ts";
import type { ServiceTelemetry } from "../../../../src/lib/service-telemetry.ts";
import type { CollectorObjectStore } from "./object-store.ts";

/**
 * The daily cleanup of hosted games: releases beyond the kept set, release
 * files nothing lists, blobs nothing references, saves nobody has used for
 * the expiry period, expired uploads and projects deleted long enough ago. Every run works out the whole plan from
 * what is stored and logs it; in `report` mode that is all it does.
 *
 * Deletions go object first, then row, so a run that stops halfway leaves
 * at worst a row naming a missing object, which the next run removes. Each
 * one runs under the project's row lock, the lock commits and pointer moves
 * take, after checking again that nothing came to name it since the plan.
 */

export type CollectorMode = "report" | "delete";

export type CollectorStep = "releases" | "orphans" | "blobs" | "saves" | "uploads" | "projects";

export const COLLECTOR_STEPS: readonly CollectorStep[] = [
  "releases",
  "orphans",
  "blobs",
  "saves",
  "uploads",
  "projects",
];

/** One deletion: a release's manifest and files, an object and its row (a save's too), an upload, a project row. */
export type CollectorAction = {
  step: CollectorStep;
  projectId: string;
  /** The release id, the object's storage key, the upload id, or the project id. */
  target: string;
  bytes: number;
};

export type CollectorTotals = Record<CollectorStep, { count: number; bytes: number }>;

export type CollectorRun =
  | { ran: false; reason: "locked" | "lock-failed" }
  | {
      ran: true;
      mode: CollectorMode;
      startedAt: Date;
      /** Every deletion planned, in order; in `report` mode none was made. */
      actions: CollectorAction[];
      totals: CollectorTotals;
      /** Blobs still referenced, stamped `last_referenced_at` this run. */
      touched: number;
      projects: number;
      failures: { projectId: string; error: string }[];
      /** False when no bucket is configured: object deletions (and their rows) were only reported. */
      objects: boolean;
    };

/** The database or a transaction on it, whichever driver. */
export type CollectorDb = Pick<
  PgAsyncDatabase<any, any>,
  "select" | "insert" | "update" | "delete" | "transaction"
>;
type CollectorTx = Pick<CollectorDb, "select" | "insert" | "update" | "delete">;

/** One runner across replicas. */
export interface CollectorLock {
  /** True when this caller holds the lock for the next hour; it is never released early. */
  acquire(): Promise<boolean>;
}

export const COLLECTOR_LOCK_KEY = "engine:collector:lock";
export const COLLECTOR_LOCK_SECONDS = 3600;
export const COLLECTOR_TIER = "engine-collector";

/**
 * `SET NX EX` in Redis, under the environment's key prefix so staging and
 * production sharing a Redis each run. Held for the whole hour, not released
 * at the end of a run, so replicas whose timers fire a moment apart don't
 * each run. A Redis error reads as not acquired: skipping a day is safe.
 */
export function redisCollectorLock(
  client: {
    set(key: string, value: string, ex: "EX", seconds: number, nx: "NX"): Promise<string | null>;
  },
  prefix: string,
  holder: string,
): CollectorLock & { key: string } {
  const key = `${prefix}:${COLLECTOR_LOCK_KEY}`;
  return {
    key,
    async acquire() {
      return (await client.set(key, holder, "EX", COLLECTOR_LOCK_SECONDS, "NX")) === "OK";
    },
  };
}

/**
 * Whether this deployment collects at all: not on production until hosted
 * games open there, as the web app's own guard says; lift both together.
 */
export function collectorAllowed(environmentName: string | undefined): boolean {
  return environmentName !== "production";
}

/** For one instance alone (no Redis): always acquired; the timer never overlaps its own runs. */
export const soloCollectorLock: CollectorLock = { acquire: async () => true };

export interface CollectorOptions {
  db: CollectorDb;
  /** Null when no bucket is configured. */
  objects: CollectorObjectStore | null;
  lock: CollectorLock;
  mode: CollectorMode;
  telemetry: ServiceTelemetry;
  now?: () => Date;
  log?: (line: string) => void;
  /** A project registry this instance holds live, which may be newer than its row. */
  liveProject?: (projectId: string) => Uint8Array | null;
  /** Only these projects; every project by default. */
  projects?: readonly string[];
  /** Asked between projects; true ends the run early (shutdown). */
  shouldStop?: () => boolean;
  /** Awaited between projects, so a run gives live editing the event loop. */
  pause?: () => Promise<void>;
  /**
   * Takes a collected release's shell off the edge; default the Cloudflare
   * purge, which logs when it isn't configured. Best effort: the origin
   * already answers 410.
   */
  purge?: (releaseId: string) => Promise<unknown>;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** Rows per `IN (…)` statement. */
const CHUNK = 500;

const chunks = <T>(items: readonly T[]): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
  return out;
};

export const describeAction = (action: CollectorAction): string =>
  `${action.step} ${action.projectId} ${action.target} (${formatBytes(action.bytes)})`;

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

// ─── Planning ────────────────────────────────────────────

type ObjectRow = { sha256: string; storageKey: string; bytes: number };

type ProjectPlan = {
  releases: { id: string; version: number; bytes: number }[];
  orphans: ObjectRow[];
  /** Stored blobs still referenced: stamped now. */
  referenced: string[];
  blobs: ObjectRow[];
  uploads: string[];
};

/** The hashes an open upload's manifest lists: `begin` counted on them being stored. */
function inFlightHashes(manifests: readonly string[]): Set<string> {
  const hashes = new Set<string>();
  for (const text of manifests) {
    const parsed = parseReleaseManifest(text);
    if (!parsed.ok) continue;
    for (const file of parsed.manifest.build.files) hashes.add(file.sha256);
    for (const asset of Object.values(parsed.manifest.assets)) hashes.add(asset.sha256);
  }
  return hashes;
}

async function planProject(
  db: CollectorDb,
  projectId: string,
  now: Date,
  liveState: Uint8Array | null,
): Promise<ProjectPlan> {
  const releases = await db
    .select({
      id: engineReleases.id,
      version: engineReleases.version,
      createdAt: engineReleases.createdAt,
      collectedAt: engineReleases.collectedAt,
      manifest: engineReleases.manifest,
      manifestBytes: engineReleases.manifestBytes,
    })
    .from(engineReleases)
    .where(eq(engineReleases.projectId, projectId))
    .orderBy(asc(engineReleases.version));
  const channels = await db
    .select({ releaseId: engineReleaseChannels.releaseId })
    .from(engineReleaseChannels)
    .where(eq(engineReleaseChannels.projectId, projectId));
  const jams = await db
    .select({ releaseId: engineReleaseJamLinks.releaseId })
    .from(engineReleaseJamLinks)
    .where(eq(engineReleaseJamLinks.projectId, projectId));
  const collect = new Set(
    releasesToCollect(
      releases,
      { channels: channels.map((c) => c.releaseId), jams: jams.map((j) => j.releaseId) },
      now,
    ),
  );
  const kept = releases.filter((r) => r.collectedAt === null && !collect.has(r.id));

  // What stays listed once this run's collections are made.
  const files = await db
    .select({ releaseId: engineReleaseFiles.releaseId, sha256: engineReleaseFiles.sha256 })
    .from(engineReleaseFiles)
    .where(eq(engineReleaseFiles.projectId, projectId));
  const listed = new Set(files.filter((f) => !collect.has(f.releaseId)).map((f) => f.sha256));
  const open = await db
    .select({ manifest: engineReleaseUploads.manifest })
    .from(engineReleaseUploads)
    .where(
      and(
        eq(engineReleaseUploads.projectId, projectId),
        isNull(engineReleaseUploads.committedAt),
        gt(engineReleaseUploads.expiresAt, now),
      ),
    );
  const inFlight = inFlightHashes(open.map((u) => u.manifest));

  const orphanCutoff = now.getTime() - ORPHAN_FILE_GRACE_HOURS * HOUR_MS;
  const objects = await db
    .select({
      sha256: engineReleaseObjects.sha256,
      storageKey: engineReleaseObjects.storageKey,
      bytes: engineReleaseObjects.bytes,
      createdAt: engineReleaseObjects.createdAt,
    })
    .from(engineReleaseObjects)
    .where(eq(engineReleaseObjects.projectId, projectId))
    .orderBy(asc(engineReleaseObjects.sha256));
  const orphans = objects
    .filter(
      (o) =>
        !listed.has(o.sha256) && !inFlight.has(o.sha256) && o.createdAt.getTime() <= orphanCutoff,
    )
    .map(({ sha256, storageKey, bytes }) => ({ sha256, storageKey, bytes }));

  let state = liveState;
  if (state === null) {
    const [row] = await db
      .select({ state: engineProjects.state })
      .from(engineProjects)
      .where(eq(engineProjects.projectId, projectId));
    state = row?.state ? new Uint8Array(row.state) : null;
  }
  const view = projectView(readProjectState(state));
  // A kept release whose manifest won't parse pins blobs nobody can name: fail the project.
  const pinned: ProjectSnapshot[] = kept.map((r) => {
    const parsed = r.manifest === null ? null : parseReleaseManifest(r.manifest);
    if (!parsed?.ok) throw new Error(`release v${r.version} (${r.id}) has no readable manifest`);
    return releaseSnapshot(parsed.manifest);
  });
  const blobs = await db
    .select({
      sha256: engineBlobs.sha256,
      storageKey: engineBlobs.storageKey,
      bytes: engineBlobs.byteSize,
      createdAt: engineBlobs.createdAt,
      lastReferencedAt: engineBlobs.lastReferencedAt,
    })
    .from(engineBlobs)
    .where(eq(engineBlobs.projectId, projectId))
    .orderBy(asc(engineBlobs.sha256));
  // A kept release serving a blob as one of its files, or an upload counting on one, keeps it too.
  const unreferenced = new Set(
    unreferencedBlobs(
      view,
      blobs.map((b) => b.sha256),
      { now: now.getTime(), graceMs: BLOB_GRACE_DAYS * DAY_MS, pinned },
    ).filter((sha256) => !listed.has(sha256) && !inFlight.has(sha256)),
  );
  const due = new Set(blobsDue([...unreferenced], blobs, now));

  const uploads = await db
    .select({ id: engineReleaseUploads.id })
    .from(engineReleaseUploads)
    .where(
      and(
        eq(engineReleaseUploads.projectId, projectId),
        isNull(engineReleaseUploads.committedAt),
        lte(engineReleaseUploads.expiresAt, now),
      ),
    )
    .orderBy(asc(engineReleaseUploads.id));

  return {
    releases: releases
      .filter((r) => collect.has(r.id))
      .map((r) => ({ id: r.id, version: r.version, bytes: r.manifestBytes })),
    orphans,
    referenced: blobs.filter((b) => !unreferenced.has(b.sha256)).map((b) => b.sha256),
    blobs: blobs
      .filter((b) => due.has(b.sha256))
      .map(({ sha256, storageKey, bytes }) => ({ sha256, storageKey, bytes })),
    uploads: uploads.map((u) => u.id),
  };
}

// ─── Acting ──────────────────────────────────────────────

/** Locks the project row, as a release commit and a pointer move do. */
async function lockProject(tx: CollectorTx, projectId: string): Promise<void> {
  await tx
    .select({ projectId: engineProjects.projectId })
    .from(engineProjects)
    .where(eq(engineProjects.projectId, projectId))
    .for("update");
}

/** Collects one release unless a pointer or a jam came to name it since the plan. */
async function collectRelease(
  db: CollectorDb,
  projectId: string,
  release: { id: string; version: number },
  now: Date,
): Promise<boolean> {
  return db.transaction(async (tx: CollectorTx) => {
    await lockProject(tx, projectId);
    const collected = await tx
      .update(engineReleases)
      .set({ collectedAt: now, manifest: null })
      .where(
        and(
          eq(engineReleases.id, release.id),
          isNull(engineReleases.collectedAt),
          sql`not exists (select 1 from ${engineReleaseChannels} where ${engineReleaseChannels.releaseId} = ${engineReleases.id})`,
          sql`not exists (select 1 from ${engineReleaseJamLinks} where ${engineReleaseJamLinks.releaseId} = ${engineReleases.id})`,
        ),
      )
      .returning({ id: engineReleases.id });
    if (collected.length === 0) return false;
    await tx.delete(engineReleaseFiles).where(eq(engineReleaseFiles.releaseId, release.id));
    await writeAudit(tx, {
      projectId,
      actor: { kind: "system" },
      action: "collect",
      releaseId: release.id,
      detail: { version: release.version },
      at: now,
    });
    return true;
  });
}

/** Whether a release file row or an open upload names `sha256` now. */
async function stillListed(
  db: CollectorTx,
  projectId: string,
  sha256: string,
  now: Date,
): Promise<boolean> {
  const [file] = await db
    .select({ one: sql<number>`1` })
    .from(engineReleaseFiles)
    .where(and(eq(engineReleaseFiles.projectId, projectId), eq(engineReleaseFiles.sha256, sha256)))
    .limit(1);
  if (file) return true;
  const open = await db
    .select({ manifest: engineReleaseUploads.manifest })
    .from(engineReleaseUploads)
    .where(
      and(
        eq(engineReleaseUploads.projectId, projectId),
        isNull(engineReleaseUploads.committedAt),
        gt(engineReleaseUploads.expiresAt, now),
      ),
    );
  return inFlightHashes(open.map((u) => u.manifest)).has(sha256);
}

/**
 * Removes a stored object and its row under the project's lock, unless a
 * release file or an open upload names its hash again, or `stillDue` says
 * the row no longer qualifies. True when it was removed.
 */
async function removeUnlisted(
  db: CollectorDb,
  objects: CollectorObjectStore,
  target: { projectId: string; sha256: string; storageKey: string; now: Date },
  row: {
    stillDue: (tx: CollectorTx) => Promise<boolean>;
    remove: (tx: CollectorTx) => Promise<unknown>;
  },
): Promise<boolean> {
  const { projectId, sha256, storageKey, now } = target;
  return db.transaction(async (tx: CollectorTx) => {
    await lockProject(tx, projectId);
    if (!(await row.stillDue(tx)) || (await stillListed(tx, projectId, sha256, now))) return false;
    await objects.remove(storageKey);
    await row.remove(tx);
    return true;
  });
}

// ─── The run ─────────────────────────────────────────────

const emptyTotals = (): CollectorTotals =>
  Object.fromEntries(
    COLLECTOR_STEPS.map((step) => [step, { count: 0, bytes: 0 }]),
  ) as CollectorTotals;

/** One run over every project: plan, log, and in `delete` mode act. Never throws. */
export async function runCollector(options: CollectorOptions): Promise<CollectorRun> {
  const { db, objects, mode, telemetry } = options;
  const clock = options.now ?? (() => new Date());
  const log = options.log ?? ((line: string) => console.log(line));
  const pause = options.pause ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  const purge = options.purge ?? ((releaseId: string) => purgeShell(releaseId));

  let acquired: boolean;
  try {
    acquired = await options.lock.acquire();
  } catch (error) {
    log(`[collector] lock unavailable, skipping this run: ${message(error)}`);
    telemetry.captureException(error, { during: "engine-collector-lock" });
    await heartbeat(db, clock(), { ok: false, error: `lock unavailable: ${message(error)}` }).catch(
      () => {},
    );
    return { ran: false, reason: "lock-failed" };
  }
  if (!acquired) {
    log("[collector] another instance holds the lock; skipping");
    return { ran: false, reason: "locked" };
  }

  const startedAt = clock();
  const acting = mode === "delete";
  const actions: CollectorAction[] = [];
  const totals = emptyTotals();
  const failures: { projectId: string; error: string }[] = [];
  let touched = 0;
  let projects = 0;
  log(
    `[collector] ${mode} run at ${startedAt.toISOString()}${objects ? "" : " (no bucket configured: objects are only reported)"}`,
  );

  /** Logs a planned deletion; true when this run makes it. */
  const plan = (action: CollectorAction, needsObjects: boolean): boolean => {
    actions.push(action);
    totals[action.step].count++;
    totals[action.step].bytes += action.bytes;
    const makes = acting && (!needsObjects || objects !== null);
    log(`[collector] ${makes ? "deleting" : "would delete"} ${describeAction(action)}`);
    return makes;
  };

  const scope = options.projects;
  if (scope && scope.length === 0) return finish();

  try {
    const live = await db
      .select({ projectId: engineProjects.projectId })
      .from(engineProjects)
      .where(
        and(
          isNull(engineProjects.deletedAt),
          scope ? inArray(engineProjects.projectId, [...scope]) : undefined,
        ),
      )
      .orderBy(asc(engineProjects.projectId));

    for (const { projectId } of live) {
      if (options.shouldStop?.()) break;
      projects++;
      try {
        const now = clock();
        const project = await planProject(
          db,
          projectId,
          now,
          options.liveProject?.(projectId) ?? null,
        );

        for (const release of project.releases) {
          const action = {
            step: "releases",
            projectId,
            target: release.id,
            bytes: release.bytes,
          } as const;
          if (!plan(action, false)) continue;
          if (!(await collectRelease(db, projectId, release, now))) {
            log(`[collector] kept ${release.id}: it was pinned after the plan`);
            continue;
          }
          await purge(release.id).catch((error: unknown) => {
            log(`[collector] edge purge of ${release.id} failed: ${message(error)}`);
          });
        }

        for (const orphan of project.orphans) {
          const action = {
            step: "orphans",
            projectId,
            target: orphan.storageKey,
            bytes: orphan.bytes,
          } as const;
          if (!plan(action, true)) continue;
          const objectRow = and(
            eq(engineReleaseObjects.projectId, projectId),
            eq(engineReleaseObjects.sha256, orphan.sha256),
          );
          const removed = await removeUnlisted(
            db,
            objects!,
            { projectId, sha256: orphan.sha256, storageKey: orphan.storageKey, now },
            {
              stillDue: async () => true,
              remove: (tx) => tx.delete(engineReleaseObjects).where(objectRow),
            },
          );
          if (!removed) log(`[collector] kept ${orphan.storageKey}: a release lists it again`);
        }

        // Bookkeeping, not deletion: a blob referenced today starts its grace from today.
        for (const batch of chunks(project.referenced)) {
          await db
            .update(engineBlobs)
            .set({ lastReferencedAt: now })
            .where(and(eq(engineBlobs.projectId, projectId), inArray(engineBlobs.sha256, batch)));
          touched += batch.length;
        }
        const blobCutoff = new Date(now.getTime() - BLOB_GRACE_DAYS * DAY_MS);
        for (const blob of project.blobs) {
          const action = {
            step: "blobs",
            projectId,
            target: blob.storageKey,
            bytes: blob.bytes,
          } as const;
          if (!plan(action, true)) continue;
          const quiet = and(
            eq(engineBlobs.projectId, projectId),
            eq(engineBlobs.sha256, blob.sha256),
            or(isNull(engineBlobs.lastReferencedAt), lte(engineBlobs.lastReferencedAt, blobCutoff)),
          );
          const removed = await removeUnlisted(
            db,
            objects!,
            { projectId, sha256: blob.sha256, storageKey: blob.storageKey, now },
            {
              stillDue: async (tx) =>
                (await tx.select({ sha256: engineBlobs.sha256 }).from(engineBlobs).where(quiet))
                  .length > 0,
              remove: (tx) => tx.delete(engineBlobs).where(quiet),
            },
          );
          if (!removed)
            log(`[collector] kept ${blob.storageKey}: it was referenced or listed after the plan`);
        }

        for (const id of project.uploads) {
          if (!plan({ step: "uploads", projectId, target: id, bytes: 0 }, false)) continue;
          await db
            .delete(engineReleaseUploads)
            .where(and(eq(engineReleaseUploads.id, id), isNull(engineReleaseUploads.committedAt)));
        }
      } catch (error) {
        failures.push({ projectId, error: message(error) });
        log(`[collector] project ${projectId} failed: ${message(error)}`);
        telemetry.captureException(error, { during: "engine-collector", project_id: projectId });
      }
      await pause();
    }

    const purgeBefore = new Date(clock().getTime() - PROJECT_PURGE_DAYS * DAY_MS);
    await expireSaves(savesDue(clock()), purgeBefore);

    const deleted = await db
      .select({ projectId: engineProjects.projectId })
      .from(engineProjects)
      .where(
        and(
          isNotNull(engineProjects.deletedAt),
          lte(engineProjects.deletedAt, purgeBefore),
          scope ? inArray(engineProjects.projectId, [...scope]) : undefined,
        ),
      )
      .orderBy(asc(engineProjects.projectId));

    for (const { projectId } of deleted) {
      if (options.shouldStop?.()) break;
      projects++;
      try {
        await purgeProject(projectId, purgeBefore);
      } catch (error) {
        failures.push({ projectId, error: message(error) });
        log(`[collector] deleted project ${projectId} failed: ${message(error)}`);
        telemetry.captureException(error, {
          during: "engine-collector-purge",
          project_id: projectId,
        });
      }
      await pause();
    }
  } catch (error) {
    failures.push({ projectId: "*", error: message(error) });
    log(`[collector] run failed: ${message(error)}`);
    telemetry.captureException(error, { during: "engine-collector" });
  }
  return finish();

  /**
   * Saves last used before `before`, 500 at a time: the object, then the row.
   * A project the purge step removes this run is left to it, so no save is
   * planned twice.
   */
  async function expireSaves(before: Date, purgeBefore: Date): Promise<void> {
    let after: { userId: string; projectId: string; slot: string } | undefined;
    for (;;) {
      if (options.shouldStop?.()) return;
      const rows = await db
        .select({
          userId: engineSaves.userId,
          projectId: engineSaves.projectId,
          slot: engineSaves.slot,
          bytes: engineSaves.bytes,
        })
        .from(engineSaves)
        .innerJoin(engineProjects, eq(engineProjects.projectId, engineSaves.projectId))
        .where(
          and(
            lt(engineSaves.usedAt, before),
            or(isNull(engineProjects.deletedAt), gt(engineProjects.deletedAt, purgeBefore)),
            scope ? inArray(engineSaves.projectId, [...scope]) : undefined,
            after
              ? sql`(${engineSaves.userId}, ${engineSaves.projectId}, ${engineSaves.slot}) > (${after.userId}, ${after.projectId}, ${after.slot})`
              : undefined,
          ),
        )
        .orderBy(asc(engineSaves.userId), asc(engineSaves.projectId), asc(engineSaves.slot))
        .limit(CHUNK);
      for (const row of rows) {
        const key = engineSaveKey(row.userId, row.projectId, row.slot);
        const action = {
          step: "saves",
          projectId: row.projectId,
          target: key,
          bytes: row.bytes,
        } as const;
        if (!plan(action, true)) continue;
        try {
          if (!(await removeSave(row, key, before)))
            log(`[collector] kept ${key}: it was used after the plan`);
        } catch (error) {
          // The bucket failing one save fails the rest: leave them to the next run.
          failures.push({ projectId: row.projectId, error: message(error) });
          log(`[collector] save ${key} failed: ${message(error)}`);
          telemetry.captureException(error, {
            during: "engine-collector-saves",
            project_id: row.projectId,
          });
          return;
        }
      }
      const last = rows.at(-1);
      if (rows.length < CHUNK || !last) return;
      after = last;
      await pause();
    }
  }

  /** Under the save's row lock, unless a read or a write used it since the plan. */
  async function removeSave(
    save: { userId: string; projectId: string; slot: string },
    key: string,
    before: Date,
  ): Promise<boolean> {
    const due = and(
      eq(engineSaves.userId, save.userId),
      eq(engineSaves.projectId, save.projectId),
      eq(engineSaves.slot, save.slot),
      lt(engineSaves.usedAt, before),
    );
    return db.transaction(async (tx: CollectorTx) => {
      const [row] = await tx
        .select({ slot: engineSaves.slot })
        .from(engineSaves)
        .where(due)
        .for("update");
      if (!row) return false;
      await objects!.remove(key);
      await tx.delete(engineSaves).where(due);
      return true;
    });
  }

  /**
   * Every object under the project's prefixes, every object its rows name and
   * its saves (read before anything goes, as deleting the row cascades them),
   * then the row.
   */
  async function purgeProject(projectId: string, purgeBefore: Date): Promise<void> {
    const sizes = new Map<string, number>();
    const saves = await db
      .select({ userId: engineSaves.userId, slot: engineSaves.slot, bytes: engineSaves.bytes })
      .from(engineSaves)
      .where(eq(engineSaves.projectId, projectId));
    for (const { userId, slot, bytes } of saves)
      sizes.set(engineSaveKey(userId, projectId, slot), bytes);
    const blobs = await db
      .select({ key: engineBlobs.storageKey, bytes: engineBlobs.byteSize })
      .from(engineBlobs)
      .where(eq(engineBlobs.projectId, projectId));
    const files = await db
      .select({ key: engineReleaseObjects.storageKey, bytes: engineReleaseObjects.bytes })
      .from(engineReleaseObjects)
      .where(eq(engineReleaseObjects.projectId, projectId));
    for (const { key, bytes } of [...blobs, ...files]) sizes.set(key, bytes);
    if (objects) {
      for (const prefix of engineProjectPrefixes(projectId))
        for (const key of await objects.list(prefix)) if (!sizes.has(key)) sizes.set(key, 0);
    }
    let removed = true;
    for (const key of [...sizes.keys()].sort()) {
      const makes = plan(
        { step: "projects", projectId, target: key, bytes: sizes.get(key)! },
        true,
      );
      if (makes) await objects!.remove(key);
      else removed = false;
    }
    // Without a bucket the row stays too: deleting it would leave objects nothing knows about.
    const makes = plan({ step: "projects", projectId, target: projectId, bytes: 0 }, true);
    if (!makes || !removed) return;
    await db
      .delete(engineProjects)
      .where(
        and(
          eq(engineProjects.projectId, projectId),
          isNotNull(engineProjects.deletedAt),
          lte(engineProjects.deletedAt, purgeBefore),
        ),
      );
  }

  async function finish(): Promise<CollectorRun> {
    const end = clock();
    const summary = COLLECTOR_STEPS.map(
      (step) => `${step} ${totals[step].count} (${formatBytes(totals[step].bytes)})`,
    ).join(", ");
    log(
      `[collector] ${mode} done in ${end.getTime() - startedAt.getTime()}ms: ${projects} project(s); ${summary}; ${touched} blob(s) still referenced; ${failures.length} failure(s)`,
    );
    telemetry.capture("engine_collector.run", {
      mode,
      objects: objects !== null,
      projects,
      failures: failures.length,
      touched,
      duration_ms: end.getTime() - startedAt.getTime(),
      ...Object.fromEntries(
        COLLECTOR_STEPS.flatMap((step) => [
          [`${step}_count`, totals[step].count],
          [`${step}_bytes`, totals[step].bytes],
        ]),
      ),
    });
    const outcome =
      failures.length === 0
        ? ({ ok: true } as const)
        : ({
            ok: false,
            error: failures.map((f) => `${f.projectId}: ${f.error}`).join("; "),
          } as const);
    await heartbeat(db, startedAt, outcome).catch((error) => {
      log(`[collector] heartbeat failed: ${message(error)}`);
      telemetry.captureException(error, { during: "engine-collector-heartbeat" });
    });
    return {
      ran: true,
      mode,
      startedAt,
      actions,
      totals,
      touched,
      projects,
      failures,
      objects: objects !== null,
    };
  }
}

/** The run's row in the table the crawler's tiers and the media-scan worker write; a stale `last_ok_at` is the alert. */
async function heartbeat(
  db: CollectorDb,
  startedAt: Date,
  outcome: { ok: true } | { ok: false; error: string },
): Promise<void> {
  const now = new Date();
  const set = {
    lastStartedAt: startedAt,
    nextRunAt: nextCollectorRun(new Date(startedAt.getTime() + 60_000)),
    updatedAt: now,
    ...(outcome.ok ? { lastOkAt: now, lastError: null } : { lastError: outcome.error }),
  };
  await db
    .insert(itchTierHeartbeats)
    .values({ tier: COLLECTOR_TIER, ...set })
    .onConflictDoUpdate({ target: itchTierHeartbeats.tier, set });
}

// ─── The timer ───────────────────────────────────────────

/**
 * Runs `run` daily at the collector's time (03:30 UTC), never two at once.
 * Returns a stop that cancels the next run and asks a running one to end
 * between projects; it resolves when that run has.
 */
export function startCollectorTimer(
  run: (shouldStop: () => boolean) => Promise<unknown>,
  now: () => Date = () => new Date(),
): () => Promise<void> {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<unknown> | null = null;
  let firedAt = Number.NEGATIVE_INFINITY;
  const schedule = () => {
    if (stopped) return;
    // A minute past the last run, so a timer that fires a little early doesn't run it twice.
    const at = nextCollectorRun(new Date(Math.max(now().getTime(), firedAt + 60_000)));
    timer = setTimeout(
      () => {
        firedAt = now().getTime();
        running = run(() => stopped)
          .catch((error) => console.error(`[collector] run failed: ${message(error)}`))
          .finally(() => {
            running = null;
            schedule();
          });
      },
      Math.max(0, at.getTime() - now().getTime()),
    );
    timer.unref?.();
  };
  schedule();
  return async () => {
    stopped = true;
    clearTimeout(timer);
    await running;
  };
}
