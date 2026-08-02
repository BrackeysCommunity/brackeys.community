import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { client } from "@/orpc/client";

import { buildBoard } from "./board/build-board";
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

/** Jam data is scraped on a cadence measured in hours; five minutes of
 * staleness is free. */
export const JAM_STALE_MS = 5 * 60 * 1000;

/**
 * The board fetch, shared verbatim by `useBoardJams` and `useHomeJams`.
 * Both must land on the *same* query key so the home page and the jam
 * board read one cache entry — routing between them should never refetch.
 * They used to repeat the config inline, which left nothing enforcing that.
 */
function useBoardQuery() {
  return useQuery({
    queryKey: ["list-jams", "board", BOARD_LIMIT],
    queryFn: () => client.listJams({ filter: "board", limit: BOARD_LIMIT }),
    staleTime: JAM_STALE_MS,
  });
}

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

function countShelves(jams: JamFromList[], now: Date): Record<ShelfKind, number> {
  const counts: Record<ShelfKind, number> = { live: 0, upcoming: 0, voting: 0, ongoing: 0 };
  for (const jam of jams) {
    const shelf = jamShelf(jam, now);
    if (shelf !== "archive") counts[shelf] += 1;
  }
  return counts;
}

/** The discovery board's working set: every jam with a future event. */
export function useBoardJams(now: Date, search: string): BoardData {
  const { data, isLoading } = useBoardQuery();

  const all = useMemo(() => data?.jams ?? [], [data]);
  const jams = useMemo(() => all.filter((j) => jamMatchesSearch(j, search)), [all, search]);

  const shelfCounts = useMemo(() => countShelves(all, now), [all, now]);

  return {
    isLoading,
    jams,
    shelfCounts,
    totalAll: all.length,
    totalTracked: data?.trackedTotal ?? all.length,
  };
}

export interface HomeJamsData {
  isLoading: boolean;
  /** The board's featured tier — signal-ranked live + upcoming, Brackeys
   * jams force-included. Drives the home carousel. */
  featured: JamFromList[];
  /** The board's ranked upcoming shelf (signal ≥ threshold, featured and
   * perpetual pseudo-jams excluded), soonest first. */
  upcoming: JamFromList[];
  liveCount: number;
  upcomingCount: number;
}

/**
 * The home page's § JAMS section. Shares the board query (same key) so
 * the landing section promotes exactly what the jam board's featured
 * rail and upcoming shelf show, instead of a raw soonest-first list
 * that surfaces zero-signal jams.
 */
export function useHomeJams(now: number): HomeJamsData {
  const { data, isLoading } = useBoardQuery();

  const all = useMemo(() => data?.jams ?? [], [data]);
  return useMemo(() => {
    const nowDate = new Date(now);
    const { featured, shelves } = buildBoard(all, nowDate, "soonest");
    const counts = countShelves(all, nowDate);
    return {
      isLoading,
      featured,
      upcoming: shelves.upcoming.ranked,
      liveCount: counts.live,
      upcomingCount: counts.upcoming,
    };
  }, [all, now, isLoading]);
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
    staleTime: JAM_STALE_MS,
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
    staleTime: JAM_STALE_MS,
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
