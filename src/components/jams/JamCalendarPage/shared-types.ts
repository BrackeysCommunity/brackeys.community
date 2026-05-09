import type { ChipKind, DayBuckets, JamFromList, ViewMode } from "./helpers";

export type TimelineRange = "upcoming" | "all";

/** Common shape that desktop + mobile layouts both consume. The
 * orchestrator (`index.tsx`) owns the state and passes this bundle in. */
export interface JamCalendarLayoutProps {
  // Time-window state
  monthStart: Date;
  today: Date;
  selectedDay: Date;
  now: Date;

  // Data
  isLoading: boolean;
  jams: JamFromList[];
  byDay: Map<string, DayBuckets>;
  stats: { upcoming: number; live: number; voting: number; archive: number };
  totalShown: number;
  totalAll: number;

  // UI state
  view: ViewMode;
  search: string;
  visibleChips: Record<ChipKind, boolean>;
  timelineRange: TimelineRange;

  // Setters
  setMonth: (delta: number) => void;
  setMonthAt: (month: Date) => void;
  setSelectedDay: (day: Date) => void;
  setView: (v: ViewMode) => void;
  setSearch: (q: string) => void;
  toggleChip: (k: ChipKind) => void;
  setTimelineRange: (r: TimelineRange) => void;
}
