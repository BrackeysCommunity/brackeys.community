/**
 * Shared constants for the jam-watch notification pass. Lives in `src/lib`
 * rather than inside the sweep service because the service imports app
 * modules by relative path (same arrangement as `collab-lifecycle.ts`), and
 * a reminder window the app can't read is one the app can't explain to a
 * member in copy.
 */

/**
 * How far ahead of a jam's start its watchers get told.
 *
 * This is a detection *window*, not a delay: the sweep fires for jams whose
 * start is between now and now + this. A run interval longer than the window
 * means a jam can pass through it untouched between two ticks and never be
 * announced at all — the stamp stays null and nothing retries. So this must
 * stay comfortably above the lifecycle-sweep's cron interval (6h today, in
 * `services/lifecycle-sweep/railway.toml`). Lowering it toward that interval
 * starts dropping reminders silently; raising it is always safe.
 */
export const JAM_START_NOTICE_HOURS = 48;
export const JAM_START_NOTICE_MS = JAM_START_NOTICE_HOURS * 60 * 60 * 1000;
