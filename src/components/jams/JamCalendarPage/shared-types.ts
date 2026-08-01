import type { BoardLayout, BoardSort } from "./board/build-board";
import type { ViewMode } from "./helpers";
import type { ArchiveData, ArchiveQueryState, BoardData, CalendarData } from "./use-jam-data";

export type StatKey = "upcoming" | "live" | "voting" | "archive";

/** Everything the `/jams` layout route shares with its view routes. The
 * provider (`jams-context.tsx`) owns the state; the board, calendar and
 * archive routes read out of it what they need. */
export interface JamsPageContextValue {
  /** Touch device — stacked hero stats and the denser calendar. */
  compact: boolean;

  // Time-window state
  monthStart: Date;
  today: Date;
  now: Date;

  // Data — one slice per view; calendar and archive fetch lazily.
  board: BoardData;
  calendar: CalendarData;
  archive: ArchiveData;

  // Hero stats (pre-search, world-state numbers)
  stats: Record<StatKey, number>;
  totalTracked: number;

  /** Active view, derived from the URL rather than held as state. */
  view: ViewMode;
  search: string;
  /** Board-only display state, owned here so the board's controls can
   * live in the shared toolbar rather than inside the board itself. */
  boardSort: BoardSort;
  boardLayout: BoardLayout;
  archiveState: ArchiveQueryState;

  // Setters
  setMonth: (delta: number) => void;
  setMonthAt: (month: Date) => void;
  /** Navigates to that view's route. */
  setView: (v: ViewMode) => void;
  setSearch: (q: string) => void;
  setBoardSort: (s: BoardSort) => void;
  setBoardLayout: (l: BoardLayout) => void;
  setArchiveState: (patch: Partial<ArchiveQueryState>) => void;
  /** Stat tile click — jumps to the matching shelf or the archive view. */
  onStatClick: (k: StatKey) => void;

  /** Shelf the board should scroll to once it mounts, parked here
   * because the click can happen on a different route. */
  pendingShelf: StatKey | null;
  clearPendingShelf: () => void;
}
