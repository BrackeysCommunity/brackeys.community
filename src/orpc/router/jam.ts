import { os } from "@orpc/server";
import { and, asc, count, desc, eq, gt, ilike, inArray, isNull, lte, or, sql } from "drizzle-orm";
import * as z from "zod";

import { db } from "@/db";
import { itchJamEntries, itchJamEntryResults, itchJams } from "@/db/schema";

/** A single itch.io jam submission, as returned by the jam entries feed. */
export type JamEntry = {
  created_at: string;
  rating_count: number;
  url: string;
  game: {
    cover_color?: string;
    platforms: string[];
    short_text?: string | null;
    cover: string;
    url: string;
    user: {
      url: string;
      name: string;
      id: number;
    };
    title: string;
    id: number;
  };
  coolness: number;
  id: number;
};

// Feb 22, 2026 at 5:00 AM CST = 11:00 AM UTC
const JAM_DEADLINE = new Date("2026-02-22T11:00:00Z");

export const getJamData = os.input(z.object({})).handler(async () => {
  const [htmlRes, entriesRes] = await Promise.all([
    fetch("https://itch.io/jam/brackeys-15/feed", {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    }),
    fetch("https://itch.io/jam/402922/entries.json", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    }),
  ]);

  const isDeadlinePassed = Date.now() >= JAM_DEADLINE.getTime();
  let joinedCount = "0";
  let submissionCount = "0";
  let ratingCount = "0";

  if (htmlRes.ok) {
    const html = await htmlRes.text();
    const statMatches = [...html.matchAll(/class="stat_value"[^>]*>([^<]+)</g)];
    if (isDeadlinePassed) {
      // After the jam ends itch swaps the stats: [0] = entries, [1] = ratings
      submissionCount = statMatches[0]?.[1]?.trim() ?? "0";
      ratingCount = statMatches[1]?.[1]?.trim() ?? "0";
    } else {
      joinedCount = statMatches[0]?.[1]?.trim() ?? "0";
      submissionCount = statMatches[1]?.[1]?.trim() ?? "0";
    }
  }

  let submissions: JamEntry[] = [];

  if (entriesRes.ok) {
    const raw = (await entriesRes.json()) as unknown;
    const arr: unknown[] = Array.isArray(raw)
      ? raw
      : Array.isArray((raw as Record<string, unknown>)?.jam_games)
        ? ((raw as Record<string, unknown>).jam_games as unknown[])
        : [];

    submissions = arr
      .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
      .map((item) => {
        const game = (item.game ?? {}) as Record<string, unknown>;
        const user = (game.user ?? {}) as Record<string, unknown>;
        const str = (v: unknown): string =>
          typeof v === "string" ? v : typeof v === "number" ? String(v) : "";

        return {
          id: Number(item.id ?? 0),
          created_at: str(item.created_at),
          rating_count: Number(item.rating_count ?? 0),
          url: str(item.url),
          coolness: Number(item.coolness ?? 0),
          game: {
            id: Number(game.id ?? 0),
            title: str(game.title),
            url: str(game.url),
            cover: str(game.cover),
            cover_color: game.cover_color != null ? str(game.cover_color) : undefined,
            short_text: game.short_text != null ? str(game.short_text) : null,
            platforms: Array.isArray(game.platforms)
              ? (game.platforms as unknown[]).map((p) => str(p))
              : [],
            user: {
              id: Number(user.id ?? 0),
              name: str(user.name),
              url: str(user.url),
            },
          },
        } satisfies JamEntry;
      });
  }

  return { joinedCount, submissionCount, ratingCount, submissions };
});

/** How far back the "calendar" filter keeps archived jams. */
const CALENDAR_ARCHIVE_MONTHS = 12;

/**
 * Latest calendar event a jam will ever produce. '-infinity' keeps
 * GREATEST null-safe without discarding rows that have partial dates —
 * a jam with no dates at all sorts before everything (and lands in the
 * archive, never on the board).
 */
const lastEventAt = sql`GREATEST(
  COALESCE(${itchJams.startsAt}, '-infinity'::timestamptz),
  COALESCE(${itchJams.endsAt}, '-infinity'::timestamptz),
  COALESCE(${itchJams.votingEndsAt}, '-infinity'::timestamptz)
)`;

/**
 * Filtering uses date comparisons rather than the `status` column because the
 * scraper's status snapshot lags reality (and itch's own status field is
 * occasionally stale).
 */
export const listJams = os
  .input(
    z.object({
      filter: z.enum(["live", "upcoming", "active", "board", "calendar", "all"]).default("active"),
      sortBy: z.enum(["soonest", "popularity"]).default("soonest"),
      limit: z.number().min(1).max(5000).default(20),
    }),
  )
  .handler(async ({ input }) => {
    const now = new Date();

    const isLive = and(
      lte(itchJams.startsAt, now),
      or(gt(itchJams.endsAt, now), isNull(itchJams.endsAt)),
    );
    const isUpcoming = gt(itchJams.startsAt, now);

    // Jams stamped missing_since 404 on itch (deleted, or awaiting manual
    // verification) — never surface them in listings.
    const notMissing = isNull(itchJams.missingSince);

    // Any event still in the future — live, upcoming, or in its voting
    // window. This is the discovery board's working set (~500 rows), a
    // fraction of the calendar window's.
    const isOnBoard = sql`${lastEventAt} >= ${now}`;

    // Everything still active (any event in the future) plus a trailing
    // archive window — keeps the calendar payload bounded no matter how
    // large the scraped table grows.
    const archiveCutoff = new Date(now);
    archiveCutoff.setUTCMonth(archiveCutoff.getUTCMonth() - CALENDAR_ARCHIVE_MONTHS);
    const isOnCalendar = sql`${lastEventAt} >= ${archiveCutoff}`;

    const where = (() => {
      switch (input.filter) {
        case "live":
          return and(notMissing, isLive);
        case "upcoming":
          return and(notMissing, isUpcoming);
        case "active":
          return and(notMissing, or(isLive, isUpcoming));
        case "board":
          return and(notMissing, isOnBoard);
        case "calendar":
          return and(notMissing, isOnCalendar);
        case "all":
          return notMissing;
      }
    })();

    // For "soonest" we sort by upcoming-first (asc startsAt) which naturally
    // surfaces live jams (already started) ahead of true upcoming. For
    // "popularity" we order by joinedCount desc (most-joined first), with
    // entriesCount as a tiebreaker for jams that haven't been scraped for
    // joined-count yet. "calendar" ignores sortBy: the client re-sorts by
    // event date, so we return newest-last-event first — if the set ever
    // outgrows the limit, truncation drops the oldest archive instead of
    // upcoming jams.
    const orderBy =
      input.filter === "calendar"
        ? [desc(lastEventAt), asc(itchJams.startsAt)]
        : input.filter === "board"
          ? // Board shelves re-rank client-side; joined-first keeps the
            // payload's head useful if the limit ever truncates.
            [desc(sql`COALESCE(${itchJams.joinedCount}, 0)`), asc(itchJams.startsAt)]
          : input.sortBy === "popularity"
            ? [
                desc(sql`COALESCE(${itchJams.joinedCount}, 0)`),
                desc(sql`COALESCE(${itchJams.entriesCount}, 0)`),
                asc(itchJams.endsAt),
              ]
            : [asc(itchJams.startsAt), desc(itchJams.scrapedAt)];

    const jams = await db
      .select()
      .from(itchJams)
      .where(where)
      .orderBy(...orderBy)
      .limit(input.limit);

    // The jams page's hero advertises how many jams we track overall,
    // which the windowed payload no longer reveals — count it separately.
    let trackedTotal: number | undefined;
    if (input.filter === "calendar" || input.filter === "board") {
      const [row] = await db.select({ count: count() }).from(itchJams).where(notMissing);
      trackedTotal = row?.count ?? jams.length;
    }

    return { jams, trackedTotal };
  });

/**
 * Server-paginated archive browser: every jam whose last event is in the
 * past. The archive is ~19k rows and growing, so unlike the board it is
 * never shipped wholesale — the table view pages through it with
 * server-side search and sort. `contentHtml` is included (a page is at
 * most 100 rows) so the detail modal works from archive rows too.
 */
export const archiveJams = os
  .input(
    z.object({
      search: z.string().trim().max(200).default(""),
      sortBy: z.enum(["lastEvent", "entries", "ratings", "duration", "title"]).default("lastEvent"),
      sortDir: z.enum(["asc", "desc"]).default("desc"),
      page: z.number().int().min(0).default(0),
      pageSize: z.number().int().min(1).max(100).default(25),
    }),
  )
  .handler(async ({ input }) => {
    const now = new Date();
    const notMissing = isNull(itchJams.missingSince);
    const isPast = sql`${lastEventAt} < ${now}`;

    // `hosts` is a jsonb array of {name,url}; a text cast keeps host
    // search simple without unnesting. Title/hashtag get plain ILIKE.
    const q = input.search ? `%${input.search}%` : null;
    const matchesSearch = q
      ? or(
          ilike(itchJams.title, q),
          ilike(itchJams.hashtag, q),
          sql`${itchJams.hosts}::text ILIKE ${q}`,
        )
      : undefined;

    const where = and(notMissing, isPast, matchesSearch);

    const sortCol = {
      lastEvent: lastEventAt,
      entries: sql`COALESCE(${itchJams.entriesCount}, 0)`,
      ratings: sql`COALESCE(${itchJams.ratingsCount}, 0)`,
      duration: sql`COALESCE(${itchJams.endsAt} - ${itchJams.startsAt}, INTERVAL '0')`,
      title: sql`LOWER(${itchJams.title})`,
    }[input.sortBy];
    const primary = input.sortDir === "asc" ? asc(sortCol) : desc(sortCol);

    const [jams, [totalRow]] = await Promise.all([
      db
        .select()
        .from(itchJams)
        .where(where)
        // jamId tiebreak keeps pagination stable when the sort key ties
        // (e.g. thousands of jams share entries_count = 1).
        .orderBy(primary, desc(itchJams.jamId))
        .limit(input.pageSize)
        .offset(input.page * input.pageSize),
      db.select({ count: count() }).from(itchJams).where(where),
    ]);

    return { jams, total: totalRow?.count ?? 0 };
  });

/** Ceiling stand-in for "no Overall placement yet" — larger than any real
 * rank, so unranked entries sort behind ranked ones instead of ahead of
 * them (a plain NULL sorts first under Postgres' ASC default). */
const NO_RANK = 2_147_483_647;

/** Jams per request, and entries per jam. Both are display caps: the
 * landing page shows a handful of jams with a scrolling cover strip each,
 * and the partition below is what keeps a 3k-entry jam from shipping 3k
 * rows. */
export const TOP_ENTRIES_MAX_JAMS = 8;
export const TOP_ENTRIES_MAX_LIMIT = 10;

/**
 * The top N entries of each requested jam, in one round trip.
 *
 * Ordering has to straddle two worlds. Once a jam's rate pages have been
 * scraped its entries carry an "Overall" placement, which is the only
 * ranking anyone would recognize; before that (and for every jam whose
 * results were never fetched) the best available signal is participation —
 * ratings received, then itch's own `coolness`. A LEFT JOIN on the Overall
 * criterion with a COALESCE'd sort key covers both in a single pass rather
 * than branching into two queries.
 */
export function topEntriesQuery(jamIds: number[], limit: number) {
  const ranked = db
    .select({
      entryId: itchJamEntries.entryId,
      jamId: itchJamEntries.jamId,
      gameTitle: itchJamEntries.gameTitle,
      gameUrl: itchJamEntries.gameUrl,
      gameCoverUrl: itchJamEntries.gameCoverUrl,
      gameCoverColor: itchJamEntries.gameCoverColor,
      authorName: itchJamEntries.authorName,
      ratingCount: itchJamEntries.ratingCount,
      rank: itchJamEntryResults.rank,
      // entryId breaks the remaining ties so the same jam doesn't shuffle
      // its covers between requests (most rows tie at 0 ratings).
      rowNumber: sql<number>`ROW_NUMBER() OVER (
        PARTITION BY ${itchJamEntries.jamId}
        ORDER BY COALESCE(${itchJamEntryResults.rank}, ${NO_RANK}) ASC,
                 ${itchJamEntries.ratingCount} DESC,
                 ${itchJamEntries.coolness} DESC,
                 ${itchJamEntries.entryId} ASC
      )`.as("row_number"),
    })
    .from(itchJamEntries)
    .leftJoin(
      itchJamEntryResults,
      and(
        eq(itchJamEntryResults.entryId, itchJamEntries.entryId),
        // Criterion casing is scraped verbatim from the rate page.
        sql`lower(${itchJamEntryResults.criterion}) = 'overall'`,
      ),
    )
    // Entries itch no longer lists are kept in the table but never shown,
    // same rule the jam listings apply to `itch.jams`.
    .where(and(inArray(itchJamEntries.jamId, jamIds), isNull(itchJamEntries.missingSince)))
    .as("ranked");

  return db
    .select({
      entryId: ranked.entryId,
      jamId: ranked.jamId,
      gameTitle: ranked.gameTitle,
      gameUrl: ranked.gameUrl,
      gameCoverUrl: ranked.gameCoverUrl,
      gameCoverColor: ranked.gameCoverColor,
      authorName: ranked.authorName,
      ratingCount: ranked.ratingCount,
      rank: ranked.rank,
    })
    .from(ranked)
    .where(lte(ranked.rowNumber, limit))
    .orderBy(asc(ranked.jamId), asc(ranked.rowNumber));
}

export const listTopEntries = os
  .input(
    z.object({
      jamIds: z.array(z.number().int()).max(TOP_ENTRIES_MAX_JAMS),
      limit: z.number().int().min(1).max(TOP_ENTRIES_MAX_LIMIT).default(4),
    }),
  )
  .handler(async ({ input }) => {
    // Duplicates would only widen the IN list; the empty case would build a
    // `jam_id IN ()` no-op, so short-circuit it.
    const jamIds = [...new Set(input.jamIds)];
    if (jamIds.length === 0) return { entries: [] };

    const entries = await topEntriesQuery(jamIds, input.limit);
    return { entries };
  });
