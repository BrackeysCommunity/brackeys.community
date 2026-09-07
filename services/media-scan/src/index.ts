import { type Job, Worker } from "bullmq";
import { and, eq, inArray } from "drizzle-orm";

import { imageScans, itchEntryScans, itchJamScans } from "../../../src/db/schema.ts";
import {
  type MediaScanJobData,
  type MediaScanJobName,
  RECONCILE_JOB_ID,
} from "../../../src/lib/media-scan-queue.ts";
import { createServiceTelemetry } from "../../../src/lib/service-telemetry.ts";
import { config } from "./config.ts";
import { db, pool } from "./db/client.ts";
import { heartbeat } from "./heartbeat.ts";
import { describeError } from "./http.ts";
import { closeLocks, JamBusyError } from "./jobs/locks.ts";
import { runReconcile } from "./jobs/reconcile.ts";
import { closeQueues, MEDIA_SCAN_QUEUE, mediaScanQueue } from "./queue.ts";
import { pacerRedis, queueRedis } from "./redis.ts";
import { scanBannerById } from "./scan/banner.ts";
import { type ScanContext, scanEntryById } from "./scan/entry.ts";
import { initNsfw } from "./scan/nsfw.ts";
import { scanUploadByKey } from "./scan/upload.ts";

/**
 * The media-scan worker (plan 27): one resident process, the model loaded
 * once, consuming the `media-scan` queue. Producers are the crawler (new
 * entries, changed covers and banners), the web app (every upload), and the
 * hourly reconciler registered below (whatever the DB says is due that no
 * event reached). The DB stays the source of truth for "is this due"; the
 * queue is the latency path — losing it degrades to hourly, never below.
 */

const telemetry = createServiceTelemetry("media-scan");

const nsfwEnabled = config.NSFW_ENABLED && (await initNsfw());
if (config.NSFW_ENABLED && !nsfwEnabled) {
  console.warn("[boot] NSFW scoring unavailable — hashing and matching continue without it");
}
const ctx: ScanContext = { nsfwEnabled };

type AnyJob = { [N in MediaScanJobName]: Job<MediaScanJobData[N], unknown, N> }[MediaScanJobName];

async function processJob(job: AnyJob): Promise<unknown> {
  switch (job.name) {
    case "entry": {
      const out = await scanEntryById(job.data.entryId, ctx);
      return out === "missing" ? { skipped: "missing" } : out;
    }
    case "banner": {
      const out = await scanBannerById(job.data.jamId, ctx);
      return out === "missing" ? { skipped: "missing" } : out;
    }
    case "upload":
      return scanUploadByKey(job.data.objectKey, ctx);
    case "rescan":
      return rescan(job.data);
    case "reconcile": {
      const tally = await runReconcile({ nsfwEnabled });
      await heartbeat("media-scan-reconcile", { ok: true });
      return tally;
    }
    default:
      console.warn("[worker] unknown job", { name: (job as Job).name });
      return undefined;
  }
}

/** A staff re-run: zero the target's version (so the reconciler agrees it
 * is due even if this job is lost), then scan it now. */
async function rescan(data: MediaScanJobData["rescan"]): Promise<unknown> {
  switch (data.kind) {
    case "entry": {
      const entryId = Number(data.id);
      await db
        .update(itchEntryScans)
        .set({ detectorVersion: 0 })
        .where(eq(itchEntryScans.entryId, entryId));
      return scanEntryById(entryId, ctx);
    }
    case "banner": {
      const jamId = Number(data.id);
      await db
        .update(itchJamScans)
        .set({ detectorVersion: 0 })
        .where(eq(itchJamScans.jamId, jamId));
      return scanBannerById(jamId, ctx);
    }
    case "upload":
      await db
        .update(imageScans)
        .set({ detectorVersion: 0 })
        .where(
          and(
            eq(imageScans.objectKey, data.id),
            inArray(imageScans.status, ["pending", "scanned", "cleared", "quarantined"]),
          ),
        );
      return scanUploadByKey(data.id, ctx);
  }
}

const worker = new Worker(MEDIA_SCAN_QUEUE, (job) => processJob(job as AnyJob), {
  connection: queueRedis,
  concurrency: config.SCAN_CONCURRENCY,
});

worker.on("ready", () => console.log(`[worker:${MEDIA_SCAN_QUEUE}] ready`));
worker.on("completed", (job, result) => {
  if (job.name === "reconcile") return;
  console.log(`[${job.name}] done ${job.id}`, result);
});
worker.on("failed", (job, err) => {
  // Another instance holds the jam: a normal retry, not an incident.
  if (err instanceof JamBusyError) {
    console.log(`[${job?.name}] ${job?.id} deferred — ${err.message}`);
    return;
  }
  console.error(`[${job?.name}] FAIL ${job?.id}: ${describeError(err)}`);
  telemetry.captureException(err, {
    queue: MEDIA_SCAN_QUEUE,
    job_name: job?.name,
    job_id: job?.id,
  });
  if (job?.name === "reconcile") {
    void heartbeat("media-scan-reconcile", { ok: false, error: describeError(err) }).catch(
      () => {},
    );
  }
});
worker.on("error", (err) => {
  console.error("[worker] error", err);
  telemetry.captureException(err, { queue: MEDIA_SCAN_QUEUE, scope: "worker" });
});

// The reconciler: repeatable on the configured cron with a stable id so a
// redeploy never registers a second scheduler, plus one run now so a fresh
// deploy (and a detector bump) starts draining without waiting for :15.
await mediaScanQueue.add(
  "reconcile",
  {},
  { repeat: { pattern: config.RECONCILE_CRON, tz: "UTC" }, jobId: RECONCILE_JOB_ID },
);
await mediaScanQueue.add(
  "reconcile",
  {},
  { jobId: `${RECONCILE_JOB_ID}-boot-${Date.now()}`, removeOnComplete: true, removeOnFail: true },
);

console.log(
  `[boot] media-scan started — concurrency ${config.SCAN_CONCURRENCY}, nsfw ${nsfwEnabled ? "on" : "off"}, quarantine ≥ ${config.UPLOAD_QUARANTINE_THRESHOLD}`,
);

async function shutdown(signal: string) {
  console.log(`[boot] received ${signal}, draining...`);
  await worker.close();
  await closeQueues();
  await closeLocks();
  await Promise.allSettled([queueRedis.quit(), pacerRedis.quit()]);
  await pool.end().catch(() => {});
  await telemetry.shutdown();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
