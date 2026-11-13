// What a play page reports its frame did with a scene version, and the
// breaker's sentence. Imports only the count formatter, so the play page's
// client, the editor's host, the router's schema and the server share it.

import { formatCount } from "../format-bytes";

export const LIVE_OUTCOMES = ["applied", "refused", "failed", "crashed"] as const;

export type LiveOutcome = (typeof LIVE_OUTCOMES)[number];

/** An issue code a report may carry; the page drops any other, which the router would refuse. */
export const LIVE_ISSUE_CODE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * Whether the player's game failed with the version: what `reports_failed`
 * and the breaker count. A refused version never ran, so the game went on
 * with the one it had.
 */
export const isFailedOutcome = (outcome: string): boolean =>
  outcome === "failed" || outcome === "crashed";

/** "5 of 12 players' games failed after this update": why the breaker blocked a version. */
export const breakerReason = (failed: number, total: number): string =>
  `${formatCount(failed)} of ${formatCount(total)} players' games failed after this update`;

/**
 * Why a version is blocked, as the editor, a refused move and the game page
 * all say it: the reason stored when it was blocked, else for the breaker's
 * block its sentence from the version's report counts. Null when a person
 * blocked it without one. No closing period.
 */
export function blockedReasonOf(blocked: {
  by: string | null;
  reason: string | null;
  reports: { ok: number; failed: number };
}): string | null {
  if (blocked.reason) return blocked.reason;
  const { ok, failed } = blocked.reports;
  return blocked.by === "system" ? breakerReason(failed, ok + failed) : null;
}
