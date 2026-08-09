import { and, asc, eq, exists, gt, isNull, lte, ne, or, sql } from "drizzle-orm";

import { type ItchJamStatus, itchJamEntries, itchJams } from "../../../../src/db/schema.ts";
import { config } from "../config.ts";
import { db } from "../db/client.ts";

/**
 * The slug sets each cron tier works, in one place so the tiers can't drift
 * apart. Splitting the old single tick into live / discovery / results made
 * these predicates the seam between three services — a jam that falls out of
 * every set stops being scraped at all, so they're written to be exhaustive
 * and are tested as such.
 */

/** A jam marked missing stays in scope only while inside the retry window. */
export function withinMissingWindow() {
  return or(
    isNull(itchJams.missingSince),
    gt(itchJams.missingSince, sql`now() - make_interval(days => ${config.MISSING_RETRY_DAYS})`),
  );
}

/** At least one entry still needs its rankings (missing entries don't count — they 404). */
export function hasPendingResults() {
  return exists(
    db
      .select({ one: sql<number>`1` })
      .from(itchJamEntries)
      .where(
        and(
          eq(itchJamEntries.jamId, itchJams.jamId),
          isNull(itchJamEntries.resultsFetchedAt),
          isNull(itchJamEntries.missingSince),
        ),
      ),
  );
}

/**
 * Jams whose start has passed and that haven't reached `over` — the ones
 * taking submissions or in voting. This is the live tier's whole workload.
 *
 * Keyed on `starts_at`, not on `status`, and that is load-bearing in two
 * directions. A jam whose stored status lags reality (a sync interrupted
 * mid-run, a phase class itch renames) is still selected here and gets
 * corrected by the re-scrape — which is what `resync-stale` had to exist to do
 * when the nightly tick keyed off status alone. And a jam whose deadline just
 * passed is still selected, so the run that flips it to `over` is the same one
 * that hands it to the results tier.
 *
 * A null `starts_at` counts as started. We can't prove such a jam hasn't
 * begun, and the failure modes are asymmetric: treating a live jam as upcoming
 * loses submissions permanently, while treating an upcoming jam as live costs
 * two requests an hour.
 *
 * Ordered staleest-first, which is what makes a truncated tick self-healing.
 * The live tier stops at its deadline, and itch's rate limiter does cut runs
 * short — a 429 costs a 60s pool-wide cooldown, so a bad tick can reach a
 * fraction of the list. Unordered, the next tick would re-read the same
 * arbitrary prefix and the tail would never be synced at all. Ordering by
 * `scraped_at` sends the jams this tick just synced to the back of the queue,
 * so every open jam is visited before any is visited twice.
 */
export function openJamSlugs(): Promise<string[]> {
  return db
    .select({ slug: itchJams.slug })
    .from(itchJams)
    .where(
      and(
        withinMissingWindow(),
        ne(itchJams.status, "over"),
        or(isNull(itchJams.startsAt), lte(itchJams.startsAt, sql`now()`)),
      ),
    )
    .orderBy(asc(itchJams.scrapedAt))
    .then((rows) => rows.map((r) => r.slug));
}

/**
 * Announced-but-not-started jams, least recently scraped first and capped.
 *
 * These are the complement of `openJamSlugs` within the non-terminal set, and
 * they are the reason discovery refreshes anything at all rather than only
 * finding new slugs: an upcoming jam's dates and description do get edited by
 * its host, and nothing else would pick that up until the jam started.
 *
 * They're cheap but numerous (~200, some starting years out), and none of it
 * is perishable — so instead of refreshing all of them every tick, each tick
 * takes the staleest `limit` and the set round-robins. At the default 50 per
 * 4-hourly tick a 200-jam pool turns over roughly every 17 hours for ~300
 * requests a day, against ~10k to refresh all of them hourly.
 */
export function upcomingJamSlugs(limit: number): Promise<string[]> {
  return db
    .select({ slug: itchJams.slug })
    .from(itchJams)
    .where(
      and(withinMissingWindow(), ne(itchJams.status, "over"), gt(itchJams.startsAt, sql`now()`)),
    )
    .orderBy(asc(itchJams.scrapedAt))
    .limit(limit)
    .then((rows) => rows.map((r) => r.slug));
}

export type PendingJam = {
  jamId: number;
  slug: string;
  status: ItchJamStatus;
  pending: number;
};

/**
 * Finished jams still carrying unfetched rankings, most valuable first — the
 * results tier's set, and the `drain` job's.
 *
 * These cost no metadata requests: `syncEntryResults` reads the bulk
 * `/jam/{slug}/results` listing, and `syncJam` takes the results-only path for
 * terminal jams (see `canSkipMetadataRefresh`).
 *
 * Only `over` jams qualify: a jam still in voting has moving scores and
 * belongs to the live tier. Jams and entries stamped missing are excluded —
 * their pages 404.
 *
 * `newest` puts the rankings users are most likely to look at first;
 * `smallest` takes the jams with the fewest pending entries, clearing the
 * backlog *count* fastest.
 */
export function pendingJams(order: "newest" | "smallest"): Promise<PendingJam[]> {
  const pending = sql<number>`count(*)::int`;
  return (
    db
      .select({
        jamId: itchJams.jamId,
        slug: itchJams.slug,
        status: itchJams.status,
        pending,
      })
      .from(itchJams)
      .innerJoin(itchJamEntries, eq(itchJamEntries.jamId, itchJams.jamId))
      .where(
        and(
          eq(itchJams.status, "over"),
          isNull(itchJams.missingSince),
          isNull(itchJamEntries.resultsFetchedAt),
          isNull(itchJamEntries.missingSince),
        ),
      )
      .groupBy(itchJams.jamId, itchJams.slug, itchJams.status, itchJams.endsAt)
      // `nulls last` matters: Postgres sorts NULLs first on DESC, which would put
      // undated jams ahead of the recent ones this ordering exists to prioritize.
      .orderBy(order === "smallest" ? pending : sql`${itchJams.endsAt} desc nulls last`)
  );
}

/** Every slug we hold, for discovery to diff its listings against. */
export function persistedSlugs(): Promise<Set<string>> {
  return db
    .select({ slug: itchJams.slug })
    .from(itchJams)
    .then((rows) => new Set(rows.map((r) => r.slug)));
}
