export function formatCountdown(target: Date | string | null | undefined, now: Date = new Date()) {
  if (!target) return null;
  const t = typeof target === "string" ? new Date(target) : target;
  const ms = t.getTime() - now.getTime();
  if (Number.isNaN(ms)) return null;
  return formatRelativeMs(ms);
}

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
  return { text: parts.join(" "), past };
}

export function formatJamShortDates(startsAt: Date | string | null, endsAt: Date | string | null) {
  if (!startsAt || !endsAt) return null;
  const s = typeof startsAt === "string" ? new Date(startsAt) : startsAt;
  const e = typeof endsAt === "string" ? new Date(endsAt) : endsAt;
  const month = s.toLocaleString(undefined, { month: "short" });
  const sameMonth = s.getUTCMonth() === e.getUTCMonth();
  if (sameMonth) return `${month} ${s.getUTCDate()}-${e.getUTCDate()}`;
  const monthEnd = e.toLocaleString(undefined, { month: "short" });
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
