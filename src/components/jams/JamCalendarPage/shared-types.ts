import type { BoardLayout, BoardSort } from "./board/build-board";
import type { ViewMode } from "./helpers";
import type { ArchiveData, ArchiveQueryState, BoardData, CalendarData } from "./use-jam-data";

export type StatKey = "upcoming" | "live" | "voting" | "archive";

/** Common shape that desktop + mobile layouts both consume. The
 * orchestrator (`index.tsx`) owns the state and passes this bundle in. */
export interface JamCalendarLayoutProps {
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

  // UI state
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
  setView: (v: ViewMode) => void;
  setSearch: (q: string) => void;
  setBoardSort: (s: BoardSort) => void;
  setBoardLayout: (l: BoardLayout) => void;
  setArchiveState: (patch: Partial<ArchiveQueryState>) => void;
  /** Stat tile click — jumps to the matching shelf or the archive view. */
  onStatClick: (k: StatKey) => void;
}
