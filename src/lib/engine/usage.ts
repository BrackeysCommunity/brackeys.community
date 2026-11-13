import type { ProjectUsage } from "@jams/engine/project";
import { and, count, desc, eq, inArray, isNull, sum } from "drizzle-orm";

import { db } from "@/db";
import {
  engineAssetDocs,
  engineBlobs,
  engineProjects,
  engineReleaseChannels,
  engineReleaseJamLinks,
  engineReleaseObjects,
  engineReleases,
  engineSceneVersionFiles,
  engineSceneVersions,
  sceneDocs,
} from "@/db/schema";
import { readProjectState } from "@/lib/scene/project-bytes";

import { collectionForecast } from "./collect-plan";
import { usageLines, type UsageLine } from "./quota";
import type { ReleaseDb } from "./release-audit";

/** What a hosted project stores, from its rows. */
export type StoredUsage = {
  /** Every `engine_blobs` row: live, trashed and replaced versions. */
  blobBytes: number;
  /** Blobs a live asset holds as its current content. */
  liveBlobBytes: number;
  /** Blobs only trashed assets hold: what emptying the trash frees. */
  trashBytes: number;
  /** Trashed assets that still name a blob: what emptying the trash deletes. */
  trashAssets: number;
  /** Every other stored blob: replaced versions, until the cleanup grace passes. */
  historyBytes: number;
  docs: number;
  docBytes: number;
  /** Every version ever published, collected ones included. */
  releases: number;
  /** Versions whose files are still stored. */
  keptReleases: number;
  pinned: { channels: number; jams: number };
  /**
   * Unique stored release files (`engine_release_objects`), scene versions'
   * texts included; files served from the project's blobs aren't counted.
   */
  releaseStorageBytes: number;
  largestRelease: { version: number; bytes: number } | null;
  /** Releases published since midnight UTC. */
  releasesToday: number;
  /**
   * Scene versions still stored, and the release storage their texts take:
   * each unique text once, whether a release or another version shares it.
   */
  liveVersions: { kept: number; bytes: number };
  /** Scene versions published since midnight UTC, collected ones included. */
  liveToday: number;
  /** What the collector will remove, and when (ISO 8601). */
  nextCollection: { version: number; at: string }[];
};

/** Each quota's line before a release and after it. */
export type UsageReport = { before: UsageLine[]; after: UsageLine[] };

const DAY_MS = 86_400_000;

const startOfUtcDay = (at: Date) => new Date(Math.floor(at.getTime() / DAY_MS) * DAY_MS);

/**
 * What the policy is asked with: every scene and asset doc row and every
 * blob row the project holds. Trashed docs and blobs count, since they are
 * still stored; `trashBytes` is `storedUsage`'s to break down.
 */
export async function storedProjectUsage(
  projectId: string,
  handle: ReleaseDb = db,
): Promise<ProjectUsage> {
  const [[assets], [scenes], [blobs]] = await Promise.all([
    handle
      .select({ n: count(), bytes: sum(engineAssetDocs.byteSize) })
      .from(engineAssetDocs)
      .where(eq(engineAssetDocs.projectId, projectId)),
    handle
      .select({ n: count(), bytes: sum(sceneDocs.byteSize) })
      .from(sceneDocs)
      .where(eq(sceneDocs.projectId, projectId)),
    handle
      .select({ n: count(), bytes: sum(engineBlobs.byteSize) })
      .from(engineBlobs)
      .where(eq(engineBlobs.projectId, projectId)),
  ]);
  return {
    docs: (assets?.n ?? 0) + (scenes?.n ?? 0),
    docBytes: Number(assets?.bytes ?? 0) + Number(scenes?.bytes ?? 0),
    blobs: blobs?.n ?? 0,
    blobBytes: Number(blobs?.bytes ?? 0),
    trashBytes: 0,
  };
}

/**
 * Splits the stored blobs by what the registry holds them for: a live
 * asset's current content, only trashed assets, or neither (replaced
 * versions and blobs nothing names, which the collector removes after its
 * grace). With no readable registry every blob counts as live.
 */
function blobBreakdown(
  state: Uint8Array | null,
  blobs: readonly { sha256: string; bytes: number }[],
): Pick<StoredUsage, "liveBlobBytes" | "trashBytes" | "trashAssets" | "historyBytes"> {
  const total = blobs.reduce((n, b) => n + b.bytes, 0);
  if (!state || state.byteLength === 0)
    return { liveBlobBytes: total, trashBytes: 0, trashAssets: 0, historyBytes: 0 };
  let registry;
  try {
    registry = readProjectState(state);
  } catch {
    return { liveBlobBytes: total, trashBytes: 0, trashAssets: 0, historyBytes: 0 };
  }
  const live = new Set<string>();
  const trashed = new Set<string>();
  let trashAssets = 0;
  for (const entry of Object.values(registry.assets)) {
    if (entry.sha256 === undefined) continue;
    if (!entry.deleted) {
      live.add(entry.sha256);
      continue;
    }
    trashAssets += 1;
    trashed.add(entry.sha256);
    for (const h of registry.history[entry.key] ?? []) trashed.add(h.sha256);
  }
  const out = { liveBlobBytes: 0, trashBytes: 0, trashAssets, historyBytes: 0 };
  for (const { sha256, bytes } of blobs) {
    if (live.has(sha256)) out.liveBlobBytes += bytes;
    else if (trashed.has(sha256)) out.trashBytes += bytes;
    else out.historyBytes += bytes;
  }
  return out;
}

/**
 * A hosted project's stored usage against every quota: its docs and blobs
 * (split by what the registry holds them for), its releases and pins, the
 * release storage its unique release objects take, its scene versions,
 * and what the collector removes next.
 */
export async function storedUsage(
  handle: ReleaseDb,
  projectId: string,
  now: Date = new Date(),
): Promise<StoredUsage> {
  const keptVersionTexts = handle
    .select({ sha256: engineSceneVersionFiles.sha256 })
    .from(engineSceneVersionFiles)
    .innerJoin(engineSceneVersions, eq(engineSceneVersions.id, engineSceneVersionFiles.versionId))
    .where(
      and(
        eq(engineSceneVersionFiles.projectId, projectId),
        eq(engineSceneVersionFiles.source, "release"),
        isNull(engineSceneVersions.collectedAt),
      ),
    );
  const [docs, [project], blobs, releases, channels, jams, [objects], versions, [liveObjects]] =
    await Promise.all([
      storedProjectUsage(projectId, handle),
      handle
        .select({ state: engineProjects.state })
        .from(engineProjects)
        .where(eq(engineProjects.projectId, projectId)),
      handle
        .select({ sha256: engineBlobs.sha256, bytes: engineBlobs.byteSize })
        .from(engineBlobs)
        .where(eq(engineBlobs.projectId, projectId)),
      handle
        .select({
          id: engineReleases.id,
          version: engineReleases.version,
          totalBytes: engineReleases.totalBytes,
          createdAt: engineReleases.createdAt,
          collectedAt: engineReleases.collectedAt,
        })
        .from(engineReleases)
        .where(eq(engineReleases.projectId, projectId))
        .orderBy(desc(engineReleases.version)),
      handle
        .select({ releaseId: engineReleaseChannels.releaseId })
        .from(engineReleaseChannels)
        .where(eq(engineReleaseChannels.projectId, projectId)),
      handle
        .select({ releaseId: engineReleaseJamLinks.releaseId })
        .from(engineReleaseJamLinks)
        .where(eq(engineReleaseJamLinks.projectId, projectId)),
      handle
        .select({ bytes: sum(engineReleaseObjects.bytes) })
        .from(engineReleaseObjects)
        .where(eq(engineReleaseObjects.projectId, projectId)),
      handle
        .select({
          createdAt: engineSceneVersions.createdAt,
          collectedAt: engineSceneVersions.collectedAt,
        })
        .from(engineSceneVersions)
        .where(eq(engineSceneVersions.projectId, projectId)),
      handle
        .select({ bytes: sum(engineReleaseObjects.bytes) })
        .from(engineReleaseObjects)
        .where(
          and(
            eq(engineReleaseObjects.projectId, projectId),
            inArray(engineReleaseObjects.sha256, keptVersionTexts),
          ),
        ),
    ]);

  const dayStart = startOfUtcDay(now);
  const kept = releases.filter((r) => r.collectedAt === null);
  let largestRelease: StoredUsage["largestRelease"] = null;
  for (const r of kept)
    if (!largestRelease || r.totalBytes > largestRelease.bytes)
      largestRelease = { version: r.version, bytes: r.totalBytes };

  const pins = {
    channels: channels.map((c) => c.releaseId),
    jams: jams.map((j) => j.releaseId),
  };
  const nextCollection = collectionForecast(releases, pins, now).map(({ version, at }) => ({
    version,
    at: at.toISOString(),
  }));

  return {
    blobBytes: docs.blobBytes,
    ...blobBreakdown(
      project?.state ? new Uint8Array(project.state) : null,
      blobs.map((b) => ({ sha256: b.sha256, bytes: b.bytes })),
    ),
    docs: docs.docs,
    docBytes: docs.docBytes,
    releases: releases.length,
    keptReleases: kept.length,
    pinned: { channels: channels.length, jams: jams.length },
    releaseStorageBytes: Number(objects?.bytes ?? 0),
    largestRelease,
    releasesToday: releases.filter((r) => r.createdAt >= dayStart).length,
    liveVersions: {
      kept: versions.filter((v) => v.collectedAt === null).length,
      bytes: Number(liveObjects?.bytes ?? 0),
    },
    liveToday: versions.filter((v) => v.createdAt >= dayStart).length,
    nextCollection,
  };
}

/**
 * The lines before a release and with it stored: what it adds to release
 * storage, one more release today, and the largest release if it is larger.
 */
export function releaseUsageReport(
  stored: StoredUsage,
  release: { version: number; totalBytes: number; addsBytes: number },
): UsageReport {
  const largest =
    stored.largestRelease && stored.largestRelease.bytes >= release.totalBytes
      ? stored.largestRelease
      : { version: release.version, bytes: release.totalBytes };
  return {
    before: usageLines(stored),
    after: usageLines({
      ...stored,
      releaseStorageBytes: stored.releaseStorageBytes + release.addsBytes,
      releasesToday: stored.releasesToday + 1,
      largestRelease: largest,
    }),
  };
}

/** `getProjectUsage`'s answer: the stored usage and its lines. */
export async function projectUsageReport(
  projectId: string,
  now: Date = new Date(),
): Promise<{ usage: StoredUsage; lines: UsageLine[] }> {
  const usage = await storedUsage(db, projectId, now);
  return { usage, lines: usageLines(usage) };
}
