import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";

import { itchJamEntries, itchJamEntryResults, itchJams } from "../../../../src/db/schema.ts";
import { config } from "../config.ts";
import { db } from "../db/client.ts";
import { describeError, isNotFound } from "../http.ts";
import { fetchJamEntries, type ItchEntry } from "../scrape/entries.ts";
import { scrapeJamPage, type ScrapedJam } from "../scrape/jam-page.ts";
import { scrapeRatePage } from "../scrape/rate-page.ts";
import { type ScrapedGameResults, scrapeJamResults } from "../scrape/results-page.ts";
import { chunk } from "../util.ts";

function excluded(column: string) {
  return sql.raw(`excluded."${column}"`);
}

/** Builds the parking slug a displaced jam row is renamed to (see upsertJam). */
export function displacedSlug(slug: string, jamId: number): string {
  return `${slug}--displaced-${jamId}`;
}

export async function upsertJam(jam: ScrapedJam) {
  const now = new Date();
  // Hosts can delete a jam and recreate it under the same URL, which moves the
  // slug to a new jam_id (seen with days-of-horror-4/5). The displaced row
  // would collide with the unique slug constraint, so park it under a
  // recognizable synthetic slug instead of deleting it. If the old jam still
  // exists under a new slug, discovery re-syncs it by jam_id and restores the
  // real slug; if it's truly gone, syncing the parking slug 404s and the
  // missing-jam machinery takes over.
  const [stale] = await db
    .select({ jamId: itchJams.jamId })
    .from(itchJams)
    .where(and(eq(itchJams.slug, jam.slug), ne(itchJams.jamId, jam.jamId)));
  if (stale) {
    const parkedSlug = displacedSlug(jam.slug, stale.jamId);
    await db
      .update(itchJams)
      .set({ slug: parkedSlug, updatedAt: now })
      .where(eq(itchJams.jamId, stale.jamId));
    console.warn(
      `[sync-jam] slug ${jam.slug} moved to jam_id=${jam.jamId}; parked stale jam_id=${stale.jamId} under ${parkedSlug}`,
    );
  }
  await db
    .insert(itchJams)
    .values({
      jamId: jam.jamId,
      slug: jam.slug,
      title: jam.title,
      bannerUrl: jam.bannerUrl,
      hashtag: jam.hashtag,
      hosts: jam.hosts,
      status: jam.status,
      startsAt: jam.startsAt,
      endsAt: jam.endsAt,
      votingEndsAt: jam.votingEndsAt,
      joinedCount: jam.joinedCount,
      entriesCount: jam.entriesCount,
      ratingsCount: jam.ratingsCount,
      contentHtml: jam.contentHtml,
      themeColor: jam.themeColor,
      scrapedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: itchJams.jamId,
      set: {
        slug: excluded("slug"),
        title: excluded("title"),
        bannerUrl: excluded("banner_url"),
        hashtag: excluded("hashtag"),
        hosts: excluded("hosts"),
        status: excluded("status"),
        startsAt: excluded("starts_at"),
        endsAt: excluded("ends_at"),
        votingEndsAt: excluded("voting_ends_at"),
        joinedCount: excluded("joined_count"),
        entriesCount: excluded("entries_count"),
        ratingsCount: excluded("ratings_count"),
        contentHtml: excluded("content_html"),
        themeColor: excluded("theme_color"),
        // A successful scrape proves the jam exists again.
        missingSince: null,
        scrapedAt: now,
        updatedAt: now,
      },
    });
}

export async function upsertEntries(jamId: number, entries: ItchEntry[]) {
  if (entries.length === 0) return;
  const now = new Date();
  // Batch to keep Postgres parameter count comfortable (~20 cols * 500 rows).
  for (const batch of chunk(entries, 500)) {
    await db
      .insert(itchJamEntries)
      .values(
        batch.map((e) => ({
          entryId: e.entryId,
          jamId,
          gameId: e.gameId,
          rateUrl: e.rateUrl,
          ratingCount: e.ratingCount,
          coolness: e.coolness,
          submittedAt: e.submittedAt,
          gameTitle: e.gameTitle,
          gameShortText: e.gameShortText,
          gameUrl: e.gameUrl,
          gameCoverUrl: e.gameCoverUrl,
          gameCoverColor: e.gameCoverColor,
          gamePlatforms: e.gamePlatforms,
          authorId: e.authorId,
          authorName: e.authorName,
          authorUrl: e.authorUrl,
          contributors: e.contributors,
          scrapedAt: now,
          updatedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: itchJamEntries.entryId,
        set: {
          ratingCount: excluded("rating_count"),
          coolness: excluded("coolness"),
          gameTitle: excluded("game_title"),
          gameShortText: excluded("game_short_text"),
          gameUrl: excluded("game_url"),
          gameCoverUrl: excluded("game_cover_url"),
          gameCoverColor: excluded("game_cover_color"),
          gamePlatforms: excluded("game_platforms"),
          authorId: excluded("author_id"),
          authorName: excluded("author_name"),
          authorUrl: excluded("author_url"),
          contributors: excluded("contributors"),
          // Being listed in entries.json again resurrects a missing entry.
          missingSince: null,
          scrapedAt: now,
          updatedAt: now,
        },
      });
  }
}

/**
 * Entries with zero ratings can't rank — itch renders no results table for
 * them, so fetching their rate page is a guaranteed no-op. Mark them fetched
 * up front so they leave the pending pool (and the resync bucket) for good.
 * Shared by the nightly sync and the historical backfill.
 */
export async function markUnratableEntriesFetched(jamId: number) {
  await db
    .update(itchJamEntries)
    .set({ resultsFetchedAt: new Date() })
    .where(
      and(
        eq(itchJamEntries.jamId, jamId),
        isNull(itchJamEntries.resultsFetchedAt),
        eq(itchJamEntries.ratingCount, 0),
      ),
    );
}

type PendingEntry = { entryId: number; gameId: number };

type ResultsOutcome = {
  attempted: number;
  succeeded: number;
  gone: number;
  ranked: number;
  source: "results-page" | "rate-pages" | "none";
};

/**
 * Writes rankings for a batch of entries resolved from the bulk results
 * listing. Entries absent from `byGameId` didn't rank (too few ratings) — they
 * are marked fetched with no rows, which is exactly the conclusion the
 * per-entry path reaches after spending a request to find an empty table.
 *
 * Chunked so each transaction stays bounded on a 6,000-entry jam; a run killed
 * midway leaves the processed chunks done and the rest still pending.
 */
async function persistBulkResults(
  pending: PendingEntry[],
  byGameId: Map<number, ScrapedGameResults>,
): Promise<number> {
  let ranked = 0;

  for (const batch of chunk(pending, 500)) {
    const entryIds = batch.map((e) => e.entryId);
    const rows = batch.flatMap((entry) =>
      (byGameId.get(entry.gameId)?.results ?? []).map((r) => ({
        entryId: entry.entryId,
        criterion: r.criterion,
        rank: r.rank,
        score: r.score,
        rawScore: r.rawScore,
      })),
    );

    await db.transaction(async (tx) => {
      await tx.delete(itchJamEntryResults).where(inArray(itchJamEntryResults.entryId, entryIds));
      if (rows.length > 0) {
        await tx.insert(itchJamEntryResults).values(rows);
      }
      await tx
        .update(itchJamEntries)
        .set({ resultsFetchedAt: new Date() })
        .where(inArray(itchJamEntries.entryId, entryIds));
    });

    ranked += batch.filter((e) => (byGameId.get(e.gameId)?.results.length ?? 0) > 0).length;
  }

  return ranked;
}

async function syncEntryResults(jam: ScrapedJam): Promise<ResultsOutcome> {
  const idle: ResultsOutcome = {
    attempted: 0,
    succeeded: 0,
    gone: 0,
    ranked: 0,
    source: "none",
  };
  if (config.SCRAPE_ENTRY_RESULTS === "never") return idle;
  if (config.SCRAPE_ENTRY_RESULTS === "after-voting" && jam.status !== "over") return idle;

  await markUnratableEntriesFetched(jam.jamId);

  // Entries already marked missing are excluded — their rate pages 404. If
  // one reappears in entries.json, the upsert clears missing_since and it
  // rejoins this pool with its results still pending.
  const pending = await db
    .select({
      entryId: itchJamEntries.entryId,
      gameId: itchJamEntries.gameId,
    })
    .from(itchJamEntries)
    .where(
      and(
        eq(itchJamEntries.jamId, jam.jamId),
        isNull(itchJamEntries.resultsFetchedAt),
        isNull(itchJamEntries.missingSince),
      ),
    );
  if (pending.length === 0) return idle;

  // Preferred path: one `/results` fetch covers 20 entries and carries the same
  // criterion table the per-entry rate page does. Across the historical backlog
  // that is the difference between ~250k requests and ~13k. Falls back to the
  // per-entry walk when a jam has no published rankings (404) or the walk
  // fails, since "absent from the map" only means "unranked" for a complete walk.
  try {
    const byGameId = await scrapeJamResults(jam.slug);
    if (byGameId.size > 0) {
      const ranked = await persistBulkResults(pending, byGameId);
      return {
        attempted: pending.length,
        succeeded: pending.length,
        gone: 0,
        ranked,
        source: "results-page",
      };
    }
    console.warn(
      `[sync-jam] ${jam.slug} results page listed no games — falling back to rate pages`,
    );
  } catch (err) {
    if (isNotFound(err)) {
      console.log(`[sync-jam] ${jam.slug} has no results page — using rate pages`);
    } else {
      console.warn(
        `[sync-jam] ${jam.slug} results walk failed (${describeError(err)}) — falling back to rate pages`,
      );
    }
  }

  return await syncEntryResultsPerEntry(jam, pending);
}

/**
 * Original one-request-per-entry drain, kept as the fallback for jams whose
 * host never published a results listing.
 */
async function syncEntryResultsPerEntry(
  jam: ScrapedJam,
  pending: PendingEntry[],
): Promise<ResultsOutcome> {
  let succeeded = 0;
  let gone = 0;
  const queue = [...pending];

  async function worker() {
    for (;;) {
      const item = queue.shift();
      if (!item) return;
      try {
        const page = await scrapeRatePage(jam.slug, item.gameId);
        await db.transaction(async (tx) => {
          if (page.results.length > 0) {
            await tx
              .delete(itchJamEntryResults)
              .where(eq(itchJamEntryResults.entryId, item.entryId));
            await tx.insert(itchJamEntryResults).values(
              page.results.map((r) => ({
                entryId: item.entryId,
                criterion: r.criterion,
                rank: r.rank,
                score: r.score,
                rawScore: r.rawScore,
              })),
            );
          }
          // Mark fetched even when there are no results — submissions with
          // too few ratings don't rank and we shouldn't retry each week.
          await tx
            .update(itchJamEntries)
            .set({ resultsFetchedAt: new Date() })
            .where(eq(itchJamEntries.entryId, item.entryId));
        });
        succeeded += 1;
      } catch (err) {
        if (isNotFound(err)) {
          // The submission vanished between the entries fetch and now (game
          // deleted/hidden or pulled from the jam). Mark it missing so it
          // stops churning; if it's ever listed again the upsert resurrects
          // it with results still pending.
          await db
            .update(itchJamEntries)
            .set({ missingSince: new Date() })
            .where(eq(itchJamEntries.entryId, item.entryId));
          console.warn(`[sync-jam] rate page gone for entry ${item.entryId}; marked missing`);
          gone += 1;
        } else {
          // Log the message only — Bun enumerates a DOMException's 25 static
          // error-code constants when handed the raw object, which buried the
          // real signal under hundreds of lines per failure.
          console.error(
            `[sync-jam] failed to scrape rate page for entry ${item.entryId}: ${describeError(err)}`,
          );
        }
      }
      if (config.ENTRY_RESULTS_DELAY_MS > 0) {
        await new Promise((r) => setTimeout(r, config.ENTRY_RESULTS_DELAY_MS));
      }
    }
  }

  await Promise.all(Array.from({ length: config.ENTRY_RESULTS_CONCURRENCY }, () => worker()));

  return {
    attempted: pending.length,
    succeeded,
    gone,
    ranked: succeeded,
    source: "rate-pages",
  };
}

/**
 * A persisted jam whose page now 404s was deleted on itch — or itch served a
 * spurious 404. Nothing is deleted either way: the row is stamped
 * missing_since and keeps being retried until the stamp is older than
 * MISSING_RETRY_DAYS, at which point it drops out of the resync bucket (see
 * index.ts) and waits for manual verification. A later successful scrape
 * clears the stamp.
 */
async function markJamMissing(slug: string) {
  const stamped = await db
    .update(itchJams)
    .set({ missingSince: new Date() })
    .where(and(eq(itchJams.slug, slug), isNull(itchJams.missingSince)))
    .returning({ jamId: itchJams.jamId });
  if (stamped.length > 0) {
    console.warn(
      `[sync-jam] jam ${slug} 404s — marked missing; retrying for ${config.MISSING_RETRY_DAYS}d before parking for manual review`,
    );
  } else {
    console.warn(`[sync-jam] jam ${slug} still 404s`);
  }
}

export async function syncJam(slug: string) {
  const started = Date.now();
  console.log(`[sync-jam] start slug=${slug}`);

  let jam: ScrapedJam;
  try {
    jam = await scrapeJamPage(slug);
  } catch (err) {
    if (isNotFound(err)) {
      await markJamMissing(slug);
      return;
    }
    throw err;
  }
  await upsertJam(jam);
  console.log(
    `[sync-jam] jam=${jam.slug} id=${jam.jamId} status=${jam.status} entries=${jam.entriesCount}`,
  );

  const entries = await fetchJamEntries(jam.jamId);
  if (entries !== null) {
    await upsertEntries(jam.jamId, entries);
    // entries.json is the authoritative current submission list — entries we
    // hold that itch no longer lists were deleted, hidden, or pulled from the
    // jam. Mark them missing (never delete; re-listing resurrects them).
    // Deliberately skipped for an empty list: a transiently empty response
    // must never mark a jam's entries missing wholesale. The diff is computed
    // here and updated in inArray batches to keep parameter counts bounded,
    // same as the upserts above.
    let marked = 0;
    if (entries.length > 0) {
      const listed = new Set(entries.map((e) => e.entryId));
      const held = await db
        .select({ entryId: itchJamEntries.entryId })
        .from(itchJamEntries)
        .where(and(eq(itchJamEntries.jamId, jam.jamId), isNull(itchJamEntries.missingSince)));
      const unlisted = held.map((r) => r.entryId).filter((id) => !listed.has(id));
      const now = new Date();
      for (const batch of chunk(unlisted, 500)) {
        await db
          .update(itchJamEntries)
          .set({ missingSince: now })
          .where(inArray(itchJamEntries.entryId, batch));
      }
      marked = unlisted.length;
    }
    console.log(
      `[sync-jam] upserted ${entries.length} entries for ${jam.slug}${
        marked > 0 ? `, marked ${marked} missing (no longer listed)` : ""
      }`,
    );
  }

  const results = await syncEntryResults(jam);
  if (results.attempted > 0) {
    console.log(
      `[sync-jam] results ${results.succeeded}/${results.attempted} for ${jam.slug} via ${results.source} (${results.ranked} ranked)${
        results.gone > 0 ? ` (${results.gone} rate pages gone)` : ""
      }`,
    );
  }

  const elapsed = Math.round((Date.now() - started) / 1000);
  console.log(`[sync-jam] done slug=${slug} in ${elapsed}s`);
}
