import { keepPreviousData, queryOptions, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { type HeroJam, heroJamSlides } from "@/components/home/hero-jam";
import { client } from "@/orpc/client";
import { STALE } from "@/orpc/public-procedures";

import { buildBoard } from "./board/build-board";
import {
  bucketJamsByDay,
  countShelves,
  type DayBuckets,
  jamMatchesSearch,
  type JamFromList,
  type JamHeroPin,
  type ShelfKind,
} from "./helpers";

// Backstops, not pagination: the board set is ~500 rows (every jam with
// a future event) and the calendar window ~4k. Both are ordered so that
// overflow would shed the least interesting rows first.
const BOARD_LIMIT = 2000;
const CALENDAR_LIMIT = 5000;

/** Jam data is scraped on a cadence measured in hours; five minutes of
 * staleness is free. */
export const JAM_STALE_MS = STALE.jam;

/**
 * The board fetch, shared verbatim by `useBoardJams`, the admin hero panel
 * and the `/jams` loader. All of them must land on the *same* query key so
 * they read one cache entry — a loader prefetch that missed the key would
 * silently double the work instead of saving any. They used to repeat the
 * config inline, which left nothing enforcing that.
 *
 * `/` no longer reads it: the landing page asks `homeJams` for the sixteen
 * jams it shows rather than tiering all ~560 in the browser.
 */
export function boardJamsQueryOptions() {
  return queryOptions({
    queryKey: ["list-jams", "board", BOARD_LIMIT],
    queryFn: () => client.listJams({ filter: "board", limit: BOARD_LIMIT }),
    staleTime: JAM_STALE_MS,
  });
}

function useBoardQuery() {
  return useQuery(boardJamsQueryOptions());
}

/** Staff hero picks. Its own query rather than a board field: the board sits
 * in a 5-minute edge cache, and a pin is a write its author checks at once. */
export function heroPinsQueryOptions() {
  return queryOptions({
    queryKey: ["jam-hero-pins"],
    queryFn: () => client.listJamHeroPins(),
    staleTime: STALE.listing,
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
  /** The hero rotation, priority first. */
  heroSlides: HeroJam[];
  /** The showcase band's jams — the featured tier topped up from the
   * ranked upcoming shelf, minus whatever the hero is already promoting. */
  showcaseJams: JamFromList[];
  liveCount: number;
  upcomingCount: number;
}

/**
 * The landing page's jam half. Its own procedure rather than the board
 * listing: `/` renders at most sixteen jams and two counts, and reading
 * the board for them put all ~560 rows in the home document ahead of its
 * content. The tiering runs on the server now — see `homeJams` in
 * `@/orpc/router/jam`.
 */
export function homeJamsQueryOptions() {
  return queryOptions({
    queryKey: ["home-jams"],
    queryFn: () => client.homeJams(),
    // The payload carries a staff hero pin, whose author reloads `/`
    // seconds after setting it — the pin tier, not the scrape tier.
    staleTime: STALE.listing,
  });
}

export function useHomeJams(): HomeJamsData {
  const { data, isLoading } = useQuery(homeJamsQueryOptions());
  return {
    isLoading,
    heroSlides: data?.heroSlides ?? EMPTY_SLIDES,
    showcaseJams: data?.showcaseJams ?? EMPTY_JAMS,
    liveCount: data?.liveCount ?? 0,
    upcomingCount: data?.upcomingCount ?? 0,
  };
}

/** Stable empties, so the memos downstream of them don't re-run per render. */
const EMPTY_SLIDES: HeroJam[] = [];
const EMPTY_JAMS: JamFromList[] = [];

/**
 * The hero rotation derived from a board payload, the way `homeJams` does
 * it server-side. The admin curation panel is the one caller left: it
 * needs the rotation *and* the board rows behind it, to show what is
 * queued and what aged out, so it reads both and re-derives rather than
 * asking `/`'s procedure for an answer it can't inspect.
 */
export function heroSlidesFrom(all: JamFromList[], now: Date, pins: JamHeroPin[] = []): HeroJam[] {
  const { featured } = buildBoard(all, now, "soonest");
  return heroJamSlides(featured, all, pins, now);
}

export interface CalendarData {
  isLoading: boolean;
  jams: JamFromList[];
  byDay: Map<string, DayBuckets>;
  totalAll: number;
}

export function calendarJamsQueryOptions() {
  return queryOptions({
    queryKey: ["list-jams", "calendar", CALENDAR_LIMIT],
    queryFn: () => client.listJams({ filter: "calendar", limit: CALENDAR_LIMIT }),
    staleTime: JAM_STALE_MS,
  });
}

/** The calendar view's wider window (active + trailing 12-month
 * archive), fetched only once the user actually opens the calendar. */
export function useCalendarJams(search: string, enabled: boolean): CalendarData {
  const { data, isLoading } = useQuery({ ...calendarJamsQueryOptions(), enabled });

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

export const DEFAULT_ARCHIVE_STATE: ArchiveQueryState = {
  search: "",
  sortBy: "lastEvent",
  sortDir: "desc",
  page: 0,
};

export function archiveJamsQueryOptions(state: ArchiveQueryState) {
  return queryOptions({
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
  });
}

/** Server-paginated archive: ~19k past jams, searched and sorted in the
 * database rather than shipped to the client. */
export function useArchiveJams(state: ArchiveQueryState, enabled: boolean): ArchiveData {
  const { data, isLoading, isFetching } = useQuery({
    ...archiveJamsQueryOptions(state),
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
