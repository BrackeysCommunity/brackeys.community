/**
 * A ban is over when staff lift it (`unbannedAt`) or it runs out (`bannedUntil`,
 * null being permanent). The row keeps every field either way, as the history.
 */
export type BanFields = {
  bannedAt?: Date | string | null;
  bannedUntil?: Date | string | null;
  unbannedAt?: Date | string | null;
};

function at(value: Date | string | null | undefined): number | null {
  if (value == null) return null;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** Whether the ban on this identity row is in force right now. */
export function isActiveBan(fields: BanFields, now: number = Date.now()): boolean {
  if (at(fields.bannedAt) == null) return false;
  if (at(fields.unbannedAt) != null) return false;
  const until = at(fields.bannedUntil);
  return until == null || until > now;
}

/** Here rather than in the router so the admin UI doesn't import the server. */
export const BAN_DURATIONS: { days: number | null; label: string }[] = [
  { days: 1, label: "1 day" },
  { days: 3, label: "3 days" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: null, label: "Permanent" },
];
