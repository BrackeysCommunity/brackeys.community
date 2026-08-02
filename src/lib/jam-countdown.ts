export function formatCountdown(target: Date | string | null | undefined, now: Date = new Date()) {
  if (!target) return null;
  const t = typeof target === "string" ? new Date(target) : target;
  const ms = t.getTime() - now.getTime();
  if (Number.isNaN(ms)) return null;
  return formatRelativeMs(ms);
}

/**
 * Decomposes a signed duration into the `1d 02h`/`03h 04m` house format.
 * The raw `d`/`h`/`m` parts come back alongside `text` so callers that
 * animate the numbers (`<CountUp>`) don't have to re-derive them.
 */
export function formatRelativeMs(ms: number) {
  const past = ms < 0;
  const abs = Math.abs(ms);
  const m = Math.floor(abs / 60_000) % 60;
  const h = Math.floor(abs / 3_600_000) % 24;
  const d = Math.floor(abs / 86_400_000);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0 || d > 0) parts.push(`${String(h).padStart(d > 0 ? 2 : 1, "0")}h`);
  if (d === 0) parts.push(`${String(m).padStart(2, "0")}m`);
  return { text: parts.join(" "), past, d, h, m };
}

export function formatJamShortDates(startsAt: Date | string | null, endsAt: Date | string | null) {
  if (!startsAt || !endsAt) return null;
  const s = typeof startsAt === "string" ? new Date(startsAt) : startsAt;
  const e = typeof endsAt === "string" ? new Date(endsAt) : endsAt;
  // UTC on both halves: the day numbers below are UTC, so a local month
  // label could name the wrong month for them near a boundary.
  const month = s.toLocaleString(undefined, { month: "short", timeZone: "UTC" });
  // Year matters: a jam running Sep 2026 → Sep 2027 is not a same-month
  // span, and collapsing it would render "Sep 11-21" for a year-long event.
  const sameMonth =
    s.getUTCMonth() === e.getUTCMonth() && s.getUTCFullYear() === e.getUTCFullYear();
  if (sameMonth) return `${month} ${s.getUTCDate()}-${e.getUTCDate()}`;
  const monthEnd = e.toLocaleString(undefined, { month: "short", timeZone: "UTC" });
  return `${month} ${s.getUTCDate()} – ${monthEnd} ${e.getUTCDate()}`;
}

/**
 * Effective jam state derived from `now` vs scrape dates. The DB `status`
 * column lags reality (the scraper updates on a cadence, and itch's status
 * field is occasionally stale), so anything time-sensitive should use this.
 */
export function effectiveJamState(
  startsAt: Date | string | null,
  endsAt: Date | string | null,
  now: Date = new Date(),
): "upcoming" | "running" | "ended" | "unknown" {
  const s = startsAt ? new Date(startsAt).getTime() : null;
  const e = endsAt ? new Date(endsAt).getTime() : null;
  const t = now.getTime();
  if (s == null && e == null) return "unknown";
  if (s != null && t < s) return "upcoming";
  if (e != null && t >= e) return "ended";
  return "running";
}

export function durationDays(startsAt: Date | string | null, endsAt: Date | string | null) {
  if (!startsAt || !endsAt) return null;
  const s = typeof startsAt === "string" ? new Date(startsAt).getTime() : startsAt.getTime();
  const e = typeof endsAt === "string" ? new Date(endsAt).getTime() : endsAt.getTime();
  const d = Math.max(0, Math.round((e - s) / 86_400_000));
  return `${d}d`;
}
