import type { effectiveJamState } from "@/lib/jam-countdown";

export type JamFromList = Awaited<
  ReturnType<typeof import("@/orpc/client").client.listJams>
>["jams"][number];

export type JamPhase = "upcoming" | "running" | "voting" | "archive";

export type ChipKind = "starting" | "deadline" | "ending";

export type ViewMode = "board" | "calendar" | "archive";

/** Board shelf a jam sorts into. `ongoing` catches perpetual pseudo-jams
 * (year-long "jams", newsletters, community hubs) that would otherwise
 * squat at the top of date-sorted views forever. */
export type ShelfKind = "live" | "upcoming" | "voting" | "ongoing";

/** Submission windows longer than this are communities, not events. */
export const ONGOING_DAYS = 90;

/** Jams below this signal collapse into the board's per-shelf tail —
 * ~85% of tracked jams have zero signal, and burying the shelf under
 * them is what made the old timeline unusable. */
export const SIGNAL_THRESHOLD = 10;

/**
 * Like `effectiveJamState` but also recognizes the post-deadline voting
 * window via `votingEndsAt`. The DB `status` column lags reality, so we
 * derive from dates instead.
 */
export function jamPhase(jam: JamFromList, now: Date): JamPhase {
  const t = now.getTime();
  const s = jam.startsAt ? new Date(jam.startsAt).getTime() : null;
  const e = jam.endsAt ? new Date(jam.endsAt).getTime() : null;
  const v = jam.votingEndsAt ? new Date(jam.votingEndsAt).getTime() : null;
  if (s != null && t < s) return "upcoming";
  if (e != null && t < e) return "running";
  if (v != null && t < v) return "voting";
  return "archive";
}

/** Wraps `effectiveJamState` so callers can stay typed off it. */
export type EffectiveState = ReturnType<typeof effectiveJamState>;

export function isOngoing(jam: JamFromList): boolean {
  if (!jam.startsAt) return false;
  // A started jam with no end date "runs" forever — same bucket.
  if (!jam.endsAt) return true;
  const days = (new Date(jam.endsAt).getTime() - new Date(jam.startsAt).getTime()) / 86_400_000;
  return days > ONGOING_DAYS;
}

export function jamShelf(jam: JamFromList, now: Date): ShelfKind | "archive" {
  if (isOngoing(jam)) return "ongoing";
  const phase = jamPhase(jam, now);
  if (phase === "upcoming") return "upcoming";
  if (phase === "running") return "live";
  if (phase === "voting") return "voting";
  return "archive";
}

/**
 * The participation metric that is actually meaningful for a jam's
 * phase: pre-deadline, `entriesCount` is definitionally ~0 and
 * `joinedCount` is the signal; once submissions close it inverts
 * (archive rows have entries but were never scraped for joined).
 */
export function jamSignal(jam: JamFromList, now: Date): { value: number; label: string } {
  const phase = jamPhase(jam, now);
  if (phase === "upcoming" || phase === "running") {
    return { value: jam.joinedCount ?? 0, label: "JOINED" };
  }
  return { value: jam.entriesCount ?? jam.joinedCount ?? 0, label: "ENTRIES" };
}

export interface Milestone {
  kind: ChipKind;
  date: Date;
  /** Short verb phrase for countdown headlines, e.g. "SUBMISSIONS CLOSE". */
  label: string;
}

/** The next milestone in a jam's lifecycle from `now`, or null once
 * everything is in the past. A jam without a voting window has its end
 * date as a full close — "ENDS", styled like a voting end (red ■), not
 * like a submission deadline (yellow ⊙). */
export function nextMilestone(jam: JamFromList, now: Date): Milestone | null {
  const t = now.getTime();
  const s = jam.startsAt ? new Date(jam.startsAt) : null;
  const e = jam.endsAt ? new Date(jam.endsAt) : null;
  const v = jam.votingEndsAt ? new Date(jam.votingEndsAt) : null;
  if (s && s.getTime() > t) return { kind: "starting", date: s, label: "STARTS" };
  if (e && e.getTime() > t) {
    return v
      ? { kind: "deadline", date: e, label: "SUBMISSIONS CLOSE" }
      : { kind: "ending", date: e, label: "ENDS" };
  }
  if (v && v.getTime() > t) return { kind: "ending", date: v, label: "VOTING ENDS" };
  return null;
}

/** YYYY-MM-DD key in UTC — used as a Map key for grouping events by day. */
export function dayKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function startOfMonthUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export function addMonthsUTC(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
}

/**
 * Six-row UTC grid starting on Sunday for the given month. Always 42 cells
 * so layout doesn't reflow between months.
 */
export function monthGridDays(monthStart: Date): Date[] {
  const firstDow = monthStart.getUTCDay(); // 0 = Sunday
  const start = new Date(monthStart);
  start.setUTCDate(1 - firstDow);
  return Array.from(
    { length: 42 },
    (_, i) =>
      new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + i)),
  );
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

export function isSameMonth(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth();
}

/**
 * Re-validates a scraped theme color before it is interpolated into an
 * inline `style` — the scraper already validates at ingest, but scraped
 * text never gets to reach a style attribute on trust.
 */
export function safeThemeColor(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const ok =
    /^#[0-9a-fA-F]{3}$/.test(raw) ||
    /^#[0-9a-fA-F]{6}$/.test(raw) ||
    /^#[0-9a-fA-F]{8}$/.test(raw) ||
    /^rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(,\s*[\d.]+\s*)?\)$/.test(raw);
  return ok ? raw : null;
}

/** Per-day index of which jams kick off, hit a submission deadline, or
 * close their voting window on each calendar date in the visible month. */
export interface DayBuckets {
  starting: JamFromList[];
  deadline: JamFromList[];
  ending: JamFromList[];
}

export function bucketJamsByDay(jams: JamFromList[]): Map<string, DayBuckets> {
  const out = new Map<string, DayBuckets>();
  const ensure = (key: string): DayBuckets => {
    let bucket = out.get(key);
    if (!bucket) {
      bucket = { starting: [], deadline: [], ending: [] };
      out.set(key, bucket);
    }
    return bucket;
  };
  for (const jam of jams) {
    if (jam.startsAt) ensure(dayKey(new Date(jam.startsAt))).starting.push(jam);
    if (jam.endsAt) ensure(dayKey(new Date(jam.endsAt))).deadline.push(jam);
    if (jam.votingEndsAt) ensure(dayKey(new Date(jam.votingEndsAt))).ending.push(jam);
  }
  return out;
}

export function jamMatchesSearch(jam: JamFromList, query: string): boolean {
  if (!query.trim()) return true;
  const q = query.trim().toLowerCase();
  if (jam.title.toLowerCase().includes(q)) return true;
  if (jam.hashtag?.toLowerCase().includes(q)) return true;
  return jam.hosts.some((h) => h.name.toLowerCase().includes(q));
}
