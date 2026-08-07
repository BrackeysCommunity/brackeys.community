/**
 * Lifecycle windows for collab posts and teams — the write-side stamps
 * and the `services/lifecycle-sweep` cron both read these, so every
 * number lives here and nowhere else. Pure module: no imports, no db,
 * so the service can copy it into its image the same way it copies
 * `schema.ts`.
 */

export const DAY_MS = 86_400_000;

/** A fresh non-jam post recruits for this long before the sweep closes it. */
export const POST_EXPIRY_DAYS = 45;
/** A jam-linked post outlives its jam by this — long enough to regroup,
 *  short enough that "crew for <finished jam>" doesn't haunt the board. */
export const JAM_POST_GRACE_DAYS = 3;
/** Reopening an expired/closed post buys this much. */
export const REOPEN_EXTENSION_DAYS = 30;
/** The owner's EXTEND button buys this much, from now. */
export const EXTEND_DAYS = 30;
/** "Closes in N days — still looking?" fires inside this window. */
export const EXPIRY_NUDGE_DAYS = 3;
/** A never-shipped team with no activity for this long gets warned. */
export const TEAM_QUIET_DAYS = 60;
/** Days between the archive warning and the archive itself. */
export const ARCHIVE_WARNING_DAYS = 7;

export function daysFromNow(days: number, now: Date = new Date()): Date {
  return new Date(now.getTime() + days * DAY_MS);
}

/**
 * The `expires_at` a newly created post gets. Jam-linked posts close
 * shortly after their jam does — unless the jam already ended (teams do
 * post retrospectively), where the jam-derived date would expire the
 * post at birth, so it falls back to the standard window.
 */
export function initialPostExpiry(
  jamEndsAt: Date | null | undefined,
  now: Date = new Date(),
): Date {
  if (jamEndsAt) {
    const graceEnd = new Date(jamEndsAt.getTime() + JAM_POST_GRACE_DAYS * DAY_MS);
    if (graceEnd.getTime() > now.getTime()) return graceEnd;
  }
  return daysFromNow(POST_EXPIRY_DAYS, now);
}
