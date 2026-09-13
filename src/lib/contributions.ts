/**
 * The ACTIVITY graph's data model, once it stopped being "GitHub's
 * calendar" and became "every forge the member linked".
 *
 * Every source contributes a plain `{ "YYYY-MM-DD": n }` map — GitHub's
 * GraphQL calendar flattened, GitLab's `calendar.json` as it arrives — and
 * this merges them into one grid. A day's total is the sum, which is what
 * the heatmap's intensity reads; `bySource` keeps the split, which is what
 * gives the cell its colour and the tooltip its breakdown.
 *
 * Dates are plain UTC day strings end to end. Building the grid in local
 * time would move the whole calendar by a column for anyone west of UTC on
 * the wrong side of midnight.
 */

/** One forge behind the graph. `key` matches `linked_accounts.provider`. */
export interface ContributionSource {
  key: string;
  /** Legend text — "GITHUB", "GITLAB", "git.brackeys.dev". */
  label: string;
}

export interface ContributionDay {
  /** `YYYY-MM-DD`, UTC. */
  date: string;
  /** Sum across sources. */
  contributionCount: number;
  /** Per-source counts, keyed by `ContributionSource.key`; zeroes omitted. */
  bySource: Record<string, number>;
}

export interface ContributionWeek {
  contributionDays: ContributionDay[];
}

export interface ContributionCalendarData {
  weeks: ContributionWeek[];
  totalContributions: number;
  /** Only the sources that actually contributed inside the window — a
   *  legend entry with no dots under it is a lie about a linked account. */
  sources: ContributionSource[];
}

export type ContributionDayMap = Record<string, number>;

const DAY_MS = 86_400_000;
/** Today plus the 364 before it, then padded back to that week's Sunday. */
const WINDOW_DAYS = 365;

function utcMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** GitHub's calendar arrives pre-bucketed; the merge wants it flat. */
export function weeksToDayMap(
  weeks: Array<{ contributionDays: Array<{ date: string; contributionCount: number }> }>,
): ContributionDayMap {
  const days: ContributionDayMap = {};
  for (const week of weeks) {
    for (const day of week.contributionDays) {
      if (day.contributionCount > 0) days[day.date] = day.contributionCount;
    }
  }
  return days;
}

/**
 * One grid out of every source's day map. Columns are Sunday-started weeks
 * and the last one stops at `today`, which is the shape GitHub's own
 * calendar has and the grid renderer already assumes.
 */
export function buildContributionCalendar(
  inputs: Array<{ source: ContributionSource; days: ContributionDayMap }>,
  today: Date,
): ContributionCalendarData | null {
  if (inputs.length === 0) return null;

  const end = utcMidnight(today);
  const firstDay = new Date(end.getTime() - (WINDOW_DAYS - 1) * DAY_MS);
  // Back up to that week's Sunday so column 0 is a full week.
  const start = new Date(firstDay.getTime() - firstDay.getUTCDay() * DAY_MS);

  const weeks: ContributionWeek[] = [];
  const sourceTotals = new Map<string, number>();
  let totalContributions = 0;

  for (let weekStart = start.getTime(); weekStart <= end.getTime(); weekStart += 7 * DAY_MS) {
    const contributionDays: ContributionDay[] = [];
    for (let offset = 0; offset < 7; offset++) {
      const at = weekStart + offset * DAY_MS;
      if (at > end.getTime()) break;
      const date = isoDay(new Date(at));

      const bySource: Record<string, number> = {};
      let count = 0;
      for (const { source, days } of inputs) {
        const n = days[date];
        if (!n) continue;
        bySource[source.key] = n;
        count += n;
        sourceTotals.set(source.key, (sourceTotals.get(source.key) ?? 0) + n);
      }
      totalContributions += count;
      contributionDays.push({ date, contributionCount: count, bySource });
    }
    weeks.push({ contributionDays });
  }

  return {
    weeks,
    totalContributions,
    sources: inputs.map(({ source }) => source).filter((s) => (sourceTotals.get(s.key) ?? 0) > 0),
  };
}

/**
 * GitHub keeps `--primary`, so every profile that has only ever had a
 * GitHub link looks exactly as it did. The rest take these in the order the
 * server listed them — orange first, because gitlab.com's own brand is
 * orange and the pairing needs no explaining.
 */
const INSTANCE_HUES = [
  "var(--warning)",
  "var(--success)",
  // Teal, spelled out: the theme has no fourth categorical token, and the
  // chart ramp is five shades of one hue — useless for telling apart.
  "oklch(0.72 0.14 200)",
] as const;

export const GITHUB_SOURCE_KEY = "github";

/** A CSS colour per source, stable for a given `sources` order. */
export function assignSourceHues(sources: ContributionSource[]): Map<string, string> {
  const hues = new Map<string, string>();
  let next = 0;
  for (const source of sources) {
    if (source.key === GITHUB_SOURCE_KEY) {
      hues.set(source.key, "var(--primary)");
      continue;
    }
    hues.set(source.key, INSTANCE_HUES[next % INSTANCE_HUES.length] as string);
    next++;
  }
  return hues;
}

/** The alpha `bg-primary/NN` applied, now that the hue varies by source. */
export const INTENSITY_ALPHA = [0, 25, 50, 75, 100] as const;

type SourceHues = Map<string, string>;

export function intensityMix(hue: string, intensity: number): string {
  return `color-mix(in srgb, ${hue} ${INTENSITY_ALPHA[intensity]}%, transparent)`;
}

/**
 * A day's cell paints the sources that made it. One source is a flat fill;
 * two or more split the square diagonally, biggest contributor first, so a
 * mixed day reads as mixed at a glance and the tooltip carries the numbers.
 * Level 0 keeps the muted class — an empty day belongs to nobody.
 */
export function contributionCellStyle(
  day: ContributionDay,
  intensity: number,
  hues: SourceHues,
): { background: string } | undefined {
  if (intensity === 0) return undefined;
  const parts = Object.entries(day.bySource)
    .filter(([key]) => hues.has(key))
    .sort((a, b) => b[1] - a[1]);
  if (parts.length === 0) return undefined;
  if (parts.length === 1) {
    return { background: intensityMix(hues.get(parts[0][0])!, intensity) };
  }
  const [first, second] = parts;
  return {
    background: `linear-gradient(135deg, ${intensityMix(hues.get(first[0])!, intensity)} 0 50%, ${intensityMix(
      hues.get(second[0])!,
      intensity,
    )} 50% 100%)`,
  };
}

export function contributionTooltip(day: ContributionDay, sources: ContributionSource[]): string {
  const total = `${day.date}: ${day.contributionCount} contribution${
    day.contributionCount === 1 ? "" : "s"
  }`;
  if (sources.length < 2 || day.contributionCount === 0) return total;
  const split = sources
    .filter((source) => (day.bySource[source.key] ?? 0) > 0)
    .map((source) => `${day.bySource[source.key]} ${source.label}`);
  return split.length > 1 ? `${total} — ${split.join(", ")}` : total;
}
