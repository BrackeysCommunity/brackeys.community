import { LIVE_BLOCK } from "./limits";
import { isFailedOutcome } from "./live-outcomes";

/** One signed-in player's latest outcome with a version on a channel. */
export type LiveReportRow = { userId: string; outcome: string; at: Date };

/**
 * The breaker over a version's signed-in reports on one channel since its
 * pointer moved (or it was last unblocked): enough distinct players whose
 * games failed or crashed within the window, at a high enough share.
 *
 * Only rows inside `[since, since + LIVE_BLOCK.windowMinutes]` (and not after
 * `now`) count, each player once by their latest outcome there. `failed` and
 * `total` are distinct players, for the block reason's wording.
 */
export function shouldBlock(
  rows: readonly LiveReportRow[],
  since: Date,
  now: Date,
): { block: boolean; failed: number; total: number } {
  const start = since.getTime();
  const end = Math.min(start + LIVE_BLOCK.windowMinutes * 60_000, now.getTime());
  const latest = new Map<string, LiveReportRow>();
  for (const row of rows) {
    const at = row.at.getTime();
    if (at < start || at > end) continue;
    const seen = latest.get(row.userId);
    if (!seen || seen.at.getTime() <= at) latest.set(row.userId, row);
  }
  const total = latest.size;
  let failed = 0;
  for (const row of latest.values()) if (isFailedOutcome(row.outcome)) failed++;
  const block = failed >= LIVE_BLOCK.players && failed >= LIVE_BLOCK.ratio * total;
  return { block, failed, total };
}
