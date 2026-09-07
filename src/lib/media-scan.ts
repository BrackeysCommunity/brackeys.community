import { eq } from "drizzle-orm";

import { db } from "@/db";
import { imageScans } from "@/db/schema";
import {
  MEDIA_SCAN_JOB_OPTIONS,
  type MediaScanJobData,
  rescanJobId,
  uploadScanJobId,
} from "@/lib/media-scan-queue";
import { bestEffort } from "@/lib/posthog-server";
import { getMediaScanQueue } from "@/lib/queue";
import { describeImageKey } from "@/lib/stored-image-keys";

/**
 * The app's producer side of the media-scan queue. The bookkeeping row is
 * written synchronously — it is what makes the image *due*, so the hourly
 * reconciler in the worker picks it up even if the enqueue below is lost —
 * and the enqueue is the latency path: fire-and-forget, never awaited on a
 * request that must complete without Redis (bullmq's add() never settles
 * during an outage).
 */
export async function requestUploadScan(objectKey: string, uploaderId: string): Promise<void> {
  const owner = describeImageKey(objectKey);
  if (!owner) return;
  await db
    .insert(imageScans)
    .values({ objectKey, ownerType: owner.ownerType, ownerId: owner.ownerId, uploaderId })
    .onConflictDoNothing();
  enqueue("upload", { objectKey }, uploadScanJobId(objectKey));
}

/** Staff re-run: zero the version so the reconciler also sees it as due. */
export async function enqueueImageRescan(objectKey: string): Promise<void> {
  await db
    .update(imageScans)
    .set({ detectorVersion: 0 })
    .where(eq(imageScans.objectKey, objectKey));
  enqueue("rescan", { kind: "upload", id: objectKey }, rescanJobId("upload", objectKey));
}

function enqueue<Name extends keyof MediaScanJobData>(
  name: Name,
  data: MediaScanJobData[Name],
  jobId: string,
): void {
  void bestEffort("media_scan.enqueue", { job: name, job_id: jobId }, async () => {
    const queue = await getMediaScanQueue();
    await queue.add(name, data, { ...MEDIA_SCAN_JOB_OPTIONS, jobId });
  });
}
