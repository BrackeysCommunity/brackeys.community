/**
 * App-wide jam presentation helpers. These were previously re-written in
 * each feature folder (`FeaturedJamCarousel/helpers.ts`,
 * `JamCalendarPage/helpers.ts`, the two home lists), which let the
 * fallback rules and timezone handling drift apart. One definition each.
 */

export function jamUrl(slug: string): string {
  return `https://itch.io/jam/${slug}`;
}

/**
 * Display name for a jam's host. Scraped jams frequently have no host
 * record at all; `"COMMUNITY"` is the house fallback for the label voice
 * used on cards and list rows. Pass `fallback` where a different voice is
 * wanted (the archive table renders an em dash in a data column).
 */
export function hostName(jam: { hosts: { name: string }[] }, fallback = "COMMUNITY"): string {
  return jam.hosts[0]?.name ?? fallback;
}

/**
 * Month label + day number for a jam date block, both in UTC.
 *
 * Jam scrape dates are stored and reasoned about in UTC everywhere else
 * (`dayKey`, `monthGridDays`, `JamArchiveTable`, `board/milestones`), but
 * the date blocks used to pair a *local* `toLocaleString` month with a
 * `getUTCDate()` day — so near a month boundary the label could name the
 * wrong month for the day beside it. Returning the pair from one place
 * makes that un-breakable.
 */
export function jamMonthDay(date: Date | string | null): { month: string; day: string } {
  if (!date) return { month: "TBA", day: "—" };
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return { month: "TBA", day: "—" };
  return {
    month: d.toLocaleString(undefined, { month: "short", timeZone: "UTC" }).toUpperCase(),
    day: String(d.getUTCDate()),
  };
}
