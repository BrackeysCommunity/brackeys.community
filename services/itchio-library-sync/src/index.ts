import { and, eq, isNotNull } from "drizzle-orm";

import { linkedAccounts, profileProjects } from "../../../src/db/schema.ts";
import { config } from "./config.ts";
import { db, pool } from "./db/client.ts";

// Local fetch helper rather than the app's `fetchGames`: the sweep needs the
// HTTP status (401/403 = revoked token, 429/5xx = back off) and its own
// User-Agent, neither of which the app helper exposes.
interface ItchGame {
  id: number;
  title: string;
  short_text?: string;
  url?: string;
  cover_url?: string;
  published: boolean;
  published_at?: string;
}

class ItchApiError extends Error {
  constructor(
    public readonly status: number,
    body: string,
  ) {
    super(`itch.io API error (${status}): ${body}`);
  }
}

async function fetchGames(accessToken: string): Promise<ItchGame[]> {
  const res = await fetch("https://api.itch.io/profile/games", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": config.USER_AGENT,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ItchApiError(res.status, body);
  }

  const data = (await res.json()) as { games?: ItchGame[] };
  return data.games ?? [];
}

// Same shape as the app's syncItchIoLibrary (src/lib/itchio-sync.ts), but
// bound to this service's drizzle client.
async function syncAccount(
  profileId: string,
  accessToken: string,
): Promise<{ imported: number; flipped: number }> {
  const games = await fetchGames(accessToken);
  if (games.length === 0) return { imported: 0, flipped: 0 };

  const existing = await db
    .select({
      id: profileProjects.id,
      sourceId: profileProjects.sourceId,
      published: profileProjects.published,
      publishedAt: profileProjects.publishedAt,
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
    const needsPublishFlip = row.published !== game.published;
    // Backfill the provider publish date on rows imported before the
    // `published_at` column existed.
    const needsDateBackfill = row.publishedAt == null && publishedAt != null;
    if (needsPublishFlip || needsDateBackfill) {
      await db
        .update(profileProjects)
        .set({
          published: game.published,
          ...(needsDateBackfill ? { publishedAt } : {}),
        })
        .where(eq(profileProjects.id, row.id));
      if (needsPublishFlip) flipped++;
    }
  }

  return { imported: newGames.length, flipped };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runSweep() {
  const started = Date.now();

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
  let failed = 0;

  try {
    for (const [i, account] of accounts.entries()) {
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
          failed++;
          continue;
        }
        if (err instanceof ItchApiError && (err.status === 429 || err.status >= 500)) {
          // itch.io is rate-limiting or unwell: stop hammering and let the
          // next cron tick retry the whole sweep.
          console.error(`[sweep] itch.io returned ${err.status}; aborting run early`);
          failed++;
          throw err;
        }
        failed++;
        console.error(`[sweep] failed to sync profile ${account.profileId}`, err);
      }
    }
  } finally {
    const elapsed = Math.round((Date.now() - started) / 1000);
    console.log(
      `[sweep] synced ${synced} accounts, imported ${imported}, visibility-flipped ${flipped}, failed ${failed} in ${elapsed}s`,
    );
  }
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
