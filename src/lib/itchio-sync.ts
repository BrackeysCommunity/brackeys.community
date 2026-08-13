import { and, eq, inArray, isNull } from "drizzle-orm";
/**
 * Shared itch.io library sync: fetches the linked account's games and
 * mirrors them into `profile_projects` (new games inserted, `published`
 * visibility kept in step with itch.io).
 *
 * Called from two places: the explicit "Import games" ORPC route, and
 * (re-implemented against its own client) the itchio-library-sync cron
 * service, which is what keeps libraries fresh without anyone asking.
 */

import { db } from "@/db";
import { linkedAccounts, profileProjects } from "@/db/schema";
import { fetchGames, ItchApiError } from "@/lib/itchio";
import { placementTypeFromClassification } from "@/lib/project-taxonomy";
import { convergeLibraryPlacements } from "@/lib/projects";
import { openToken } from "@/lib/token-crypto";

/** Thrown when the itch.io API call itself fails (vs. no linked account).
 * `status` is set when itch answered with an error status, absent when the
 * request never got through. */
export class ItchIoSyncFetchError extends Error {
  readonly status?: number;

  constructor(cause: unknown) {
    super("Failed to fetch games from itch.io", { cause });
    if (cause instanceof ItchApiError) this.status = cause.status;
  }
}

/**
 * Re-sync the user's itch.io library. Returns `null` when no itch.io
 * account (or token) is linked; throws ItchIoSyncFetchError when the
 * itch.io API call fails.
 */
export async function syncItchIoLibrary(
  userId: string,
): Promise<{ imported: number; total: number; drafts: number } | null> {
  const [itchAccount] = await db
    .select()
    .from(linkedAccounts)
    .where(and(eq(linkedAccounts.profileId, userId), eq(linkedAccounts.provider, "itchio")))
    .limit(1);

  if (!itchAccount?.accessToken) return null;

  // Sealed at rest; a decrypt failure here is a config error (bad or
  // missing LINKED_ACCOUNTS_ENC_KEY) and should be loud, not wrapped.
  const accessToken = openToken(itchAccount.accessToken);

  const games = await fetchGames(accessToken).catch(async (err) => {
    // Token health stamping: the first 401/403 records when the token went
    // bad (the timestamp survives later failures), so the profile UI can
    // prompt a reconnect even if the nightly sweep never reaches this user.
    if (err instanceof ItchApiError && (err.status === 401 || err.status === 403)) {
      await db
        .update(linkedAccounts)
        .set({ tokenInvalidAt: new Date() })
        .where(and(eq(linkedAccounts.id, itchAccount.id), isNull(linkedAccounts.tokenInvalidAt)))
        .catch(() => {});
    }
    throw new ItchIoSyncFetchError(err);
  });

  // The token proved good: clear any stale invalid flag and move the sweep's
  // resume cursor.
  await db
    .update(linkedAccounts)
    .set({ tokenInvalidAt: null, lastSyncedAt: new Date() })
    .where(eq(linkedAccounts.id, itchAccount.id));

  if (games.length === 0) {
    // Converge anyway: an account whose library comes back empty can still
    // hold placements imported before the canonical row existed.
    await convergeLibraryPlacements(userId, []);
    return { imported: 0, total: 0, drafts: 0 };
  }

  const existing = await db
    .select({
      id: profileProjects.id,
      sourceId: profileProjects.sourceId,
      published: profileProjects.published,
      publishedAt: profileProjects.publishedAt,
      url: profileProjects.url,
      imageUrl: profileProjects.imageUrl,
      imageKey: profileProjects.imageKey,
      missingSince: profileProjects.missingSince,
    })
    .from(profileProjects)
    .where(and(eq(profileProjects.profileId, userId), eq(profileProjects.source, "itchio")));

  const existingBySourceId = new Map(existing.map((e) => [e.sourceId, e]));

  // Unpublished drafts are imported too — getProfile hides them from
  // everyone but the owner via the `published` flag.
  const newGames = games.filter((g) => !existingBySourceId.has(String(g.id)));

  if (newGames.length > 0) {
    await db
      .insert(profileProjects)
      .values(
        newGames.map((game) => ({
          profileId: userId,
          type: placementTypeFromClassification(game.classification),
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
      // Concurrent syncs (route, profile view, cron sweep) can race on the
      // same unseen game; the partial unique index makes the loser a no-op.
      .onConflictDoNothing();
  }

  // Re-syncs update visibility (publishing / unpublishing on itch.io is
  // reflected here), backfill the provider publish date on rows imported
  // before the `published_at` column existed, keep the cover art in step
  // with itch.io (unless the owner uploaded their own image, which
  // `imageKey` records and always wins), and keep the URL current — a
  // username rename changes every game URL, and the restricted-visibility
  // probe HEADs the stored one, so a stale URL reads as a 404 and wrongly
  // hides the game.
  for (const game of games) {
    const row = existingBySourceId.get(String(game.id));
    if (!row) continue;
    const publishedAt = game.published_at ? new Date(game.published_at) : null;
    const coverUrl = game.cover_url || null;
    const needsPublishFlip = row.published !== game.published;
    const needsDateBackfill = row.publishedAt == null && publishedAt != null;
    const needsCoverRefresh = row.imageKey == null && row.imageUrl !== coverUrl;
    const needsUrlRefresh = Boolean(game.url) && row.url !== game.url;
    if (needsPublishFlip || needsDateBackfill || needsCoverRefresh || needsUrlRefresh) {
      await db
        .update(profileProjects)
        .set({
          published: game.published,
          ...(needsDateBackfill ? { publishedAt } : {}),
          ...(needsCoverRefresh ? { imageUrl: coverUrl } : {}),
          ...(needsUrlRefresh ? { url: game.url } : {}),
        })
        .where(eq(profileProjects.id, row.id));
    }
  }

  // Missing reconciliation: `/profile/games` is the complete library, so
  // absence is authoritative (unlike a scrape) — the game was deleted on
  // itch or this member lost access to it; either way it leaves the public
  // profile. Guarded by the zero-games early return above: an API hiccup
  // returning an empty list must not stamp the whole library missing.
  const seen = new Set(games.map((g) => String(g.id)));
  const nowMissing = existing
    .filter((row) => row.sourceId != null && !seen.has(row.sourceId) && row.missingSince == null)
    .map((row) => row.id);
  const returned = existing
    .filter((row) => row.sourceId != null && seen.has(row.sourceId) && row.missingSince != null)
    .map((row) => row.id);
  if (nowMissing.length > 0) {
    await db
      .update(profileProjects)
      .set({ missingSince: new Date() })
      .where(inArray(profileProjects.id, nowMissing));
  }
  if (returned.length > 0) {
    await db
      .update(profileProjects)
      .set({ missingSince: null })
      .where(inArray(profileProjects.id, returned));
  }

  // Every placement gets its canonical `project.projects` row here, so the
  // backfill script stays a one-time migration rather than something that has
  // to be re-run after each sweep. Deliberately after the placement writes and
  // outside their conditionals: a row imported before convergence shipped has
  // a null `project_id` that nothing else will ever fix.
  await convergeLibraryPlacements(userId, games);

  return {
    imported: newGames.length,
    total: games.length,
    // Drafts import fine but stay owner-only; the toasts say so instead of
    // letting "imported 12" quietly disagree with 9 visible games.
    drafts: games.filter((game) => !game.published).length,
  };
}
