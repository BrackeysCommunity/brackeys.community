import { ORPCError } from "@orpc/client";
import { os } from "@orpc/server";
import {
  and,
  asc,
  count,
  desc,
  eq,
  getColumns,
  gt,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import * as z from "zod";

import { db } from "@/db";
import {
  collabPosts,
  developerProfiles,
  itchJamEntries,
  itchJamEntryResults,
  itchJams,
  jamWatches,
  linkedAccounts,
  profileProjects,
  profileUrlStubs,
  teamProjects,
  teams,
  type JamWatchIntent,
} from "@/db/schema";
import { EVENTS } from "@/lib/analytics-events";
import { recordModerationAction } from "@/lib/moderation-audit";
import { captureServerEvent } from "@/lib/posthog-server";
import { resolveTeamAvatarUrl } from "@/lib/profile-project-image-storage";
import { likeContains } from "@/lib/sql-like";
import { requireAuth, requireStaff, userIsGuildMember } from "@/orpc/middleware/auth";

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
 * Listing rows leave out `contentHtml` — the full scraped itch page body,
 * which averages ~4 KB per jam and made the calendar's 5k-row payload
 * ~22 MB (83% of it descriptions nothing on the board or calendar ever
 * renders). Detail surfaces fetch it per jam via `getJam`.
 */
const { contentHtml: _contentHtml, ...jamListColumns } = getColumns(itchJams);

/**
 * Filtering uses date comparisons rather than the `status` column because the
 * scraper's status snapshot lags reality (and itch's own status field is
 * occasionally stale).
 */
export const listJams = os
  .route({ method: "GET" })
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
      .select(jamListColumns)
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
 * server-side search and sort. Rows share the listing shape (no
 * `contentHtml`); the detail modal fetches the body via `getJam`.
 */
export const archiveJams = os
  .route({ method: "GET" })
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
    const q = likeContains(input.search);
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
        .select(jamListColumns)
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
 * rows. The jam cap tracks `SHOWCASE_MAX_JAMS` **plus `HERO_SLIDE_MAX`** —
 * the whole landing page is one request, and the hero rotation's jams are
 * the ones the band deliberately leaves out. */
export const RECENT_ENTRIES_MAX_JAMS = 16;
export const RECENT_ENTRIES_MAX_LIMIT = 10;

/**
 * The N most recently submitted entries of each requested jam, in one
 * round trip — the same `submitted_at DESC NULLS LAST` ordering as the
 * detail page's "recent" sort, so the strip reads as a live feed of what
 * people are shipping rather than a leaderboard.
 *
 * The Overall placement is still left-joined: the tiles wear it as a
 * chip when results exist, it just doesn't drive the order.
 */
export function recentEntriesQuery(jamIds: number[], limit: number) {
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
      // A jam in its voting window leads with its most-rated entries (an
      // unrated field ties at 0 and stays newest-first); otherwise newest
      // first, entryId breaking `submitted_at` ties and null timestamps.
      rowNumber: sql<number>`ROW_NUMBER() OVER (
        PARTITION BY ${itchJamEntries.jamId}
        ORDER BY CASE WHEN ${itchJams.endsAt} <= NOW() AND ${itchJams.votingEndsAt} > NOW()
                      THEN ${itchJamEntries.ratingCount} END DESC NULLS LAST,
                 ${itchJamEntries.submittedAt} DESC NULLS LAST,
                 ${itchJamEntries.entryId} DESC
      )`.as("row_number"),
    })
    .from(itchJamEntries)
    .leftJoin(itchJams, eq(itchJams.jamId, itchJamEntries.jamId))
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

export const listRecentEntries = os
  .route({ method: "GET" })
  .input(
    z.object({
      jamIds: z.array(z.number().int()).max(RECENT_ENTRIES_MAX_JAMS),
      limit: z.number().int().min(1).max(RECENT_ENTRIES_MAX_LIMIT).default(4),
    }),
  )
  .handler(async ({ input }) => {
    // Duplicates would only widen the IN list; the empty case would build a
    // `jam_id IN ()` no-op, so short-circuit it.
    const jamIds = [...new Set(input.jamIds)];
    if (jamIds.length === 0) return { entries: [] };

    const entries = await recentEntriesQuery(jamIds, input.limit);
    return { entries };
  });

// ── Jam detail page ─────────────────────────────────────────────────────────

/** `itch.jams.jam_id` is a pg `integer`; a longer digit run in the URL is
 * somebody's slug (or a probe), not an id, and must not reach the query as
 * an out-of-range bind. */
const MAX_INT4 = 2_147_483_647;

function parseJamId(segment: string): number | null {
  if (!/^\d{1,10}$/.test(segment)) return null;
  const parsed = Number(segment);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= MAX_INT4 ? parsed : null;
}

/**
 * One jam by slug or numeric id — the detail route's resolver, mirroring
 * `getTeam`/`getProfile`'s "handle first, id as fallback" contract.
 *
 * Returns the full `itch.jams` row so the page's presentation helpers
 * (`jamPhase`, `lifecyclePoints`, `useJamColor`) work off exactly the same
 * shape the board hands them, plus the two facts the page needs before it
 * can decide what sections to render at all.
 *
 * Jams stamped `missing_since` 404 on itch. They're kept in the table but
 * are never linkable, so the page treats them as absent — same rule the
 * listings apply.
 */
export const getJam = os
  .route({ method: "GET" })
  .input(z.object({ idOrSlug: z.string().trim().min(1).max(300) }))
  .handler(async ({ input }) => {
    const jamId = parseJamId(input.idOrSlug);
    const rows = await db
      .select()
      .from(itchJams)
      .where(
        and(
          isNull(itchJams.missingSince),
          jamId != null
            ? or(eq(itchJams.slug, input.idOrSlug), eq(itchJams.jamId, jamId))
            : eq(itchJams.slug, input.idOrSlug),
        ),
      )
      .limit(2);

    // Slug is unique, so a two-row result can only mean the numeric segment
    // is one jam's id *and* another jam's slug. The slug is the canonical
    // link form, so it wins.
    const jam = rows.find((row) => row.slug === input.idOrSlug) ?? rows[0];
    if (!jam) return null;

    const [[entryRow], [resultRow]] = await Promise.all([
      db
        .select({ count: count() })
        .from(itchJamEntries)
        .where(and(eq(itchJamEntries.jamId, jam.jamId), isNull(itchJamEntries.missingSince))),
      // Presence, not a count: the rate pages are scraped per entry, so a
      // jam either has some placements or none, and `EXISTS` stops at the
      // first row instead of counting entries × criteria.
      db
        .select({ entryId: itchJamEntryResults.entryId })
        .from(itchJamEntryResults)
        .innerJoin(itchJamEntries, eq(itchJamEntries.entryId, itchJamEntryResults.entryId))
        .where(eq(itchJamEntries.jamId, jam.jamId))
        .limit(1),
    ]);

    return {
      jam,
      // How many submissions we actually hold. Distinct from the scraped
      // `entriesCount` stat, which is itch's own number and can be ahead of
      // (or behind) our entry rows — the grid pages through *these*.
      trackedEntries: entryRow?.count ?? 0,
      hasResults: resultRow != null,
    };
  });

/** Covers per page of the entries grid. A 3k-entry jam must never ship
 * wholesale, and 48 fills the widest grid at 6 columns × 8 rows. */
export const JAM_ENTRIES_PAGE_SIZE = 48;

export type JamEntrySort = "rank" | "ratings" | "recent" | "title";

/**
 * One page of a jam's submissions, ranked.
 *
 * The "rank" sort straddles two worlds: once a jam's rate pages have
 * been scraped its entries carry an "Overall" placement, the only ranking
 * anyone would recognize; before that (and for every jam whose results
 * were never fetched) it falls back to participation signal — ratings
 * received, then itch's own `coolness` — so the default sort is
 * meaningful before *and* after results publish.
 * The Overall rank is left-joined either way — the cards show it as a
 * chip regardless of which sort is active.
 */
export const listJamEntries = os
  .route({ method: "GET" })
  .input(
    z.object({
      jamId: z.number().int().min(1).max(MAX_INT4),
      page: z.number().int().min(0).default(0),
      pageSize: z.number().int().min(1).max(96).default(JAM_ENTRIES_PAGE_SIZE),
      sortBy: z.enum(["rank", "ratings", "recent", "title"]).default("rank"),
      search: z.string().trim().max(200).default(""),
    }),
  )
  .handler(async ({ input }) => {
    const q = likeContains(input.search);
    const where = and(
      eq(itchJamEntries.jamId, input.jamId),
      // Entries itch no longer lists stay in the table but are never shown.
      isNull(itchJamEntries.missingSince),
      q ? or(ilike(itchJamEntries.gameTitle, q), ilike(itchJamEntries.authorName, q)) : undefined,
    );

    // entryId breaks the remaining ties in every mode so paging is stable —
    // most rows tie at 0 ratings, and a jam submitted in bulk ties on
    // `submitted_at` too.
    const orderBy = {
      rank: [
        asc(sql`COALESCE(${itchJamEntryResults.rank}, ${NO_RANK})`),
        desc(itchJamEntries.ratingCount),
        desc(itchJamEntries.coolness),
        asc(itchJamEntries.entryId),
      ],
      ratings: [
        desc(itchJamEntries.ratingCount),
        desc(itchJamEntries.coolness),
        asc(itchJamEntries.entryId),
      ],
      recent: [sql`${itchJamEntries.submittedAt} DESC NULLS LAST`, desc(itchJamEntries.entryId)],
      title: [sql`LOWER(${itchJamEntries.gameTitle}) ASC`, asc(itchJamEntries.entryId)],
    }[input.sortBy];

    const [entries, [totalRow]] = await Promise.all([
      db
        .select({
          entryId: itchJamEntries.entryId,
          gameId: itchJamEntries.gameId,
          gameTitle: itchJamEntries.gameTitle,
          gameShortText: itchJamEntries.gameShortText,
          gameUrl: itchJamEntries.gameUrl,
          gameCoverUrl: itchJamEntries.gameCoverUrl,
          gameCoverColor: itchJamEntries.gameCoverColor,
          gamePlatforms: itchJamEntries.gamePlatforms,
          rateUrl: itchJamEntries.rateUrl,
          ratingCount: itchJamEntries.ratingCount,
          coolness: itchJamEntries.coolness,
          submittedAt: itchJamEntries.submittedAt,
          authorId: itchJamEntries.authorId,
          authorName: itchJamEntries.authorName,
          authorUrl: itchJamEntries.authorUrl,
          contributors: itchJamEntries.contributors,
          // Left-joined, so null for every entry until the jam's rate pages
          // are scraped.
          rank: itchJamEntryResults.rank,
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
        .where(where)
        .orderBy(...orderBy)
        .limit(input.pageSize)
        .offset(input.page * input.pageSize),
      db.select({ count: count() }).from(itchJamEntries).where(where),
    ]);

    const membersByEntryId = await matchMembersToEntries(entries);

    return {
      entries: entries.map((entry) => ({
        ...entry,
        // Members of this community who worked on the entry. Usually empty —
        // most of any jam's field are strangers to us.
        members: membersByEntryId.get(entry.entryId) ?? [],
      })),
      total: totalRow?.count ?? 0,
    };
  });

/** A Brackeys member recognized on a scraped entry. */
export interface JamEntryMember {
  profileId: string;
  username: string | null;
  avatarUrl: string | null;
  urlStub: string | null;
}

/**
 * Which of these entries were made by people from here.
 *
 * Two tiers, the same ones `syncItchIoJamParticipations` matches on:
 *
 *  1. A member already has an imported placement for the entry (`source
 *     'itchio-jam'`, `sourceId` = the entry id). This tier also covers
 *     teammates, because the sync creates a placement for a contributor
 *     whose linked itch profile URL appears in `contributors[]`.
 *  2. The entry's `author_id` matches a linked itch account. This catches
 *     members whose participation sync hasn't run yet (a jam scraped after
 *     their last sign-in), which is otherwise the common case for a jam
 *     that just closed.
 *
 * Scoped to the page of entries being returned, so the cost is two `IN`
 * queries against at most ~48 ids rather than anything jam-wide.
 */
async function matchMembersToEntries(
  entries: { entryId: number; authorId: number | null }[],
): Promise<Map<number, JamEntryMember[]>> {
  const byEntryId = new Map<number, JamEntryMember[]>();
  if (entries.length === 0) return byEntryId;

  const entryIds = entries.map((entry) => entry.entryId);
  const authorIds = [
    ...new Set(entries.map((entry) => entry.authorId).filter((id): id is number => id != null)),
  ];

  const [placementRows, accountRows] = await Promise.all([
    db
      .select({
        sourceId: profileProjects.sourceId,
        profileId: developerProfiles.id,
        username: developerProfiles.guildNickname,
        discordUsername: developerProfiles.discordUsername,
        avatarUrl: developerProfiles.avatarUrl,
        urlStub: profileUrlStubs.stub,
      })
      .from(profileProjects)
      .innerJoin(developerProfiles, eq(profileProjects.profileId, developerProfiles.id))
      .leftJoin(profileUrlStubs, eq(profileUrlStubs.profileId, developerProfiles.id))
      .where(
        and(
          eq(profileProjects.source, "itchio-jam"),
          eq(profileProjects.status, "approved"),
          eq(profileProjects.published, true),
          inArray(profileProjects.sourceId, entryIds.map(String)),
        ),
      ),
    authorIds.length > 0
      ? db
          .select({
            providerUserId: linkedAccounts.providerUserId,
            profileId: developerProfiles.id,
            username: developerProfiles.guildNickname,
            discordUsername: developerProfiles.discordUsername,
            avatarUrl: developerProfiles.avatarUrl,
            urlStub: profileUrlStubs.stub,
          })
          .from(linkedAccounts)
          .innerJoin(developerProfiles, eq(linkedAccounts.profileId, developerProfiles.id))
          .leftJoin(profileUrlStubs, eq(profileUrlStubs.profileId, developerProfiles.id))
          .where(
            and(
              eq(linkedAccounts.provider, "itchio"),
              // `provider_user_id` is text; the itch user id it holds is
              // numeric, so compare as strings rather than casting a column
              // that may hold anything.
              inArray(linkedAccounts.providerUserId, authorIds.map(String)),
            ),
          )
      : Promise.resolve([]),
  ]);

  const add = (entryId: number, member: JamEntryMember) => {
    const list = byEntryId.get(entryId) ?? [];
    // The two tiers overlap for the uploader of an already-synced entry.
    if (list.some((existing) => existing.profileId === member.profileId)) return;
    list.push(member);
    byEntryId.set(entryId, list);
  };

  for (const row of placementRows) {
    const entryId = Number(row.sourceId);
    if (!Number.isSafeInteger(entryId)) continue;
    add(entryId, {
      profileId: row.profileId,
      username: row.username ?? row.discordUsername,
      avatarUrl: row.avatarUrl,
      urlStub: row.urlStub,
    });
  }

  const memberByAuthorId = new Map(accountRows.map((row) => [row.providerUserId, row]));
  for (const entry of entries) {
    if (entry.authorId == null) continue;
    const row = memberByAuthorId.get(String(entry.authorId));
    if (!row) continue;
    add(entry.entryId, {
      profileId: row.profileId,
      username: row.username ?? row.discordUsername,
      avatarUrl: row.avatarUrl,
      urlStub: row.urlStub,
    });
  }

  return byEntryId;
}

/** Places shown per criterion on the results board. Three is a podium;
 * the full table lives on itch. */
const RESULTS_TOP_N = 3;

/**
 * Published placements for a jam, grouped by criterion.
 *
 * `entrantCount` is the number of entries that were *ranked* on a
 * criterion, not the jam's entry count — itch ranks only submissions that
 * received enough ratings, so "#12 of 312" has to come from the results
 * table to be true.
 */
export const getJamResults = os
  .route({ method: "GET" })
  .input(
    z.object({
      jamId: z.number().int().min(1).max(MAX_INT4),
      topN: z.number().int().min(1).max(10).default(RESULTS_TOP_N),
    }),
  )
  .handler(async ({ input }) => {
    const [places, counts] = await Promise.all([
      db
        .select({
          criterion: itchJamEntryResults.criterion,
          rank: itchJamEntryResults.rank,
          score: itchJamEntryResults.score,
          entryId: itchJamEntries.entryId,
          gameTitle: itchJamEntries.gameTitle,
          gameUrl: itchJamEntries.gameUrl,
          gameCoverUrl: itchJamEntries.gameCoverUrl,
          gameCoverColor: itchJamEntries.gameCoverColor,
          rateUrl: itchJamEntries.rateUrl,
          authorName: itchJamEntries.authorName,
          authorUrl: itchJamEntries.authorUrl,
        })
        .from(itchJamEntryResults)
        .innerJoin(itchJamEntries, eq(itchJamEntries.entryId, itchJamEntryResults.entryId))
        .where(
          and(
            eq(itchJamEntries.jamId, input.jamId),
            lte(itchJamEntryResults.rank, input.topN),
            isNull(itchJamEntries.missingSince),
          ),
        )
        .orderBy(asc(itchJamEntryResults.criterion), asc(itchJamEntryResults.rank)),
      db
        .select({ criterion: itchJamEntryResults.criterion, count: count() })
        .from(itchJamEntryResults)
        .innerJoin(itchJamEntries, eq(itchJamEntries.entryId, itchJamEntryResults.entryId))
        .where(eq(itchJamEntries.jamId, input.jamId))
        .groupBy(itchJamEntryResults.criterion),
    ]);

    const entrantByCriterion = new Map(counts.map((row) => [row.criterion, row.count]));
    const grouped = new Map<
      string,
      { criterion: string; entrantCount: number; places: typeof places }
    >();
    for (const place of places) {
      let bucket = grouped.get(place.criterion);
      if (!bucket) {
        bucket = {
          criterion: place.criterion,
          entrantCount: entrantByCriterion.get(place.criterion) ?? 0,
          places: [],
        };
        grouped.set(place.criterion, bucket);
      }
      bucket.places.push(place);
    }

    // Overall is the placement anyone would recognize, so it leads; the
    // host-defined order of the rest isn't scraped, so alphabetical is the
    // only stable choice.
    const criteria = [...grouped.values()].sort((a, b) => {
      const aOverall = a.criterion.toLowerCase() === "overall";
      const bOverall = b.criterion.toLowerCase() === "overall";
      if (aOverall !== bOverall) return aOverall ? -1 : 1;
      return a.criterion.localeCompare(b.criterion);
    });

    return { criteria };
  });

// ── Jam detail page: the community shelf ────────────────────────────────────

/** Shelf caps. A jam the whole server entered is a good problem, but the
 * shelf is a glance, not a directory — it links out to the surfaces that
 * are. */
const COMMUNITY_MEMBERS_MAX = 24;
const COMMUNITY_TEAMS_MAX = 12;

/**
 * Who from *here* took part in this jam.
 *
 * This is the join the research doc calls the thing itch can't copy:
 * `profile_projects.jam_id` and `team_projects.jam_id` have carried it
 * since the jam sync landed and nothing jam-side ever rendered it. Past
 * participation (shipped entries) and future participation (teams
 * recruiting) both belong on the same shelf — otherwise an upcoming jam's
 * community section is permanently empty.
 */
export const getJamCommunity = os
  .route({ method: "GET" })
  .input(z.object({ jamId: z.number().int().min(1).max(MAX_INT4) }))
  .handler(async ({ input }) => {
    const [memberRows, teamRows, [postRow], declared] = await Promise.all([
      db
        .select({
          placementId: profileProjects.id,
          profileId: developerProfiles.id,
          username: developerProfiles.guildNickname,
          discordUsername: developerProfiles.discordUsername,
          avatarUrl: developerProfiles.avatarUrl,
          urlStub: profileUrlStubs.stub,
          entryTitle: profileProjects.submissionTitle,
          fallbackTitle: profileProjects.title,
          submissionUrl: profileProjects.submissionUrl,
          gameUrl: profileProjects.url,
          source: profileProjects.source,
          sourceId: profileProjects.sourceId,
          result: profileProjects.result,
        })
        .from(profileProjects)
        .innerJoin(developerProfiles, eq(profileProjects.profileId, developerProfiles.id))
        .leftJoin(profileUrlStubs, eq(profileUrlStubs.profileId, developerProfiles.id))
        .where(
          and(
            eq(profileProjects.jamId, input.jamId),
            // Moderation and provider visibility are the profile surface's
            // rules; a shelf on someone else's page has to honour both.
            eq(profileProjects.status, "approved"),
            eq(profileProjects.published, true),
          ),
        )
        .limit(COMMUNITY_MEMBERS_MAX),
      db
        .select({
          placementId: teamProjects.id,
          teamId: teams.id,
          name: teams.name,
          slug: teams.slug,
          avatarUrl: teams.avatarUrl,
          avatarKey: teams.avatarKey,
          entryTitle: teamProjects.title,
          submissionUrl: teamProjects.submissionUrl,
          gameUrl: teamProjects.url,
          result: teamProjects.result,
        })
        .from(teamProjects)
        .innerJoin(teams, eq(teamProjects.teamId, teams.id))
        // An archived team's page is read-only but still a real page, so its
        // jam history stays visible.
        .where(eq(teamProjects.jamId, input.jamId))
        .limit(COMMUNITY_TEAMS_MAX),
      db
        .select({ count: count() })
        .from(collabPosts)
        .where(and(eq(collabPosts.jamId, input.jamId), eq(collabPosts.status, "recruiting"))),
      queryDeclaredMembers(input.jamId),
    ]);

    // Overall placement for the imported rows, keyed on the itch entry id
    // those rows carry as `sourceId`. Same guard `queryProfileProjects`
    // uses: a library row's sourceId is a *game* id and could collide
    // numerically with an unrelated entry id.
    const entryIds = memberRows
      .filter((row) => row.source === "itchio-jam" && /^\d+$/.test(row.sourceId ?? ""))
      .map((row) => Number(row.sourceId));
    const overallRows =
      entryIds.length > 0
        ? await db
            .select({ entryId: itchJamEntryResults.entryId, rank: itchJamEntryResults.rank })
            .from(itchJamEntryResults)
            .where(
              and(
                inArray(itchJamEntryResults.entryId, entryIds),
                sql`lower(${itchJamEntryResults.criterion}) = 'overall'`,
              ),
            )
        : [];
    const rankByEntryId = new Map(overallRows.map((row) => [String(row.entryId), row.rank]));

    const members = memberRows
      .map((row) => ({
        placementId: row.placementId,
        profileId: row.profileId,
        username: row.username ?? row.discordUsername,
        avatarUrl: row.avatarUrl,
        urlStub: row.urlStub,
        entryTitle: row.entryTitle ?? row.fallbackTitle,
        entryUrl: row.submissionUrl ?? row.gameUrl,
        result: row.result,
        rank: row.source === "itchio-jam" ? (rankByEntryId.get(row.sourceId ?? "") ?? null) : null,
      }))
      // Ranked entries first, then alphabetical — a shelf ordered by row id
      // reads as random.
      .sort(
        (a, b) =>
          (a.rank ?? NO_RANK) - (b.rank ?? NO_RANK) ||
          (a.username ?? "").localeCompare(b.username ?? ""),
      );

    const teamShelf = await Promise.all(
      teamRows.map(async ({ avatarKey, ...row }) => ({
        ...row,
        avatarUrl: await resolveTeamAvatarUrl({ avatarKey, avatarUrl: row.avatarUrl }),
      })),
    );

    return {
      members,
      teams: teamShelf,
      openPostCount: postRow?.count ?? 0,
      declared,
      declaredCount: declared.length,
    };
  });

/** Faces shown in the declared tier before it collapses to a count. */
const COMMUNITY_DECLARED_MAX = 24;

/**
 * Members who said they're entering — the pre-jam half of participation.
 *
 * This is the section's answer to the problem that made it worth building:
 * for an *upcoming* jam the shipped tier is empty by construction (it comes
 * from the post-jam entries scrape), which is precisely when someone reading
 * the page is looking for people to team up with.
 *
 * Declared intent is never promoted into participation. After the jam,
 * `itchio-jam-sync` remains the only source of who actually shipped, and
 * this tier stops being rendered — "declared but didn't ship" is not a
 * status this app displays about anyone.
 */
async function queryDeclaredMembers(jamId: number) {
  return db
    .select({
      profileId: developerProfiles.id,
      username: developerProfiles.guildNickname,
      discordUsername: developerProfiles.discordUsername,
      avatarUrl: developerProfiles.avatarUrl,
      urlStub: profileUrlStubs.stub,
    })
    .from(jamWatches)
    .innerJoin(developerProfiles, eq(jamWatches.userId, developerProfiles.id))
    .leftJoin(profileUrlStubs, eq(profileUrlStubs.profileId, developerProfiles.id))
    .where(and(eq(jamWatches.jamId, jamId), eq(jamWatches.intent, "entering")))
    .orderBy(asc(jamWatches.createdAt))
    .limit(COMMUNITY_DECLARED_MAX)
    .then((rows) =>
      rows.map((row) => ({
        profileId: row.profileId,
        username: row.username ?? row.discordUsername,
        avatarUrl: row.avatarUrl,
        urlStub: row.urlStub,
      })),
    );
}

/** Jams in a host's series, beside the one being viewed. */
const HOST_SERIES_MAX = 6;

/**
 * Other jams by the same host — the series strip ("every Brackeys jam"),
 * which falls out of a jsonb containment match on `hosts[0]`.
 *
 * Matching on the host's *name* rather than an id because that's all the
 * scrape carries. A containment query (`hosts @> [{"name": …}]`) matches
 * the host in any position, so a jam that co-hosted one year and led the
 * next still shows up in the series.
 */
export const listJamsByHost = os
  .route({ method: "GET" })
  .input(
    z.object({
      hostName: z.string().trim().min(1).max(200),
      excludeJamId: z.number().int().min(1).max(MAX_INT4).optional(),
      limit: z.number().int().min(1).max(12).default(HOST_SERIES_MAX),
    }),
  )
  .handler(async ({ input }) => {
    const jams = await db
      .select({
        jamId: itchJams.jamId,
        slug: itchJams.slug,
        title: itchJams.title,
        bannerUrl: itchJams.bannerUrl,
        themeColor: itchJams.themeColor,
        startsAt: itchJams.startsAt,
        endsAt: itchJams.endsAt,
        votingEndsAt: itchJams.votingEndsAt,
        joinedCount: itchJams.joinedCount,
        entriesCount: itchJams.entriesCount,
      })
      .from(itchJams)
      .where(
        and(
          isNull(itchJams.missingSince),
          sql`${itchJams.hosts} @> ${JSON.stringify([{ name: input.hostName }])}::jsonb`,
          input.excludeJamId != null ? sql`${itchJams.jamId} <> ${input.excludeJamId}` : undefined,
        ),
      )
      // Most recent first: a series strip is "what else has this host run",
      // and the answer people want is the latest edition.
      .orderBy(desc(sql`COALESCE(${itchJams.startsAt}, '-infinity'::timestamptz)`))
      .limit(input.limit);

    return { jams };
  });

// ── Hero pins (staff curation) ──────────────────────────────────────────────

/** Enough of a jam to render a pin whose jam has left the board payload. */
const heroPinFields = {
  jamId: itchJams.jamId,
  slug: itchJams.slug,
  title: itchJams.title,
  bannerUrl: itchJams.bannerUrl,
  themeColor: itchJams.themeColor,
  hosts: itchJams.hosts,
  startsAt: itchJams.startsAt,
  endsAt: itchJams.endsAt,
  votingEndsAt: itchJams.votingEndsAt,
  joinedCount: itchJams.joinedCount,
  entriesCount: itchJams.entriesCount,
  pinnedAt: itchJams.heroPinnedAt,
};

/** A pin nobody has cleaned up is still a pin; the bound is a backstop. */
const HERO_PIN_MAX = 20;

/**
 * Which jams staff have offered the home hero, newest pin first. Its own
 * procedure rather than a `listJams` field so it can carry a much shorter
 * edge TTL — see `PUBLIC_EDGE_TTL`. Expired pins are returned too: the
 * admin panel is the only place they can be seen and cleared.
 */
export const listJamHeroPins = os.route({ method: "GET" }).handler(async () => {
  const pins = await db
    .select(heroPinFields)
    .from(itchJams)
    .where(and(isNotNull(itchJams.heroPinnedAt), isNull(itchJams.missingSince)))
    .orderBy(desc(itchJams.heroPinnedAt))
    .limit(HERO_PIN_MAX);

  return { pins };
});

/** Offer a jam to the home hero, or withdraw it. Staff, not admin — same
 * tier as featuring a collab post, and just as reversible. */
export const setJamHeroPin = os
  .use(requireStaff)
  .input(
    z.object({
      jamId: z.number().int().min(1).max(MAX_INT4),
      pinned: z.boolean(),
    }),
  )
  .handler(async ({ input, context }) => {
    const [updated] = await db
      .update(itchJams)
      .set({ heroPinnedAt: input.pinned ? new Date() : null })
      .where(eq(itchJams.jamId, input.jamId))
      .returning(heroPinFields);

    if (!updated) {
      throw new ORPCError("NOT_FOUND", { message: "Jam not found." });
    }

    await recordModerationAction({
      action: input.pinned ? "jam_hero_pinned" : "jam_hero_unpinned",
      actorId: context.user.id,
      targetType: "jam",
      targetId: updated.jamId,
      metadata: { jamTitle: updated.title, jamSlug: updated.slug },
    });

    return updated;
  });

// ── Jam engagement (the one user-declared thing about a jam) ────────────────

/**
 * Watch a jam, declare you're entering it, or drop both.
 *
 * One endpoint rather than watch/unwatch/enter/unenter: the UI is a single
 * control with three states, and modelling it as three writes invites the
 * combination where a member is somehow entering a jam they don't watch.
 *
 * `requireAuth` covers watching — it's a read affinity, no more public than
 * a bookmark. Declaring is a public claim on a community surface, so it
 * carries the same guild bar as posting; checked as a predicate rather than
 * middleware so that un-declaring and un-watching keep working for someone
 * who has since left the server. (Trapping a member in a declaration they
 * can no longer retract is the failure mode `03`'s Phase 1 hit with contact.)
 */
export const setJamWatch = os
  .use(requireAuth)
  .input(
    z.object({
      jamId: z.number().int().min(1).max(MAX_INT4),
      intent: z.enum(["watching", "entering"]).nullable(),
    }),
  )
  .handler(async ({ input, context }) => {
    if (input.intent === null) {
      await db
        .delete(jamWatches)
        .where(and(eq(jamWatches.userId, context.user.id), eq(jamWatches.jamId, input.jamId)));
      captureServerEvent(EVENTS.jamWatchToggled, context.user.id, {
        jam_id: input.jamId,
        intent: null,
      });
      return { intent: null };
    }

    if (input.intent === "entering" && !(await userIsGuildMember(context.user.id))) {
      throw new ORPCError("FORBIDDEN", {
        message: "Join the Discord server to declare that you're entering.",
      });
    }

    // A tombstoned jam is one the scraper stopped finding; there is nothing
    // to watch and the sweep skips it anyway.
    const [jam] = await db
      .select({ jamId: itchJams.jamId })
      .from(itchJams)
      .where(and(eq(itchJams.jamId, input.jamId), isNull(itchJams.missingSince)))
      .limit(1);
    if (!jam) throw new ORPCError("NOT_FOUND", { message: "Jam not found." });

    await db
      .insert(jamWatches)
      .values({ userId: context.user.id, jamId: input.jamId, intent: input.intent })
      .onConflictDoUpdate({
        target: [jamWatches.userId, jamWatches.jamId],
        // Only the intent moves. The notification stamps stay put, so
        // toggling watch → entering can't replay a start reminder.
        set: { intent: input.intent },
      });

    captureServerEvent(EVENTS.jamWatchToggled, context.user.id, {
      jam_id: input.jamId,
      intent: input.intent,
    });

    return { intent: input.intent };
  });

/** The viewer's own relationship to one jam. Private and per-viewer, which
 *  is exactly why it is not folded into the edge-cached `getJam`. */
export const getJamViewerState = os
  .use(requireAuth)
  .input(z.object({ jamId: z.number().int().min(1).max(MAX_INT4) }))
  .handler(async ({ input, context }) => {
    const [row] = await db
      .select({ intent: jamWatches.intent })
      .from(jamWatches)
      .where(and(eq(jamWatches.userId, context.user.id), eq(jamWatches.jamId, input.jamId)))
      .limit(1);
    return { intent: (row?.intent as JamWatchIntent | undefined) ?? null };
  });

/**
 * The viewer's watched jams — the dashboard strip's whole payload.
 *
 * Defaults to jams that still have an event ahead of them, because a strip
 * of finished jams is a list, not a countdown. Tombstoned jams are returned
 * rather than filtered: the strip renders them struck-through, which tells
 * the member their jam vanished instead of silently dropping the row.
 */
export const listMyJamWatches = os
  .use(requireAuth)
  .input(
    z.object({
      scope: z.enum(["upcoming", "all"]).default("upcoming"),
      limit: z.number().int().min(1).max(50).default(12),
    }),
  )
  .handler(async ({ input, context }) => {
    const rows = await db
      .select({
        jamId: itchJams.jamId,
        slug: itchJams.slug,
        title: itchJams.title,
        bannerUrl: itchJams.bannerUrl,
        themeColor: itchJams.themeColor,
        startsAt: itchJams.startsAt,
        endsAt: itchJams.endsAt,
        votingEndsAt: itchJams.votingEndsAt,
        missingSince: itchJams.missingSince,
        intent: jamWatches.intent,
        watchedAt: jamWatches.createdAt,
      })
      .from(jamWatches)
      .innerJoin(itchJams, eq(jamWatches.jamId, itchJams.jamId))
      .where(
        and(
          eq(jamWatches.userId, context.user.id),
          input.scope === "upcoming" ? gt(lastEventAt, sql`now()`) : undefined,
        ),
      )
      // Soonest next event first — the strip is ordered by urgency, so the
      // jam you have to act on is the one you read first.
      .orderBy(asc(lastEventAt))
      .limit(input.limit);

    return { jams: rows.map((r) => ({ ...r, intent: r.intent as JamWatchIntent })) };
  });
