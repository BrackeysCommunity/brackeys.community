import { Queue } from "bullmq";

import {
  MEDIA_SCAN_JOB_OPTIONS,
  MEDIA_SCAN_QUEUE,
  type MediaScanJobData,
  type MediaScanJobName,
} from "../../../src/lib/media-scan-queue.ts";
import { NOTIFICATIONS_QUEUE } from "../../../src/lib/notify-core.ts";
import { queueRedis } from "./redis.ts";

export { MEDIA_SCAN_QUEUE };

/** The worker's own producer handle — the reconciler enqueues through it. */
export const mediaScanQueue = new Queue(MEDIA_SCAN_QUEUE, { connection: queueRedis });

/** For the uploader's quarantine notice; consumed by notifications-worker. */
export const notificationsQueue = new Queue(NOTIFICATIONS_QUEUE, { connection: queueRedis });

export type ScanJob = {
  [Name in MediaScanJobName]: { name: Name; data: MediaScanJobData[Name]; jobId: string };
}[MediaScanJobName];

/** Adds many jobs at once; ids dedupe against whatever is already queued. */
export async function enqueueScans(jobs: readonly ScanJob[]): Promise<number> {
  if (jobs.length === 0) return 0;
  const added = await mediaScanQueue.addBulk(
    jobs.map((job) => ({
      name: job.name,
      data: job.data,
      opts: { ...MEDIA_SCAN_JOB_OPTIONS, jobId: job.jobId },
    })),
  );
  return added.length;
}

export async function closeQueues(): Promise<void> {
  await Promise.allSettled([mediaScanQueue.close(), notificationsQueue.close()]);
}
