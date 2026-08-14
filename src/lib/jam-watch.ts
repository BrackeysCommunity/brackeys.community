/**
 * Shared constants for the jam-watch notification pass. Lives in `src/lib`
 * rather than inside the sweep service because the service imports app
 * modules by relative path (same arrangement as `collab-lifecycle.ts`), and
 * a reminder window the app can't read is one the app can't explain to a
 * member in copy.
 */

/** How far ahead of a jam's start its watchers get told. */
export const JAM_START_NOTICE_HOURS = 48;
export const JAM_START_NOTICE_MS = JAM_START_NOTICE_HOURS * 60 * 60 * 1000;
