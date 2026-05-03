import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { client } from "@/orpc/client";

import {
  bucketJamsByDay,
  type DayBuckets,
  jamMatchesSearch,
  jamPhase,
  type JamFromList,
} from "./helpers";

// The full calendar set lives at the page surface — we virtualize the
// timeline so mounting cost scales with viewport, not row count, and the
// upstream table is bounded to a few hundred rows in practice. Pull
// everything in one shot to avoid pagination chrome.
const LIST_LIMIT = 5000;

interface UseJamCalendarArgs {
  now: Date;
  search: string;
}

interface UseJamCalendarResult {
  isLoading: boolean;
  /** All jams returned by the API for this filter pass — already
   * narrowed by search, used by the day detail panel and timeline. */
  jams: JamFromList[];
  /** Pre-search total — drives the "X / Y JAMS" counter. */
  totalAll: number;
  /** Same set bucketed by UTC day for the calendar grid. */
  byDay: Map<string, DayBuckets>;
  /** Counts derived from the active jam set, broken out by phase. */
  stats: { upcoming: number; live: number; voting: number; archive: number };
}

/**
 * Single source of truth for the jam calendar page. Fetches the (live +
 * upcoming + recent) jam set once, then derives per-day buckets and the
 * hero stat tiles client-side.
 */
export function useJamCalendar({ now, search }: UseJamCalendarArgs): UseJamCalendarResult {
  const { data, isLoading } = useQuery({
    queryKey: ["list-jams", "all", "soonest", LIST_LIMIT],
    queryFn: () => client.listJams({ filter: "all", sortBy: "soonest", limit: LIST_LIMIT }),
    staleTime: 5 * 60 * 1000,
  });

  const all = data?.jams ?? [];

  const filtered = useMemo(() => all.filter((j) => jamMatchesSearch(j, search)), [all, search]);

  const byDay = useMemo(() => bucketJamsByDay(filtered), [filtered]);

  const stats = useMemo(() => {
    const s = { upcoming: 0, live: 0, voting: 0, archive: 0 };
    for (const jam of filtered) {
      const phase = jamPhase(jam, now);
      if (phase === "upcoming") s.upcoming += 1;
      else if (phase === "running") s.live += 1;
      else if (phase === "voting") s.voting += 1;
      else s.archive += 1;
    }
    return s;
  }, [filtered, now]);

  return { isLoading, jams: filtered, totalAll: all.length, byDay, stats };
}
