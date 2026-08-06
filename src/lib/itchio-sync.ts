import { and, eq } from "drizzle-orm";
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
import { fetchGames } from "@/lib/itchio";
import { syncItchIoJamParticipations } from "@/lib/itchio-jam-sync";
import { convergeLibraryPlacements } from "@/lib/projects";

/** Thrown when the itch.io API call itself fails (vs. no linked account). */
export class ItchIoSyncFetchError extends Error {
  constructor(cause: unknown) {
    super("Failed to fetch games from itch.io", { cause });
  }
}

/**
 * Re-sync the user's itch.io library. Returns `null` when no itch.io
 * account (or token) is linked; throws ItchIoSyncFetchError when the
 * itch.io API call fails.
 */
export async function syncItchIoLibrary(
  userId: string,
): Promise<{ imported: number; total: number } | null> {
  const [itchAccount] = await db
    .select()
    .from(linkedAccounts)
    .where(and(eq(linkedAccounts.profileId, userId), eq(linkedAccounts.provider, "itchio")))
    .limit(1);

  if (!itchAccount?.accessToken) return null;

  const games = await fetchGames(itchAccount.accessToken).catch((err) => {
    throw new ItchIoSyncFetchError(err);
  });

  if (games.length === 0) {
    // Converge anyway: an account whose library comes back empty can still
    // hold placements imported before the canonical row existed.
    await convergeLibraryPlacements(userId, []);
    return { imported: 0, total: 0 };
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
      // Concurrent syncs (route, profile view, cron sweep) can race on the
      // same unseen game; the partial unique index makes the loser a no-op.
      .onConflictDoNothing();
  }

  // Re-syncs update visibility (publishing / unpublishing on itch.io is
  // reflected here), backfill the provider publish date on rows imported
  // before the `published_at` column existed, and keep the cover art in
  // step with itch.io (unless the owner uploaded their own image, which
  // `imageKey` records and always wins).
  for (const game of games) {
    const row = existingBySourceId.get(String(game.id));
    if (!row) continue;
    const publishedAt = game.published_at ? new Date(game.published_at) : null;
    const coverUrl = game.cover_url || null;
    const needsPublishFlip = row.published !== game.published;
    const needsDateBackfill = row.publishedAt == null && publishedAt != null;
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
    }
  }

  // Every placement gets its canonical `project.projects` row here, so the
  // backfill script stays a one-time migration rather than something that has
  // to be re-run after each sweep. Deliberately after the placement writes and
  // outside their conditionals: a row imported before convergence shipped has
  // a null `project_id` that nothing else will ever fix.
  await convergeLibraryPlacements(userId, games);

  return { imported: newGames.length, total: games.length };
}

// ── Throttled background refresh (own-profile view) ─────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var __brackeysItchioSyncRedis: IORedis | undefined;
}

const THROTTLE_TTL_SECONDS = 3600;

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
  let won: string | null;
  try {
    const redis = await getRedis();
    won = await redis.set(`itchio:sync:${userId}`, "1", "EX", THROTTLE_TTL_SECONDS, "NX");
  } catch {
    return;
  }
  if (won !== "OK") return;

  try {
    const result = await syncItchIoLibrary(userId);
    if (result) {
      console.log(
        `[itchio-sync] background refresh for ${userId}: imported ${result.imported} of ${result.total}`,
      );
    }
  } catch (err) {
    console.error(`[itchio-sync] background refresh failed for ${userId}`, err);
  }

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
}
