import type { JamListSurface } from "@/lib/event-taxonomy";

import type { BoardSort } from "./board/build-board";
import { startOfMonthUTC, type ViewMode } from "./helpers";
import { DEFAULT_ARCHIVE_STATE, type ArchiveData, type ArchiveQueryState } from "./use-jam-data";

/**
 * What the active jam view should report as a `jam_list_filtered`, or `null`
 * on a view whose data has not settled.
 *
 * Pure, and deliberately apart from the provider: which controls count as
 * narrowing is the judgement this event stands on, and it should be readable
 * and testable without a React tree.
 *
 * The three surfaces share one search box (the provider owns it across view
 * switches), so the query travels with the visitor from the board to the
 * archive — which is the behaviour, not a bug to report around.
 */
export interface JamListReport {
  surface: JamListSurface;
  query: string;
  filterKinds: string[];
  /** `null` while the current input's results are still loading — the hook
   *  holds the event until there is a real number to put on it. */
  resultCount: number | null;
}

export interface JamListReportInput {
  view: ViewMode;
  search: string;
  boardSort: BoardSort;
  monthStart: Date;
  today: Date;
  archiveState: ArchiveQueryState;
  board: { isLoading: boolean; jams: unknown[] };
  calendar: { isLoading: boolean; jams: unknown[] };
  archive: Pick<ArchiveData, "isLoading" | "total">;
}

export function jamListReport(input: JamListReportInput): JamListReport {
  const { view, search } = input;

  if (view === "board") {
    return {
      surface: "jams_board",
      query: search,
      filterKinds: boardFilterKinds(input.boardSort),
      resultCount: input.board.isLoading ? null : input.board.jams.length,
    };
  }

  if (view === "calendar") {
    return {
      surface: "jams_calendar",
      query: search,
      filterKinds: calendarFilterKinds(input.monthStart, input.today),
      resultCount: input.calendar.isLoading ? null : input.calendar.jams.length,
    };
  }

  return {
    surface: "jams_archive",
    query: search,
    filterKinds: archiveFilterKinds(input.archiveState),
    // The server's total for the search, not the 25 rows of the current
    // page — "how much is there" is the question a zero-result check asks.
    resultCount: input.archive.isLoading ? null : input.archive.total,
  };
}

/** Layout (cards vs list) is absent on purpose: it changes how the same jams
 *  are drawn and narrows nothing. */
export function boardFilterKinds(boardSort: BoardSort): string[] {
  return boardSort === "signal" ? [] : ["sort"];
}

/** The visible month is the calendar's only narrowing control, and the
 *  current month is where every arrival starts. */
export function calendarFilterKinds(monthStart: Date, today: Date): string[] {
  return monthStart.getTime() === startOfMonthUTC(today).getTime() ? [] : ["month"];
}

export function archiveFilterKinds(state: ArchiveQueryState): string[] {
  const kinds: string[] = [];
  if (
    state.sortBy !== DEFAULT_ARCHIVE_STATE.sortBy ||
    state.sortDir !== DEFAULT_ARCHIVE_STATE.sortDir
  ) {
    kinds.push("sort");
  }
  if (state.page !== DEFAULT_ARCHIVE_STATE.page) kinds.push("page");
  return kinds;
}
