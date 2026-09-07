import { and, asc, desc, eq, gt, inArray, isNull, lt, notInArray, or, sql } from "drizzle-orm";

import {
  imageScans,
  itchEntryScans,
  itchJamEntries,
  itchJams,
  itchJamScans,
} from "../../../../src/db/schema.ts";
import { config } from "../config.ts";
import { db } from "../db/client.ts";

/**
 * What the hourly reconciler owes a look. The DB is the source of truth for
 * "is this due"; the queue is only the latency path, so every event a
 * crawler or an upload handler emits is also derivable from these — a job
 * lost to a Redis restart is found here within the hour.
 */

/** `split_part(url, '/', 4)` — the base64 image segment, the stable cover identity. */
const imageSegment = (column: unknown) => sql`split_part(${column}, '/', 4)`;

type DueOptions = {
  detectorVersion: number;
  model: string;
  /** With the classifier off, "no embedding" must not make everything due. */
  nsfwEnabled: boolean;
};

/**
 * An entry the scan owes a look: never scanned, scanned by an older
 * detector, wearing a different cover *image* than the one that was hashed
 * (by id, so the two derivative forms of one picture compare equal), or —
 * with the classifier available — fetched but never embedded, or embedded
 * by a different encoder. Missing entries are excluded; their covers 404.
 */
function scanDue(opts: DueOptions) {
  return and(
    isNull(itchJamEntries.missingSince),
    or(
      isNull(itchEntryScans.entryId),
      lt(itchEntryScans.detectorVersion, opts.detectorVersion),
      sql`${imageSegment(itchEntryScans.coverUrl)} IS DISTINCT FROM ${imageSegment(itchJamEntries.gameCoverUrl)}`,
      opts.nsfwEnabled
        ? and(
            eq(itchEntryScans.coverStatus, "fetched"),
            isNull(itchEntryScans.coverEmbedding),
            // Bounds a cover the classifier cannot read to one fetch a day.
            lt(itchEntryScans.scannedAt, sql`now() - interval '1 day'`),
          )
        : undefined,
      opts.nsfwEnabled
        ? and(
            sql`${itchEntryScans.coverEmbedding} IS NOT NULL`,
            sql`${itchEntryScans.embeddingModel} IS DISTINCT FROM ${opts.model}`,
          )
        : undefined,
    ),
  );
}

/** Jams holding a due entry, newest-jam-first so a running jam's fresh
 * submissions are always enqueued ahead of historical backfill. */
export function dueScanJams(
  opts: DueOptions,
  limit: number,
  exclude: readonly number[] = [],
): Promise<number[]> {
  return db
    .select({ jamId: itchJamEntries.jamId })
    .from(itchJamEntries)
    .innerJoin(itchJams, eq(itchJams.jamId, itchJamEntries.jamId))
    .leftJoin(itchEntryScans, eq(itchEntryScans.entryId, itchJamEntries.entryId))
    .where(
      and(
        scanDue(opts),
        exclude.length > 0 ? notInArray(itchJamEntries.jamId, [...exclude]) : undefined,
      ),
    )
    .groupBy(itchJamEntries.jamId, itchJams.startsAt)
    .orderBy(sql`${itchJams.startsAt} desc nulls last`, asc(itchJamEntries.jamId))
    .limit(limit)
    .then((rows) => rows.map((r) => r.jamId));
}

export type DueEntry = { entryId: number; gameCoverUrl: string | null };

/** One jam's due entries, in the stable order the near matcher relies on. */
export function dueScanEntries(
  jamId: number,
  opts: DueOptions,
  limit: number,
): Promise<DueEntry[]> {
  return db
    .select({ entryId: itchJamEntries.entryId, gameCoverUrl: itchJamEntries.gameCoverUrl })
    .from(itchJamEntries)
    .leftJoin(itchEntryScans, eq(itchEntryScans.entryId, itchJamEntries.entryId))
    .where(and(eq(itchJamEntries.jamId, jamId), scanDue(opts)))
    .orderBy(asc(itchJamEntries.entryId))
    .limit(limit);
}

/**
 * Cover-drift revisits (plan 24 phase 4): current-version scans in jams
 * that ended inside the revisit window, least recently visited first.
 * `scanned_at` is "last visited" — a revisit that changes nothing touches it.
 */
export function dueRevisitEntries(detectorVersion: number, limit: number): Promise<DueEntry[]> {
  if (limit <= 0) return Promise.resolve([]);
  return db
    .select({ entryId: itchJamEntries.entryId, gameCoverUrl: itchJamEntries.gameCoverUrl })
    .from(itchJamEntries)
    .innerJoin(itchJams, eq(itchJams.jamId, itchJamEntries.jamId))
    .innerJoin(itchEntryScans, eq(itchEntryScans.entryId, itchJamEntries.entryId))
    .where(
      and(
        isNull(itchJamEntries.missingSince),
        gt(itchJams.endsAt, sql`now() - make_interval(days => ${config.SCAN_REVISIT_DAYS})`),
        eq(itchEntryScans.detectorVersion, detectorVersion),
        lt(
          itchEntryScans.scannedAt,
          sql`now() - make_interval(days => ${config.SCAN_REVISIT_INTERVAL_DAYS})`,
        ),
      ),
    )
    .orderBy(asc(itchEntryScans.scannedAt))
    .limit(limit);
}

export type DueBanner = { jamId: number; bannerUrl: string | null };

/** Jams whose banner is due, mirroring entry dueness (plan 24 phase 3). */
export function dueBannerJams(opts: DueOptions, limit: number): Promise<DueBanner[]> {
  if (limit <= 0) return Promise.resolve([]);
  return db
    .select({ jamId: itchJams.jamId, bannerUrl: itchJams.bannerUrl })
    .from(itchJams)
    .leftJoin(itchJamScans, eq(itchJamScans.jamId, itchJams.jamId))
    .where(
      and(
        isNull(itchJams.missingSince),
        sql`${itchJams.bannerUrl} IS NOT NULL`,
        or(
          isNull(itchJamScans.jamId),
          lt(itchJamScans.detectorVersion, opts.detectorVersion),
          sql`${imageSegment(itchJamScans.bannerUrl)} IS DISTINCT FROM ${imageSegment(itchJams.bannerUrl)}`,
          opts.nsfwEnabled
            ? and(
                eq(itchJamScans.bannerStatus, "fetched"),
                isNull(itchJamScans.bannerEmbedding),
                lt(itchJamScans.scannedAt, sql`now() - interval '1 day'`),
              )
            : undefined,
          opts.nsfwEnabled
            ? and(
                sql`${itchJamScans.bannerEmbedding} IS NOT NULL`,
                sql`${itchJamScans.embeddingModel} IS DISTINCT FROM ${opts.model}`,
              )
            : undefined,
        ),
      ),
    )
    .orderBy(sql`${itchJams.startsAt} desc nulls last`)
    .limit(limit);
}

/**
 * Uploads awaiting a scan: freshly minted rows, and any live row behind the
 * detector (a version bump, or a staff rescan that zeroed it). Purged rows
 * have no object to read; quarantined ones wait for a human.
 */
export function dueUploads(detectorVersion: number, limit: number): Promise<string[]> {
  if (limit <= 0) return Promise.resolve([]);
  return db
    .select({ objectKey: imageScans.objectKey })
    .from(imageScans)
    .where(
      and(
        inArray(imageScans.status, ["pending", "scanned", "cleared"]),
        lt(imageScans.detectorVersion, detectorVersion),
      ),
    )
    .orderBy(desc(imageScans.createdAt))
    .limit(limit)
    .then((rows) => rows.map((r) => r.objectKey));
}
