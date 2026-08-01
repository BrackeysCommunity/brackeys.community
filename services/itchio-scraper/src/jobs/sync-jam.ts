import { and, eq, isNull, ne, notInArray, sql } from "drizzle-orm";

import { itchJamEntries, itchJamEntryResults, itchJams } from "../../../../src/db/schema.ts";
import { config } from "../config.ts";
import { db } from "../db/client.ts";
import { fetchJamEntries, type ItchEntry } from "../scrape/entries.ts";
import { scrapeJamPage, type ScrapedJam } from "../scrape/jam-page.ts";
import { scrapeRatePage } from "../scrape/rate-page.ts";

function excluded(column: string) {
  return sql.raw(`excluded."${column}"`);
}

export async function upsertJam(jam: ScrapedJam) {
  const now = new Date();
  // Hosts can delete a jam and recreate it under the same URL, which moves the
  // slug to a new jam_id (seen with days-of-horror-4/5). The displaced row is
  // unreachable via this slug, so drop it before upserting; if the old jam
  // still exists under a new slug, discovery re-inserts it fresh.
  const displaced = await db
    .delete(itchJams)
    .where(and(eq(itchJams.slug, jam.slug), ne(itchJams.jamId, jam.jamId)))
    .returning({ jamId: itchJams.jamId });
  if (displaced.length > 0) {
    console.warn(
      `[sync-jam] slug ${jam.slug} moved to jam_id=${jam.jamId}; dropped stale jam_id=${displaced[0]?.jamId}`,
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
        scrapedAt: now,
        updatedAt: now,
      },
    });
}

export async function upsertEntries(jamId: number, entries: ItchEntry[]) {
  if (entries.length === 0) return;
  const now = new Date();
  // Batch to keep Postgres parameter count comfortable (~20 cols * 500 rows).
  const batchSize = 500;
  for (let i = 0; i < entries.length; i += batchSize) {
    const batch = entries.slice(i, i + batchSize);
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
          scrapedAt: now,
          updatedAt: now,
        },
      });
  }
}

async function syncEntryResults(
  jam: ScrapedJam,
): Promise<{ attempted: number; succeeded: number }> {
  if (config.SCRAPE_ENTRY_RESULTS === "never") {
    return { attempted: 0, succeeded: 0 };
  }
  if (config.SCRAPE_ENTRY_RESULTS === "after-voting" && jam.status !== "over") {
    return { attempted: 0, succeeded: 0 };
  }

  // Entries with zero ratings can't rank — itch renders no results table for
  // them, so fetching their rate page is a guaranteed no-op. Mark them fetched
  // up front so they leave the pending pool (and the resync bucket) for good.
  await db
    .update(itchJamEntries)
    .set({ resultsFetchedAt: new Date() })
    .where(
      and(
        eq(itchJamEntries.jamId, jam.jamId),
        isNull(itchJamEntries.resultsFetchedAt),
        eq(itchJamEntries.ratingCount, 0),
      ),
    );

  const pending = await db
    .select({
      entryId: itchJamEntries.entryId,
      gameId: itchJamEntries.gameId,
    })
    .from(itchJamEntries)
    .where(and(eq(itchJamEntries.jamId, jam.jamId), isNull(itchJamEntries.resultsFetchedAt)));

  let succeeded = 0;
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
        if (err instanceof Error && err.message.includes("failed with status 404")) {
          // The submission vanished between the entries fetch and now (game
          // deleted/hidden or pulled from the jam). Mark it fetched so it
          // stops churning; the next sync's reconciliation drops the row.
          await db
            .update(itchJamEntries)
            .set({ resultsFetchedAt: new Date() })
            .where(eq(itchJamEntries.entryId, item.entryId));
          console.warn(`[sync-jam] rate page gone for entry ${item.entryId}; marked fetched`);
          succeeded += 1;
        } else {
          console.error(`[sync-jam] failed to scrape rate page for entry ${item.entryId}`, err);
        }
      }
      if (config.ENTRY_RESULTS_DELAY_MS > 0) {
        await new Promise((r) => setTimeout(r, config.ENTRY_RESULTS_DELAY_MS));
      }
    }
  }

  await Promise.all(Array.from({ length: config.ENTRY_RESULTS_CONCURRENCY }, () => worker()));

  return { attempted: pending.length, succeeded };
}

/**
 * A persisted jam whose page now 404s was deleted on itch. Keep rows that
 * already carry ranked results (historical data we can never refetch) but
 * stop them from resyncing; drop everything else so it can't fail every run.
 */
async function handleDeletedJam(slug: string) {
  const [jam] = await db
    .select({ jamId: itchJams.jamId })
    .from(itchJams)
    .where(eq(itchJams.slug, slug));
  if (!jam) return;

  const [ranked] = await db
    .select({ one: sql<number>`1` })
    .from(itchJamEntryResults)
    .innerJoin(itchJamEntries, eq(itchJamEntries.entryId, itchJamEntryResults.entryId))
    .where(eq(itchJamEntries.jamId, jam.jamId))
    .limit(1);

  if (ranked) {
    await db.transaction(async (tx) => {
      await tx.update(itchJams).set({ status: "over" }).where(eq(itchJams.jamId, jam.jamId));
      await tx
        .update(itchJamEntries)
        .set({ resultsFetchedAt: new Date() })
        .where(and(eq(itchJamEntries.jamId, jam.jamId), isNull(itchJamEntries.resultsFetchedAt)));
    });
    console.warn(`[sync-jam] jam ${slug} deleted on itch; kept ranked history, marked terminal`);
  } else {
    await db.delete(itchJams).where(eq(itchJams.jamId, jam.jamId));
    console.warn(`[sync-jam] jam ${slug} deleted on itch; dropped row`);
  }
}

export async function syncJam(slug: string) {
  const started = Date.now();
  console.log(`[sync-jam] start slug=${slug}`);

  let jam: ScrapedJam;
  try {
    jam = await scrapeJamPage(slug);
  } catch (err) {
    if (err instanceof Error && err.message.includes("failed with status 404")) {
      await handleDeletedJam(slug);
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
    // jam. Their rate pages 404 forever, so drop them (cascades results).
    // Deliberately skipped for an empty list: a transiently empty response
    // must never wipe a jam's entries wholesale.
    let removed = 0;
    if (entries.length > 0) {
      removed = (
        await db
          .delete(itchJamEntries)
          .where(
            and(
              eq(itchJamEntries.jamId, jam.jamId),
              notInArray(
                itchJamEntries.entryId,
                entries.map((e) => e.entryId),
              ),
            ),
          )
          .returning({ entryId: itchJamEntries.entryId })
      ).length;
    }
    console.log(
      `[sync-jam] upserted ${entries.length} entries for ${jam.slug}${
        removed > 0 ? `, removed ${removed} no longer listed` : ""
      }`,
    );
  }

  const results = await syncEntryResults(jam);
  if (results.attempted > 0) {
    console.log(
      `[sync-jam] results scraped ${results.succeeded}/${results.attempted} for ${jam.slug}`,
    );
  }

  const elapsed = Math.round((Date.now() - started) / 1000);
  console.log(`[sync-jam] done slug=${slug} in ${elapsed}s`);
}
