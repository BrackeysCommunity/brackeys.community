import type { effectiveJamState } from "@/lib/jam-countdown";

export type JamFromList = Awaited<
  ReturnType<typeof import("@/orpc/client").client.listJams>
>["jams"][number];

export type JamPhase = "upcoming" | "running" | "voting" | "archive";

export type ChipKind = "starting" | "deadline" | "ending";

export type ViewMode = "calendar" | "timeline";

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

export function jamUrl(slug: string): string {
  return `https://itch.io/jam/${slug}`;
}

/**
 * Deterministic two-color palette pick keyed by jam id. Both the
 * timeline row's Grainient backdrop and the spotlight modal's banner
 * call this so a jam without an image keeps the same colorway across
 * the shared-layout morph (a random pick would re-roll on the modal
 * mount and cross-fade through a different palette mid-animation).
 */
export function jamPaletteColors(palette: string[], jamId: number): [string, string] {
  if (palette.length === 0) return ["#444444", "#222222"];
  if (palette.length === 1) return [palette[0]!, palette[0]!];
  const a = Math.abs(jamId) % palette.length;
  let b = Math.abs(jamId * 1103515245 + 12345) % palette.length;
  if (b === a) b = (b + 1) % palette.length;
  return [palette[a]!, palette[b]!];
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

/** Used by the timeline view to group rows by month. */
export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(yearMonth: string): { month: string; year: string } {
  const [y, m] = yearMonth.split("-");
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, 1));
  return {
    month: date.toLocaleString(undefined, { month: "long", timeZone: "UTC" }).toUpperCase(),
    year: y!,
  };
}
