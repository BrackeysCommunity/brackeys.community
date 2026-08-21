import {
  type JamFromList,
  jamShelf,
  jamSignal,
  nextMilestone,
  type ShelfKind,
  SIGNAL_THRESHOLD,
} from "../helpers";

/** Board-wide ordering: by participation, or by whichever milestone
 * hits next (deadline for live jams, start for upcoming, …). */
export type BoardSort = "signal" | "soonest";

/** How each shelf renders its jams. Cards are the default richer
 * browse; the list is the denser scanning mode. */
export type BoardLayout = "cards" | "list";

/** The featured tier rotates through the board's sticky jam panel one
 * slide at a time, so it can afford more slots than the old 4-up grid. */
export const FEATURED_MAX = 10;

export interface BuiltShelf {
  /** Above the signal threshold — always visible. */
  ranked: JamFromList[];
  /** The long tail, hidden behind the expander. */
  tail: JamFromList[];
}

export function buildBoard(jams: JamFromList[], now: Date, sort: BoardSort) {
  const byShelf: Record<ShelfKind, JamFromList[]> = {
    live: [],
    upcoming: [],
    voting: [],
    ongoing: [],
  };
  for (const jam of jams) {
    const shelf = jamShelf(jam, now);
    if (shelf !== "archive") byShelf[shelf].push(jam);
  }

  const milestoneTime = (j: JamFromList) => nextMilestone(j, now)?.date.getTime() ?? Infinity;
  const bySignalDesc = (a: JamFromList, b: JamFromList) => {
    const diff = jamSignal(b, now).value - jamSignal(a, now).value;
    // Signal tie (usually both 0): sooner next milestone first.
    return diff !== 0 ? diff : milestoneTime(a) - milestoneTime(b);
  };
  const byMilestoneAsc = (a: JamFromList, b: JamFromList) => {
    const diff = milestoneTime(a) - milestoneTime(b);
    return diff !== 0 ? diff : jamSignal(b, now).value - jamSignal(a, now).value;
  };
  const activeSort = sort === "soonest" ? byMilestoneAsc : bySignalDesc;
  for (const list of Object.values(byShelf)) list.sort(activeSort);

  // Featured tier: the top of live + upcoming by joined count, with any
  // Brackeys-hosted jam force-included — this page is Brackeys' own.
  const candidates = [...byShelf.live, ...byShelf.upcoming].sort(bySignalDesc);
  const brackeys = candidates.filter(isBrackeysJam);
  const featured: JamFromList[] = [...brackeys];
  for (const jam of candidates) {
    if (featured.length >= FEATURED_MAX) break;
    if (!featured.includes(jam) && jamSignal(jam, now).value >= SIGNAL_THRESHOLD) {
      featured.push(jam);
    }
  }
  const featuredIds = new Set(featured.map((j) => j.jamId));

  const shelves = {} as Record<ShelfKind, BuiltShelf>;
  for (const kind of ["live", "upcoming", "voting", "ongoing"] as ShelfKind[]) {
    const list = byShelf[kind].filter((j) => !featuredIds.has(j.jamId));
    // Perpetual jams are all tail: they have no milestone urgency and
    // mostly exist to be findable, not promoted.
    if (kind === "ongoing") {
      shelves[kind] = { ranked: [], tail: list };
      continue;
    }
    shelves[kind] = {
      ranked: list.filter((j) => jamSignal(j, now).value >= SIGNAL_THRESHOLD),
      tail: list.filter((j) => jamSignal(j, now).value < SIGNAL_THRESHOLD),
    };
  }

  return { featured, shelves };
}

export function isBrackeysJam(jam: JamFromList): boolean {
  const needle = /brackeys/i;
  return (
    needle.test(jam.slug) || needle.test(jam.title) || jam.hosts.some((h) => needle.test(h.name))
  );
}
