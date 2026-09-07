import { Queue } from "bullmq";

import {
  bannerScanJobId,
  entryScanJobId,
  MEDIA_SCAN_JOB_OPTIONS,
  MEDIA_SCAN_QUEUE,
  type MediaScanJobData,
} from "../../../src/lib/media-scan-queue.ts";
import { queueRedis } from "./redis.ts";

/**
 * The crawler's side of the media-scan queue: it emits a job for what it
 * observes — a new entry, an entry whose cover image changed, a jam whose
 * banner changed — and the resident worker scans it within seconds.
 *
 * Fire-and-forget on purpose. bullmq's add() waits for the connection and
 * never settles while Redis is down, and a sync that must complete without
 * Redis cannot await it. A lost enqueue costs nothing but latency: the
 * worker's hourly reconciler derives the same set from the DB.
 */
const queue = queueRedis ? new Queue(MEDIA_SCAN_QUEUE, { connection: queueRedis }) : null;

let warned = false;

function emit<Name extends "entry" | "banner">(
  name: Name,
  data: MediaScanJobData[Name],
  jobId: string,
): void {
  if (!queue) return;
  queue.add(name, data, { ...MEDIA_SCAN_JOB_OPTIONS, jobId }).catch((err: unknown) => {
    if (warned) return;
    warned = true;
    console.warn(
      `[queue] failed to enqueue ${name} scans (${err instanceof Error ? err.message : String(err)}) — the reconciler will pick them up`,
    );
  });
}

export function emitEntryScans(
  entries: readonly { entryId: number; gameCoverUrl: string | null }[],
) {
  for (const e of entries) {
    emit("entry", { entryId: e.entryId }, entryScanJobId(e.entryId, e.gameCoverUrl));
  }
}

export function emitBannerScan(jamId: number, bannerUrl: string | null) {
  emit("banner", { jamId }, bannerScanJobId(jamId, bannerUrl));
}

export async function closeQueue(): Promise<void> {
  await queue?.close().catch(() => {});
}
