import { and, eq, isNull, sql } from "drizzle-orm";
import type { Browser } from "puppeteer-core";
import { config } from "../config.ts";
import { db } from "../db/client.ts";
import {
  itchJamEntries,
  itchJamEntryResults,
  itchJams,
} from "../../../../src/db/schema.ts";
import { fetchJamEntries, type ItchEntry } from "../scrape/entries.ts";
import { scrapeJamPage, type ScrapedJam } from "../scrape/jam-page.ts";
import { scrapeRatePage } from "../scrape/rate-page.ts";

function excluded(column: string) {
  return sql.raw(`excluded."${column}"`);
}

async function upsertJam(jam: ScrapedJam) {
  const now = new Date();
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
        entriesCount: excluded("entries_count"),
        ratingsCount: excluded("ratings_count"),
        contentHtml: excluded("content_html"),
        scrapedAt: now,
        updatedAt: now,
      },
    });
}

async function upsertEntries(jamId: number, entries: ItchEntry[]) {
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
  browser: Browser,
  jam: ScrapedJam,
): Promise<{ attempted: number; succeeded: number }> {
  if (config.SCRAPE_ENTRY_RESULTS === "never") {
    return { attempted: 0, succeeded: 0 };
  }
  if (
    config.SCRAPE_ENTRY_RESULTS === "after-voting" &&
    jam.status !== "over"
  ) {
    return { attempted: 0, succeeded: 0 };
  }

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
      ),
    );

  let succeeded = 0;
  const queue = [...pending];

  async function worker() {
    for (;;) {
      const item = queue.shift();
      if (!item) return;
      try {
        const page = await scrapeRatePage(browser, jam.slug, item.gameId);
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
        console.error(
          `[sync-jam] failed to scrape rate page for entry ${item.entryId}`,
          err,
        );
      }
      if (config.ENTRY_RESULTS_DELAY_MS > 0) {
        await new Promise((r) => setTimeout(r, config.ENTRY_RESULTS_DELAY_MS));
      }
    }
  }

  await Promise.all(
    Array.from({ length: config.ENTRY_RESULTS_CONCURRENCY }, () => worker()),
  );

  return { attempted: pending.length, succeeded };
}

export async function syncJam(browser: Browser, slug: string) {
  const started = Date.now();
  console.log(`[sync-jam] start slug=${slug}`);

  const jam = await scrapeJamPage(browser, slug);
  await upsertJam(jam);
  console.log(
    `[sync-jam] jam=${jam.slug} id=${jam.jamId} status=${jam.status} entries=${jam.entriesCount}`,
  );

  const entries = await fetchJamEntries(jam.jamId);
  await upsertEntries(jam.jamId, entries);
  console.log(`[sync-jam] upserted ${entries.length} entries for ${jam.slug}`);

  const results = await syncEntryResults(browser, jam);
  if (results.attempted > 0) {
    console.log(
      `[sync-jam] results scraped ${results.succeeded}/${results.attempted} for ${jam.slug}`,
    );
  }

  const elapsed = Math.round((Date.now() - started) / 1000);
  console.log(`[sync-jam] done slug=${slug} in ${elapsed}s`);
}
