import { and, eq, inArray, isNull } from "drizzle-orm";
/**
 * Shared itch.io library sync: fetches the linked account's games and
 * mirrors them into `profile_projects` (new games inserted, `published`
 * visibility kept in step with itch.io).
 *
 * Called from three places: the explicit "Import games" ORPC route, the
 * throttled background refresh on own-profile view, and (re-implemented
 * against its own client) the itchio-library-sync cron service.
 */
import type IORedis from "ioredis";

import { db } from "@/db";
import { linkedAccounts, profileProjects } from "@/db/schema";
import { fetchGames, ItchApiError } from "@/lib/itchio";
import { syncItchIoJamParticipations } from "@/lib/itchio-jam-sync";
import { placementTypeFromClassification } from "@/lib/project-taxonomy";
import { convergeLibraryPlacements } from "@/lib/projects";

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

  const games = await fetchGames(itchAccount.accessToken).catch(async (err) => {
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

// ── Throttled background refresh (own-profile view) ─────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var __brackeysItchioSyncRedis: IORedis | undefined;
}

const THROTTLE_TTL_SECONDS = 3600;
// Short initial lock: it only has to outlive one sync attempt. The full
// throttle window is granted on success; a failed sync releases the key so
// the next profile view retries instead of waiting out the hour.
const LOCK_TTL_SECONDS = 300;

async function getRedis(): Promise<IORedis> {
  if (globalThis.__brackeysItchioSyncRedis) return globalThis.__brackeysItchioSyncRedis;
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL is not set");
  const { default: IORedisCtor } = await import("ioredis");
  globalThis.__brackeysItchioSyncRedis = new IORedisCtor(url, {
    maxRetriesPerRequest: null,
  });
  return globalThis.__brackeysItchioSyncRedis;
}

/**
 * Fire-and-forget library refresh, at most once per hour per user (Redis
 * NX key is the only throttle state). Never throws: Redis being down
 * skips the refresh entirely rather than bypassing the throttle.
 */
export async function syncItchIoLibraryThrottled(userId: string): Promise<void> {
  const key = `itchio:sync:${userId}`;
  let redis: IORedis;
  let won: string | null;
  try {
    redis = await getRedis();
    won = await redis.set(key, "1", "EX", LOCK_TTL_SECONDS, "NX");
  } catch {
    return;
  }
  if (won !== "OK") return;

  let syncFailed = false;
  try {
    const result = await syncItchIoLibrary(userId);
    if (result) {
      console.log(
        `[itchio-sync] background refresh for ${userId}: imported ${result.imported} of ${result.total}`,
      );
    }
  } catch (err) {
    syncFailed = true;
    console.error(`[itchio-sync] background refresh failed for ${userId}`, err);
  }

  // Jam backfill is DB-only; its failures don't burn the throttle window.
  try {
    const jams = await syncItchIoJamParticipations(userId);
    if (jams && jams.imported > 0) {
      console.log(
        `[itchio-sync] jam backfill for ${userId}: imported ${jams.imported} of ${jams.total}`,
      );
    }
  } catch (err) {
    console.error(`[itchio-sync] jam backfill failed for ${userId}`, err);
  }

  // Success extends the lock to the real throttle window; failure releases
  // it. `XX` on the extend means an expired lock is not resurrected into a
  // stale throttle, and the DEL is safe because the key is ours (a second
  // concurrent sync in the gap is tolerated by the DB's onConflictDoNothing).
  try {
    if (syncFailed) {
      await redis.del(key);
    } else {
      await redis.set(key, "1", "EX", THROTTLE_TTL_SECONDS, "XX");
    }
  } catch {
    // Best-effort: Redis being down here just leaves the 5-minute lock.
  }
}
