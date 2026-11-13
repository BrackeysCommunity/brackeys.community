// What a play page reports its frame did with a scene version. Import-free,
// so the play page's client, the router's schema and the server share it.

export const LIVE_OUTCOMES = ["applied", "refused", "failed", "crashed"] as const;

export type LiveOutcome = (typeof LIVE_OUTCOMES)[number];

/**
 * Whether the player's game failed with the version: what `reports_failed`
 * and the breaker count. A refused version never ran, so the game went on
 * with the one it had.
 */
export const isFailedOutcome = (outcome: string): boolean =>
  outcome === "failed" || outcome === "crashed";
