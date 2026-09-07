import {
  bannerScanJobId,
  entryScanJobId,
  uploadScanJobId,
} from "../../../../src/lib/media-scan-queue.ts";
import { config } from "../config.ts";
import { heartbeat } from "../heartbeat.ts";
import { closeQueues, enqueueScans, type ScanJob } from "../queue.ts";
import { DETECTOR_VERSION } from "../scan/entry.ts";
import { NSFW_MODEL } from "../scan/nsfw.ts";
import {
  dueBannerJams,
  dueRevisitEntries,
  dueScanEntries,
  dueScanJams,
  dueUploads,
} from "./selectors.ts";

/**
 * The hourly DB sweep: everything `scanDue` and friends say is owed a look
 * becomes a job, bounded per kind so a detector bump drains at a chosen
 * pace instead of flooding Redis with 640k jobs at once. Job ids dedupe
 * against whatever the crawler and the upload handlers already enqueued,
 * so the common case adds nothing — the reconciler exists for what no event
 * reached: version bumps, drift revisits, jobs lost to a Redis restart, and
 * the first run after a deploy.
 *
 *   bun run reconcile   (one-off, for a local drain)
 */

/** Candidate jams pulled per refill while filling the entry budget. */
const JAM_REFILL_LIMIT = 100;

export type ReconcileTally = {
  entries: number;
  revisits: number;
  banners: number;
  uploads: number;
};

export async function runReconcile(opts: { nsfwEnabled: boolean }): Promise<ReconcileTally> {
  const due = {
    detectorVersion: DETECTOR_VERSION,
    model: NSFW_MODEL,
    nsfwEnabled: opts.nsfwEnabled,
  };
  const jobs: ScanJob[] = [];
  const tally: ReconcileTally = { entries: 0, revisits: 0, banners: 0, uploads: 0 };

  // Entries: newest jam first, whole jams at a time, until the batch is spent.
  const seen: number[] = [];
  let remaining = config.SCAN_BATCH;
  while (remaining > 0) {
    const jamIds = await dueScanJams(due, JAM_REFILL_LIMIT, seen);
    if (jamIds.length === 0) break;
    for (const jamId of jamIds) {
      if (remaining <= 0) break;
      seen.push(jamId);
      const entries = await dueScanEntries(jamId, due, remaining);
      for (const e of entries) {
        jobs.push({
          name: "entry",
          data: { entryId: e.entryId },
          jobId: entryScanJobId(e.entryId, e.gameCoverUrl),
        });
      }
      remaining -= entries.length;
      tally.entries += entries.length;
    }
  }

  for (const e of await dueRevisitEntries(DETECTOR_VERSION, config.SCAN_REVISIT_BATCH)) {
    // A revisit is the same job; the processor picks the one-request path.
    // The id carries the visit hour so it never collides with a first scan
    // still queued for the same cover.
    jobs.push({
      name: "entry",
      data: { entryId: e.entryId },
      jobId: `${entryScanJobId(e.entryId, e.gameCoverUrl)}-revisit-${Math.floor(Date.now() / 3_600_000)}`,
    });
    tally.revisits++;
  }

  for (const jam of await dueBannerJams(due, config.BANNER_BATCH)) {
    jobs.push({
      name: "banner",
      data: { jamId: jam.jamId },
      jobId: bannerScanJobId(jam.jamId, jam.bannerUrl),
    });
    tally.banners++;
  }

  for (const objectKey of await dueUploads(DETECTOR_VERSION, config.UPLOAD_BATCH)) {
    jobs.push({ name: "upload", data: { objectKey }, jobId: uploadScanJobId(objectKey) });
    tally.uploads++;
  }

  await enqueueScans(jobs);
  console.log(
    `[reconcile] enqueued entries=${tally.entries} revisits=${tally.revisits} banners=${tally.banners} uploads=${tally.uploads}`,
  );
  return tally;
}

if (import.meta.main) {
  const { pool } = await import("../db/client.ts");
  try {
    await runReconcile({ nsfwEnabled: config.NSFW_ENABLED });
    await heartbeat("media-scan-reconcile", { ok: true });
  } finally {
    await closeQueues();
    await pool.end().catch(() => {});
    const { queueRedis, pacerRedis } = await import("../redis.ts");
    queueRedis.disconnect();
    pacerRedis.disconnect();
  }
}
