import { and, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";

/**
 * Jam participation backfill: joins the scraped `itch.jam_entries` against
 * the user's linked itch.io account and mirrors matches into
 * `profile_projects` as `type: "jam"` rows (source `itchio-jam`).
 *
 * Unlike the library sync this never calls the itch.io API — the itch OAuth
 * API has no jam endpoints, so the scraped tables are the only source. That
 * also means no access token is required, only a linked account.
 *
 * Matching is two-tier:
 *  1. Uploader — `jam_entries.author_id` equals the linked account's itch
 *     user id (exact numeric match).
 *  2. Teammate — a `contributors[]` element's URL equals the linked
 *     account's profile URL (normalized). Names alone never match.
 */
import { db } from "@/db";
import {
  itchJamEntries,
  itchJamEntryResults,
  itchJams,
  linkedAccounts,
  profileProjects,
} from "@/db/schema";
import { normalizeItchProfileUrl } from "@/lib/itch-urls";
import { convergeJamPlacements } from "@/lib/projects";

/** Re-exported from its own module: the canonical writes need the same
 * comparison and can't import this file (it opens the app's `db`). */
export { normalizeItchProfileUrl };

/** "Overall: #12 of 312" — entry count omitted when the jam row lacks it. */
export function composeOverallResult(rank: number, entriesCount: number | null): string {
  return entriesCount != null && entriesCount > 0
    ? `Overall: #${rank} of ${entriesCount}`
    : `Overall: #${rank}`;
}

function sameMembers(a: string[] | null, b: string[] | null): boolean {
  if (a == null || b == null) return a == null && b == null;
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export async function syncItchIoJamParticipations(
  userId: string,
): Promise<{ imported: number; total: number } | null> {
  const [itchAccount] = await db
    .select()
    .from(linkedAccounts)
    .where(and(eq(linkedAccounts.profileId, userId), eq(linkedAccounts.provider, "itchio")))
    .limit(1);

  if (!itchAccount) return null;

  const authorId = Number(itchAccount.providerUserId);
  const profileUrl = normalizeItchProfileUrl(itchAccount.providerProfileUrl);

  const matchConditions: SQL[] = [];
  if (Number.isFinite(authorId)) {
    matchConditions.push(eq(itchJamEntries.authorId, authorId));
  }
  if (profileUrl) {
    matchConditions.push(
      sql`EXISTS (
        SELECT 1 FROM jsonb_array_elements(${itchJamEntries.contributors}) AS contributor
        WHERE lower(trim(TRAILING '/' FROM contributor->>'url')) = ${profileUrl}
      )`,
    );
  }
  if (matchConditions.length === 0) return { imported: 0, total: 0 };

  const matches = await db
    .select({
      entry: itchJamEntries,
      jamEntriesCount: itchJams.entriesCount,
    })
    .from(itchJamEntries)
    .innerJoin(itchJams, eq(itchJamEntries.jamId, itchJams.jamId))
    // Entries stamped missing_since were delisted on itch — don't import them
    // as participations.
    .where(and(isNull(itchJamEntries.missingSince), or(...matchConditions)));

  if (matches.length === 0) {
    return { imported: 0, total: 0 };
  }

  // Overall ranks land after the results scrape (post-voting); rows imported
  // before that get their `result` backfilled on a later run.
  const overallRows = await db
    .select({
      entryId: itchJamEntryResults.entryId,
      rank: itchJamEntryResults.rank,
    })
    .from(itchJamEntryResults)
    .where(
      and(
        inArray(
          itchJamEntryResults.entryId,
          matches.map((m) => m.entry.entryId),
        ),
        sql`lower(${itchJamEntryResults.criterion}) = 'overall'`,
      ),
    );
  const overallByEntryId = new Map(overallRows.map((r) => [r.entryId, r.rank]));

  const existing = await db
    .select({
      id: profileProjects.id,
      sourceId: profileProjects.sourceId,
      result: profileProjects.result,
      teamMembers: profileProjects.teamMembers,
      imageUrl: profileProjects.imageUrl,
      imageKey: profileProjects.imageKey,
    })
    .from(profileProjects)
    .where(and(eq(profileProjects.profileId, userId), eq(profileProjects.source, "itchio-jam")));
  const existingBySourceId = new Map(existing.map((e) => [e.sourceId, e]));

  const resultFor = (m: (typeof matches)[number]) => {
    const rank = overallByEntryId.get(m.entry.entryId);
    return rank != null ? composeOverallResult(rank, m.jamEntriesCount) : null;
  };
  const teamFor = (m: (typeof matches)[number]) => {
    const names = m.entry.contributors.map((c) => c.name).filter((n) => n.length > 0);
    return names.length > 0 ? names : null;
  };

  const newMatches = matches.filter((m) => !existingBySourceId.has(String(m.entry.entryId)));

  if (newMatches.length > 0) {
    await db
      .insert(profileProjects)
      .values(
        newMatches.map((m) => ({
          profileId: userId,
          type: "jam" as const,
          title: m.entry.gameTitle,
          description: m.entry.gameShortText,
          url: m.entry.gameUrl,
          imageUrl: m.entry.gameCoverUrl,
          source: "itchio-jam" as const,
          sourceId: String(m.entry.entryId),
          status: "approved",
          // Jam participation is public record on itch (entries pages are
          // public regardless of the game page's visibility).
          published: true,
          jamId: m.entry.jamId,
          submissionTitle: m.entry.gameTitle,
          submissionUrl: m.entry.rateUrl,
          result: resultFor(m),
          teamMembers: teamFor(m),
          participatedAt: m.entry.submittedAt,
        })),
      )
      // Concurrent syncs (route, profile view, cron sweep) can race on the
      // same unseen entry; the partial unique index makes the loser a no-op.
      .onConflictDoNothing();
  }

  // Re-syncs backfill results once the rate-page scrape lands, keep the team
  // roster in step, and refresh the cover unless the owner uploaded their
  // own image (imageKey set — always wins).
  for (const m of matches) {
    const row = existingBySourceId.get(String(m.entry.entryId));
    if (!row) continue;
    const result = resultFor(m);
    const team = teamFor(m);
    const coverUrl = m.entry.gameCoverUrl;
    const needsResult = result != null && row.result !== result;
    const needsTeam = !sameMembers(row.teamMembers, team);
    const needsCover = row.imageKey == null && row.imageUrl !== coverUrl;
    if (needsResult || needsTeam || needsCover) {
      await db
        .update(profileProjects)
        .set({
          ...(needsResult ? { result } : {}),
          ...(needsTeam ? { teamMembers: team } : {}),
          ...(needsCover ? { imageUrl: coverUrl } : {}),
        })
        .where(eq(profileProjects.id, row.id));
    }
  }

  // Canonical convergence: every jam placement gets a `project.projects` row,
  // keyed on the entry's *game* id so a game that was both jam-submitted and
  // library-imported is one project — and the entry's contributors become
  // credits on it.
  await convergeJamPlacements(
    userId,
    matches.map((m) => m.entry),
  );

  return { imported: newMatches.length, total: matches.length };
}
