import { and, eq, inArray, isNotNull, or, sql, type SQL } from "drizzle-orm";

import {
  itchJamEntries,
  itchJamEntryResults,
  itchJams,
  linkedAccounts,
  profileProjects,
} from "../../../src/db/schema.ts";
import { normalizeItchProfileUrl } from "../../../src/lib/itch-urls.ts";
// The canonical-project writes are shared with the app on purpose: this sweep
// creates placements, and a placement with no `project_id` behind it is a
// project page that doesn't exist. Both copies of the orchestration have to
// mint the canonical row or the backfill script never stops being needed.
import { fetchGames, ItchApiError } from "../../../src/lib/itchio.ts";
import { convergeJamPlacements, convergeLibraryPlacements } from "../../../src/lib/project-sync.ts";
import { config } from "./config.ts";
import { db, pool } from "./db/client.ts";

// Same shape as the app's syncItchIoLibrary (src/lib/itchio-sync.ts), but
// bound to this service's drizzle client.
async function syncAccount(
  profileId: string,
  accessToken: string,
): Promise<{ imported: number; flipped: number }> {
  const games = await fetchGames(accessToken, { userAgent: config.USER_AGENT });
  if (games.length === 0) {
    // Converge anyway: an account whose library comes back empty can still
    // hold placements imported before the canonical row existed.
    await convergeLibraryPlacements(db, profileId, []);
    return { imported: 0, flipped: 0 };
  }

  const existing = await db
    .select({
      id: profileProjects.id,
      sourceId: profileProjects.sourceId,
      published: profileProjects.published,
      publishedAt: profileProjects.publishedAt,
      imageUrl: profileProjects.imageUrl,
      imageKey: profileProjects.imageKey,
    })
    .from(profileProjects)
    .where(and(eq(profileProjects.profileId, profileId), eq(profileProjects.source, "itchio")));

  const existingBySourceId = new Map(existing.map((e) => [e.sourceId, e]));
  const newGames = games.filter((g) => !existingBySourceId.has(String(g.id)));

  if (newGames.length > 0) {
    await db
      .insert(profileProjects)
      .values(
        newGames.map((game) => ({
          profileId,
          type: "game" as const,
          title: game.title,
          description: game.short_text || null,
          url: game.url || null,
          imageUrl: game.cover_url || null,
          source: "itchio" as const,
          sourceId: String(game.id),
          status: "approved",
          published: game.published,
          publishedAt: game.published_at ? new Date(game.published_at) : null,
        })),
      )
      // The app may sync the same account concurrently; the partial unique
      // index on (profile_id, source, source_id) makes the loser a no-op.
      .onConflictDoNothing();
  }

  let flipped = 0;
  for (const game of games) {
    const row = existingBySourceId.get(String(game.id));
    if (!row) continue;
    const publishedAt = game.published_at ? new Date(game.published_at) : null;
    const coverUrl = game.cover_url || null;
    const needsPublishFlip = row.published !== game.published;
    // Backfill the provider publish date on rows imported before the
    // `published_at` column existed.
    const needsDateBackfill = row.publishedAt == null && publishedAt != null;
    // Keep cover art in step with itch.io unless the owner uploaded their
    // own image (`imageKey` set), which always wins.
    const needsCoverRefresh = row.imageKey == null && row.imageUrl !== coverUrl;
    if (needsPublishFlip || needsDateBackfill || needsCoverRefresh) {
      await db
        .update(profileProjects)
        .set({
          published: game.published,
          ...(needsDateBackfill ? { publishedAt } : {}),
          ...(needsCoverRefresh ? { imageUrl: coverUrl } : {}),
        })
        .where(eq(profileProjects.id, row.id));
      if (needsPublishFlip) flipped++;
    }
  }

  // Mint/link the canonical project for every placement this account holds,
  // and let the provider fill in canonical facts nothing else knows.
  await convergeLibraryPlacements(db, profileId, games);

  return { imported: newGames.length, flipped };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ── Restricted-visibility probe ──────────────────────────────────────────────
//
// itch.io pages have three visibility states (Draft / Restricted / Public)
// but the API's `published` boolean only encodes Draft=false — Restricted
// games come back `published: true` with no distinguishing field at all.
// The only signal is the public page itself: anonymous requests get 200 for
// Public and 404 for Restricted (and note that `<url>/data.json` returns
// 200 even for restricted pages, so it can't be used as a lighter probe).

class ProbeBackoffError extends Error {
  constructor(public readonly status: number) {
    super(`itch.io returned ${status} during visibility probe`);
  }
}

/** Anonymous HEAD of a game page. Returns the visibility verdict, null when
 * the response proves nothing (timeouts, network errors, odd statuses), and
 * throws ProbeBackoffError on 429/5xx so the sweep stops hammering. */
async function probeVisibility(url: string): Promise<"public" | "hidden" | null> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "HEAD",
      headers: { "User-Agent": config.USER_AGENT },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return null;
  }
  if (res.status === 200) return "public";
  if (res.status === 404) return "hidden";
  if (res.status === 429 || res.status >= 500) throw new ProbeBackoffError(res.status);
  return null;
}

/**
 * Second sweep phase: probe every API-published itch.io row's public URL
 * and keep `restricted_at` in step — set on a hard 404 (Restricted on
 * itch.io, or deleted; either way not publicly viewable), cleared on 200.
 * `restricted_at` is owned by this probe alone: the API sync keeps
 * asserting `published: true` for restricted games, so encoding the state
 * in `published` would just get flipped back next sync.
 */
async function probeRestricted(): Promise<{ probed: number; marked: number; cleared: number }> {
  const rows = await db
    .select({
      id: profileProjects.id,
      url: profileProjects.url,
      restrictedAt: profileProjects.restrictedAt,
    })
    .from(profileProjects)
    .where(
      and(
        eq(profileProjects.source, "itchio"),
        eq(profileProjects.published, true),
        isNotNull(profileProjects.url),
      ),
    );

  let probed = 0;
  let marked = 0;
  let cleared = 0;

  for (const [i, row] of rows.entries()) {
    if (!row.url) continue; // filtered in SQL; narrows the type
    if (i > 0) await sleep(config.SYNC_DELAY_MS);

    let verdict: "public" | "hidden" | null;
    try {
      verdict = await probeVisibility(row.url);
    } catch (err) {
      if (err instanceof ProbeBackoffError) {
        // itch.io is rate-limiting or unwell: stop probing and let the next
        // cron tick finish the job. Rows already updated this run stand.
        console.error(`[probe] itch.io returned ${err.status}; aborting probe phase early`);
        break;
      }
      throw err;
    }
    probed++;
    if (verdict === "hidden" && row.restrictedAt == null) {
      await db
        .update(profileProjects)
        .set({ restrictedAt: new Date() })
        .where(eq(profileProjects.id, row.id));
      marked++;
      console.log(`[probe] marked restricted: ${row.url}`);
    } else if (verdict === "public" && row.restrictedAt != null) {
      await db
        .update(profileProjects)
        .set({ restrictedAt: null })
        .where(eq(profileProjects.id, row.id));
      cleared++;
      console.log(`[probe] cleared restricted: ${row.url}`);
    }
  }

  return { probed, marked, cleared };
}

// ── Jam participation backfill ───────────────────────────────────────────────
//
// The itch.io OAuth API has no jam endpoints, so jam participation comes from
// the scraped `itch.jam_entries` (itchio-scraper service) — a pure DB join,
// no itch.io traffic and no access token needed. Uploaders match by numeric
// itch user id, teammates by contributor profile URL (never by name). Same
// shape as the app's syncItchIoJamParticipations (src/lib/itchio-jam-sync.ts),
// but bound to this service's drizzle client.

function composeOverallResult(rank: number, entriesCount: number | null): string {
  return entriesCount != null && entriesCount > 0
    ? `Overall: #${rank} of ${entriesCount}`
    : `Overall: #${rank}`;
}

function sameMembers(a: string[] | null, b: string[] | null): boolean {
  if (a == null || b == null) return a == null && b == null;
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

async function backfillJamsForAccount(account: {
  profileId: string;
  providerUserId: string;
  providerProfileUrl: string | null;
}): Promise<{ imported: number }> {
  const authorId = Number(account.providerUserId);
  const profileUrl = normalizeItchProfileUrl(account.providerProfileUrl);

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
  if (matchConditions.length === 0) return { imported: 0 };

  const matches = await db
    .select({
      entry: itchJamEntries,
      jamEntriesCount: itchJams.entriesCount,
    })
    .from(itchJamEntries)
    .innerJoin(itchJams, eq(itchJamEntries.jamId, itchJams.jamId))
    .where(or(...matchConditions));

  if (matches.length === 0) return { imported: 0 };

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
    .where(
      and(
        eq(profileProjects.profileId, account.profileId),
        eq(profileProjects.source, "itchio-jam"),
      ),
    );
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
          profileId: account.profileId,
          type: "jam" as const,
          title: m.entry.gameTitle,
          description: m.entry.gameShortText,
          url: m.entry.gameUrl,
          imageUrl: m.entry.gameCoverUrl,
          source: "itchio-jam" as const,
          sourceId: String(m.entry.entryId),
          status: "approved",
          // Jam participation is public record on itch — entries pages are
          // public regardless of the game page's visibility, so no
          // restricted-probe coupling here.
          published: true,
          jamId: m.entry.jamId,
          submissionTitle: m.entry.gameTitle,
          submissionUrl: m.entry.rateUrl,
          result: resultFor(m),
          teamMembers: teamFor(m),
          participatedAt: m.entry.submittedAt,
        })),
      )
      .onConflictDoNothing();
  }

  // Re-syncs backfill `result` once the post-voting rate-page scrape lands,
  // keep the team roster in step, and refresh the cover unless the owner
  // uploaded their own image (imageKey set — always wins).
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

  // Same convergence as the app's jam sync: the placement carries an entry
  // id, the canonical project is keyed on that entry's game id, and the
  // entry's contributors become credits on it.
  await convergeJamPlacements(
    db,
    account.profileId,
    matches.map((m) => m.entry),
  );

  return { imported: newMatches.length };
}

async function backfillJams(): Promise<{ accounts: number; imported: number; failed: number }> {
  // No token filter: the join needs only the account identity, so accounts
  // with revoked tokens still get their jam history backfilled.
  const accounts = await db
    .select({
      profileId: linkedAccounts.profileId,
      providerUserId: linkedAccounts.providerUserId,
      providerProfileUrl: linkedAccounts.providerProfileUrl,
    })
    .from(linkedAccounts)
    .where(eq(linkedAccounts.provider, "itchio"));

  let imported = 0;
  const failedAccounts: typeof accounts = [];
  for (const account of accounts) {
    try {
      const result = await backfillJamsForAccount(account);
      imported += result.imported;
    } catch (err) {
      failedAccounts.push(account);
      console.error(`[jams] backfill failed for profile ${account.profileId}`, err);
    }
  }

  // One retry at the end for whatever failed. This phase is a pure DB join, so
  // the realistic failure is a transient connection blip rather than anything
  // a second attempt would repeat.
  let failed = failedAccounts.length;
  if (failed > 0) {
    console.log(`[jams] retrying ${failed} failed account(s)`);
    for (const account of failedAccounts) {
      try {
        const result = await backfillJamsForAccount(account);
        imported += result.imported;
        failed--;
      } catch (err) {
        console.error(`[jams] backfill failed for profile ${account.profileId}`, err);
      }
    }
  }

  return { accounts: accounts.length, imported, failed };
}

async function runSweep() {
  const started = Date.now();

  // Jam backfill first: it's DB-only (no itch.io traffic), so it must not be
  // lost when the API sweep below aborts early on a 429/5xx.
  const jams = await backfillJams();
  console.log(
    `[jams] backfilled ${jams.accounts} accounts, imported ${jams.imported}, failed ${jams.failed}`,
  );

  const accounts = await db
    .select({
      profileId: linkedAccounts.profileId,
      accessToken: linkedAccounts.accessToken,
    })
    .from(linkedAccounts)
    .where(and(eq(linkedAccounts.provider, "itchio"), isNotNull(linkedAccounts.accessToken)));

  console.log(`[sweep] ${accounts.length} linked itch.io accounts to sync`);

  let synced = 0;
  let imported = 0;
  let flipped = 0;
  let revoked = 0;
  let aborted = false;

  type Account = (typeof accounts)[number];

  // Returns the accounts worth another go: a revoked token isn't one (the
  // second 401 is as certain as the first), a 429/5xx abort isn't either
  // (nothing after it was attempted, and the next tick re-runs the sweep).
  const pass = async (list: readonly Account[]): Promise<Account[]> => {
    const retryable: Account[] = [];

    for (const [i, account] of list.entries()) {
      if (!account.accessToken) continue; // filtered in SQL; narrows the type
      if (i > 0) await sleep(config.SYNC_DELAY_MS);

      try {
        const result = await syncAccount(account.profileId, account.accessToken);
        synced++;
        imported += result.imported;
        flipped += result.flipped;
      } catch (err) {
        if (err instanceof ItchApiError && (err.status === 401 || err.status === 403)) {
          // Token revoked: leave the linked_accounts row; the profile UI's
          // reconnect path handles re-linking.
          console.warn(`[sweep] token revoked for profile ${account.profileId}, skipping`);
          revoked++;
          continue;
        }
        if (err instanceof ItchApiError && (err.status === 429 || err.status >= 500)) {
          // itch.io is rate-limiting or unwell: stop hammering and let the
          // next cron tick retry the whole sweep.
          console.error(`[sweep] itch.io returned ${err.status}; aborting run early`);
          aborted = true;
          break;
        }
        retryable.push(account);
        console.error(`[sweep] failed to sync profile ${account.profileId}`, err);
      }
    }

    return retryable;
  };

  let failed = 0;
  try {
    const failedAccounts = await pass(accounts);
    failed = failedAccounts.length;
    if (failed > 0 && !aborted) {
      console.log(`[sweep] retrying ${failed} failed account(s)`);
      const stillFailing = await pass(failedAccounts);
      failed = stillFailing.length;
    }
  } finally {
    const elapsed = Math.round((Date.now() - started) / 1000);
    console.log(
      `[sweep] synced ${synced} accounts, imported ${imported}, visibility-flipped ${flipped}, revoked ${revoked}, failed ${failed} in ${elapsed}s${
        aborted ? " (aborted early — next tick retries)" : ""
      }`,
    );
  }

  // Nothing else touches itch.io while it is rate-limiting or down; the probe
  // is the next tick's problem.
  if (aborted) return;

  // Probe after the API sync so freshly imported rows are covered too, and
  // so rows the sync just unpublished (drafts) are already excluded.
  const probe = await probeRestricted();
  console.log(
    `[probe] probed ${probe.probed} pages, marked ${probe.marked} restricted, cleared ${probe.cleared}`,
  );
}

async function main() {
  try {
    await runSweep();
  } finally {
    await pool.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error("[boot] fatal", err);
  process.exit(1);
});
