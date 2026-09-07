import { itchTierHeartbeats } from "../../../src/db/schema.ts";
import { db } from "./db/client.ts";

/**
 * Liveness row for the reconciler, in the same table the crawler's tiers
 * write. A PostHog alert on a stale `last_ok_at` — or an `/admin` panel
 * reading the table — is the failure signal the cron services never had.
 */
export async function heartbeat(
  tier: string,
  outcome: { ok: true } | { ok: false; error: string },
): Promise<void> {
  const now = new Date();
  const set = outcome.ok
    ? { lastOkAt: now, lastError: null, updatedAt: now }
    : { lastError: outcome.error, updatedAt: now };
  await db
    .insert(itchTierHeartbeats)
    .values({ tier, lastStartedAt: now, ...set })
    .onConflictDoUpdate({ target: itchTierHeartbeats.tier, set });
}
