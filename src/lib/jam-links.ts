/**
 * App-wide jam presentation helpers. These were previously re-written in
 * each feature folder (`JamCalendarPage/helpers.ts`, the home jam
 * surfaces), which let the fallback rules and timezone handling drift
 * apart. One definition each.
 */

/**
 * The jam's page **on itch.io**. In-app navigation wants
 * `jamLinkParams` instead — this stays for the explicit "VIEW ON
 * ITCH.IO" affordances.
 */
export function jamUrl(slug: string): string {
  return `https://itch.io/jam/${slug}`;
}

/**
 * How a jam turns into a `/jams/$jamSlug` link. Mirrors
 * `profile-links.ts` / `team-links.ts`, which exist for the same reason.
 * `getJam` resolves either form of the segment server-side.
 */
interface JamLinkTarget {
  jamId: number;
  slug?: string | null;
}

/** The `$jamSlug` path segment for a jam. */
export function jamSlug(jam: JamLinkTarget): string {
  // `||` not `??`: an empty slug is not a handle. Scraped rows always
  // carry one (it's NOT NULL), so the id fallback only covers callers
  // holding a partial row — e.g. a jam reached through a LEFT JOIN.
  return jam.slug || String(jam.jamId);
}

/** Route params object for TanStack Router's `to="/jams/$jamSlug"`. */
export function jamLinkParams(jam: JamLinkTarget) {
  return { jamSlug: jamSlug(jam) };
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

/**
 * Format a jam date with `timeZone: "UTC"` pinned — the exact hazard the
 * Dates rule warns about (a local month label beside a `getUTCDate()` day
 * renders the wrong month near a boundary), made structural: going through
 * this wrapper means the UTC option can't be forgotten.
 */
export function jamDate(
  date: Date | string,
  options: Intl.DateTimeFormatOptions,
  locale?: string,
): string {
  return new Date(date).toLocaleString(locale, { ...options, timeZone: "UTC" });
}

/** "Feb 14" (or "Feb 14, 2026" with `year`) — milestone rows, table cells. */
export function jamDateShort(
  date: Date | string,
  { year = false }: { year?: boolean } = {},
): string {
  return jamDate(date, { month: "short", day: "numeric", ...(year && { year: "numeric" }) });
}

/** "14 Feb 2026" — the day-first long form used in prose and OG cards. */
export function jamDateLong(date: Date | string): string {
  return jamDate(date, { day: "numeric", month: "short", year: "numeric" }, "en-GB");
}

/** "14 Feb 2026 – 23 Feb 2026", degrading to "Starts …" / "Ends …". */
export function jamDateRange(
  startsAt: Date | string | null,
  endsAt: Date | string | null,
): string | null {
  if (startsAt && endsAt) return `${jamDateLong(startsAt)} – ${jamDateLong(endsAt)}`;
  if (startsAt) return `Starts ${jamDateLong(startsAt)}`;
  if (endsAt) return `Ends ${jamDateLong(endsAt)}`;
  return null;
}
