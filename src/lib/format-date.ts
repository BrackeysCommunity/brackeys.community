/**
 * The locale every formatter in the app pins to.
 *
 * A bare `toLocaleDateString()` / `toLocaleString()` resolves against the
 * runtime: the server's locale during SSR, the visitor's on hydration.
 * React answers the difference by discarding the hydrated tree — BC-207's
 * text mismatches clustered almost entirely on visitors whose browser
 * reported en-GB, fr-FR, he-IL or cs. The app's copy is English throughout,
 * so the numbers and month names follow it rather than the runtime.
 */
export const APP_LOCALE = "en-US";

/**
 * A calendar date, locale and time zone both pinned.
 *
 * The time zone is the second half of the same problem: the server runs in
 * UTC and the visitor doesn't, so a date near midnight renders a different
 * day on each side even with the locale settled. UTC everywhere is what the
 * rest of the app already does with dates.
 *
 * Jam dates have their own wrapper — `jamDate` in `@/lib/jam-links` — which
 * pins the same two for the same reason.
 */
export function formatDate(
  date: Date | string,
  options: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric" },
): string {
  return new Date(date).toLocaleDateString(APP_LOCALE, { ...options, timeZone: "UTC" });
}
