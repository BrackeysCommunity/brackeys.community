// The collector's plan, pure, so the root suite tests it and canvas-sync
// copies it. Its only import is `limits.ts`, which the image copies too.

import {
  BLOB_GRACE_DAYS,
  PROJECT_QUOTA,
  RELEASE_GRACE_DAYS,
  SITE_SAVE_EXPIRY_DAYS,
} from "./limits.ts";

export type ReleaseRow = { id: string; version: number; createdAt: Date; collectedAt: Date | null };
/** The release ids a channel pointer or a jam version names. */
export type Pins = { channels: readonly string[]; jams: readonly string[] };

const DAY_MS = 86_400_000;

/** The collector's daily run, in UTC. */
export const COLLECTOR_RUN_UTC = { hour: 3, minute: 30 } as const;

/** The first collector run at or after `at`. */
export function nextCollectorRun(at: Date): Date {
  const run = new Date(
    Date.UTC(
      at.getUTCFullYear(),
      at.getUTCMonth(),
      at.getUTCDate(),
      COLLECTOR_RUN_UTC.hour,
      COLLECTOR_RUN_UTC.minute,
    ),
  );
  return run.getTime() >= at.getTime() ? run : new Date(run.getTime() + DAY_MS);
}

/** The live releases outside the newest kept and unpinned, oldest first, each with when its grace ends. */
function beyondKept(
  releases: readonly ReleaseRow[],
  pins: Pins,
): { row: ReleaseRow; dueAt: Date }[] {
  const pinned = new Set([...pins.channels, ...pins.jams]);
  const live = releases
    .filter((r) => r.collectedAt === null)
    .sort((a, b) => b.version - a.version || b.createdAt.getTime() - a.createdAt.getTime());
  return live
    .slice(PROJECT_QUOTA.releasesKept)
    .filter((r) => !pinned.has(r.id))
    .reverse()
    .map((row) => ({
      row,
      dueAt: new Date(row.createdAt.getTime() + RELEASE_GRACE_DAYS * DAY_MS),
    }));
}

/** The releases to collect now: not among the newest kept, not pinned, past the grace. */
export function releasesToCollect(
  releases: readonly ReleaseRow[],
  pins: Pins,
  now: Date,
): string[] {
  return beyondKept(releases, pins)
    .filter(({ dueAt }) => dueAt.getTime() <= now.getTime())
    .map(({ row }) => row.id);
}

/**
 * When each unpinned release outside the kept set will go, for the release
 * list and the Usage section: the first run after its grace ends, oldest first.
 * One inside the kept set has no date, since only newer releases push it out.
 */
export function collectionForecast(
  releases: readonly ReleaseRow[],
  pins: Pins,
  now: Date,
): { version: number; at: Date }[] {
  return beyondKept(releases, pins).map(({ row, dueAt }) => ({
    version: row.version,
    at: nextCollectorRun(dueAt.getTime() > now.getTime() ? dueAt : now),
  }));
}

/** The unreferenced blobs quiet for the whole grace, by when they were last referenced, else stored. */
export function blobsDue(
  unreferenced: readonly string[],
  rows: readonly { sha256: string; createdAt: Date; lastReferencedAt: Date | null }[],
  now: Date,
): string[] {
  const candidates = new Set(unreferenced);
  const cutoff = now.getTime() - BLOB_GRACE_DAYS * DAY_MS;
  return rows
    .filter(
      (r) => candidates.has(r.sha256) && (r.lastReferencedAt ?? r.createdAt).getTime() <= cutoff,
    )
    .map((r) => r.sha256);
}

/** A save last used before this is expired. */
export function savesDue(now: Date): Date {
  return new Date(now.getTime() - SITE_SAVE_EXPIRY_DAYS * DAY_MS);
}
