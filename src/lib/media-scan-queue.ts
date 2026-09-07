/**
 * The `media-scan` queue contract: the one place producers (the crawler,
 * the app's upload handlers, the worker's own reconciler) and the consumer
 * (services/media-scan) agree on names, payloads, and job ids. A typo'd
 * queue name is a silently-empty queue, so there is exactly one constant.
 *
 * Job ids carry the image's identity, which is what makes the queue
 * idempotent under the live tier's half-hourly upserts: the same cover
 * enqueued twice collapses to one job, a replaced cover is a new id and a
 * new job. BullMQ custom ids must not contain colons, hence the dashes.
 *
 * Import-graph neutral — no imports at all; services COPY this file.
 */

export const MEDIA_SCAN_QUEUE = "media-scan";

export type MediaScanJobData = {
  /** One jam entry's cover: fetch, hash, score, match, flag. */
  entry: { entryId: number };
  /** One jam's banner: fetch, hash, score — no flags in v1. */
  banner: { jamId: number };
  /** One uploaded object, read straight from the bucket. */
  upload: { objectKey: string };
  /** Staff-requested re-run; the target's version is zeroed first. */
  rescan: { kind: "entry" | "banner" | "upload"; id: string };
  /** The hourly DB sweep that enqueues whatever no event reached. */
  reconcile: Record<string, never>;
};

export type MediaScanJobName = keyof MediaScanJobData;

export const RECONCILE_JOB_ID = "reconcile";

/** Options every scan job shares. A dead cover completes (recorded as
 * gone), so failures here are transient fetch or DB errors worth a retry. */
export const MEDIA_SCAN_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: "exponential", delay: 30_000 },
  removeOnComplete: 5000,
  removeOnFail: 5000,
} as const;

/**
 * The stable identity of an itch image. Every `img.itch.zone` URL's first
 * path segment is base64 of `img/<image id>.<ext>`; the derivative size and
 * signature that follow differ between entries.json and data.json for the
 * same picture (300x240 vs 315x250), so URLs never compare equal even when
 * the image hasn't changed. This decodes to the numeric id. Anything that
 * isn't such a URL yields a sanitized stand-in for its first segment, and
 * a missing URL yields null.
 */
export function itchImageId(url: string | null | undefined): string | null {
  if (!url) return null;
  let segment: string;
  try {
    segment = decodeURIComponent(new URL(url).pathname.split("/")[1] ?? "");
  } catch {
    return null;
  }
  if (!segment) return null;
  try {
    const decoded = atob(segment);
    const match = /^img\/(\d+)\./.exec(decoded);
    if (match?.[1]) return match[1];
  } catch {
    // Not base64 — fall through to the stand-in.
  }
  return segment.replace(/[^A-Za-z0-9._-]/g, "_");
}

export function entryScanJobId(entryId: number, coverUrl: string | null | undefined): string {
  return `entry-${entryId}-${itchImageId(coverUrl) ?? "none"}`;
}

export function bannerScanJobId(jamId: number, bannerUrl: string | null | undefined): string {
  return `banner-${jamId}-${itchImageId(bannerUrl) ?? "none"}`;
}

export function uploadScanJobId(objectKey: string): string {
  return `upload-${objectKey.replace(/[^A-Za-z0-9._/-]/g, "_")}`;
}

export function rescanJobId(kind: MediaScanJobData["rescan"]["kind"], id: string): string {
  return `rescan-${kind}-${id.replace(/[^A-Za-z0-9._/-]/g, "_")}-${Date.now()}`;
}
