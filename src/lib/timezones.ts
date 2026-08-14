/**
 * IANA-timezone helpers shared by the profile editor, the member
 * directory's "within ±Nh of me" facet, and everything that renders a
 * timezone.
 *
 * Profiles store the IANA *name*; every offset here is derived at call
 * time via `Intl`, because a stored offset goes stale at each DST
 * transition. And per the jam-dates rule in CLAUDE.md: surfaces render
 * these *offsets* — nobody does local-time math in cells.
 */

/** True when `Intl` accepts the name as a timezone. */
export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * The zone's current UTC offset in minutes (positive east of UTC), or
 * null for a name `Intl` rejects. "Current" matters: Madrid is +60 in
 * January and +120 in July.
 */
export function currentOffsetMinutes(tz: string, at: Date = new Date()): number | null {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "longOffset",
    }).formatToParts(at);
  } catch {
    return null;
  }
  const name = parts.find((p) => p.type === "timeZoneName")?.value;
  if (!name) return null;
  // "GMT" for UTC itself, otherwise "GMT±HH:MM".
  if (name === "GMT" || name === "UTC") return 0;
  const m = name.match(/GMT([+-])(\d{1,2}):?(\d{2})?/);
  if (!m) return null;
  const sign = m[1] === "-" ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3] ?? 0));
}

/** "UTC+5:30" / "UTC-4" / "UTC±0" — the display form for an offset. */
export function formatUtcOffset(minutes: number): string {
  if (minutes === 0) return "UTC±0";
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `UTC${sign}${h}${m > 0 ? `:${String(m).padStart(2, "0")}` : ""}`;
}

/** "UTC+2" for a zone name, or null when the name doesn't resolve. */
export function timezoneOffsetLabel(tz: string, at: Date = new Date()): string | null {
  const minutes = currentOffsetMinutes(tz, at);
  return minutes === null ? null : formatUtcOffset(minutes);
}

/** Every IANA name this runtime knows. ~430 entries, stable per process. */
export function allTimezones(): string[] {
  return Intl.supportedValuesOf("timeZone");
}

/**
 * The IANA names whose *current* offset falls within `rangeMinutes` of
 * `centerMinutes` — the server side of "within ±3h of me". Enumerating
 * names in JS keeps the SQL an index-friendly `IN` list instead of a
 * per-row join against `pg_timezone_names`. Coarse by design: the
 * wraparound pair (UTC+13 vs UTC-11) is treated as 24h apart, which is
 * the honest answer for "when are we both awake".
 */
export function timezonesWithinOffset(
  centerMinutes: number,
  rangeMinutes: number,
  at: Date = new Date(),
): string[] {
  return allTimezones().filter((tz) => {
    const offset = currentOffsetMinutes(tz, at);
    return offset !== null && Math.abs(offset - centerMinutes) <= rangeMinutes;
  });
}

/** The browser's own zone — the profile editor's default suggestion. */
export function browserTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    return null;
  }
}
