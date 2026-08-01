import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { client } from "@/orpc/client";

import {
  bucketJamsByDay,
  type DayBuckets,
  jamMatchesSearch,
  jamShelf,
  type JamFromList,
  type ShelfKind,
} from "./helpers";

// Backstops, not pagination: the board set is ~500 rows (every jam with
// a future event) and the calendar window ~4k. Both are ordered so that
// overflow would shed the least interesting rows first.
const BOARD_LIMIT = 2000;
const CALENDAR_LIMIT = 5000;

export interface BoardData {
  isLoading: boolean;
  /** Board jams narrowed by search. */
  jams: JamFromList[];
  /** Pre-search shelf counts — drives the hero stat tiles, which should
   * report the state of the world, not of the current query. */
  shelfCounts: Record<ShelfKind, number>;
  totalAll: number;
  totalTracked: number;
}

/** The discovery board's working set: every jam with a future event. */
export function useBoardJams(now: Date, search: string): BoardData {
  const { data, isLoading } = useQuery({
    queryKey: ["list-jams", "board", BOARD_LIMIT],
    queryFn: () => client.listJams({ filter: "board", limit: BOARD_LIMIT }),
    staleTime: 5 * 60 * 1000,
  });

  const all = useMemo(() => data?.jams ?? [], [data]);
  const jams = useMemo(() => all.filter((j) => jamMatchesSearch(j, search)), [all, search]);

  const shelfCounts = useMemo(() => {
    const counts: Record<ShelfKind, number> = { live: 0, upcoming: 0, voting: 0, ongoing: 0 };
    for (const jam of all) {
      const shelf = jamShelf(jam, now);
      if (shelf !== "archive") counts[shelf] += 1;
    }
    return counts;
  }, [all, now]);

  return {
    isLoading,
    jams,
    shelfCounts,
    totalAll: all.length,
    totalTracked: data?.trackedTotal ?? all.length,
  };
}

export interface CalendarData {
  isLoading: boolean;
  jams: JamFromList[];
  byDay: Map<string, DayBuckets>;
  totalAll: number;
}

/** The calendar view's wider window (active + trailing 12-month
 * archive), fetched only once the user actually opens the calendar. */
export function useCalendarJams(search: string, enabled: boolean): CalendarData {
  const { data, isLoading } = useQuery({
    queryKey: ["list-jams", "calendar", CALENDAR_LIMIT],
    queryFn: () => client.listJams({ filter: "calendar", limit: CALENDAR_LIMIT }),
    staleTime: 5 * 60 * 1000,
    enabled,
  });

  const all = useMemo(() => data?.jams ?? [], [data]);
  const jams = useMemo(() => all.filter((j) => jamMatchesSearch(j, search)), [all, search]);
  const byDay = useMemo(() => bucketJamsByDay(jams), [jams]);

  return { isLoading, jams, byDay, totalAll: all.length };
}

export type ArchiveSortKey = "lastEvent" | "entries" | "ratings" | "duration" | "title";

export interface ArchiveQueryState {
  search: string;
  sortBy: ArchiveSortKey;
  sortDir: "asc" | "desc";
  page: number;
}

export const ARCHIVE_PAGE_SIZE = 25;

export interface ArchiveData {
  isLoading: boolean;
  /** True while a new page/sort/search is in flight but stale rows are
   * still displayed (keepPreviousData). */
  isFetching: boolean;
  jams: JamFromList[];
  total: number;
}

/** Server-paginated archive: ~19k past jams, searched and sorted in the
 * database rather than shipped to the client. */
export function useArchiveJams(state: ArchiveQueryState, enabled: boolean): ArchiveData {
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["archive-jams", state.search, state.sortBy, state.sortDir, state.page],
    queryFn: () =>
      client.archiveJams({
        search: state.search,
        sortBy: state.sortBy,
        sortDir: state.sortDir,
        page: state.page,
        pageSize: ARCHIVE_PAGE_SIZE,
      }),
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
    enabled,
  });

  return {
    isLoading,
    isFetching,
    jams: (data?.jams ?? []) as JamFromList[],
    total: data?.total ?? 0,
  };
}
