import { useNavigate, useRouterState } from "@tanstack/react-router";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";

import { DAY_MS } from "@/lib/format-time";
import useDateNow from "@/lib/hooks/use-date-now";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { useIsMobile } from "@/lib/hooks/use-mobile";

import { type BoardLayout, type BoardSort } from "./board/build-board";
import { addMonthsUTC, startOfMonthUTC, type ViewMode } from "./helpers";
import type { JamsPageContextValue } from "./shared-types";
import {
  type ArchiveQueryState,
  useArchiveJams,
  useBoardJams,
  useCalendarJams,
} from "./use-jam-data";

/** Each view is its own URL; the board is the section root because it's
 * the default landing surface. */
export const VIEW_PATHS = {
  board: "/jams",
  calendar: "/jams/calendar",
  archive: "/jams/archive",
} as const satisfies Record<ViewMode, string>;

/** The active view is a function of the URL, not component state — the
 * layout route needs it (for hero copy) before the child route renders. */
export function viewFromPathname(pathname: string): ViewMode {
  if (pathname.startsWith(VIEW_PATHS.calendar)) return "calendar";
  if (pathname.startsWith(VIEW_PATHS.archive)) return "archive";
  return "board";
}

const JamsPageContext = createContext<JamsPageContextValue | null>(null);

/**
 * Owns everything the jams section shares across its three routes: the
 * cross-view UI state (search, visible month, board display, archive
 * paging) and the per-view data fetches. It lives on the `/jams` layout
 * route, so switching views navigates without dropping the search box or
 * refetching the board.
 */
export function JamsPageProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const view = viewFromPathname(pathname);

  const isMobile = useIsMobile();
  const nowMs = useDateNow();
  const now = useMemo(() => new Date(nowMs), [nowMs]);
  // Only rebuild `today` when the UTC day actually rolls over, not on
  // every `now` tick — otherwise downstream components re-render every
  // second and lose stable identity.
  const todayDayBucket = Math.floor(nowMs / DAY_MS);
  const today = useMemo(() => {
    const d = new Date(todayDayBucket * DAY_MS);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }, [todayDayBucket]);

  const [search, setSearch] = useState("");
  const [boardSort, setBoardSort] = useState<BoardSort>("signal");
  const [boardLayout, setBoardLayoutState] = useState<BoardLayout>(readStoredLayout);
  const [monthStart, setMonthStart] = useState(() => startOfMonthUTC(today));
  const [archiveState, setArchiveStateRaw] = useState<Omit<ArchiveQueryState, "search">>({
    sortBy: "lastEvent",
    sortDir: "desc",
    page: 0,
  });

  // Archive search hits the server — debounce keystrokes so we don't
  // fire a query per character against a 19k-row table.
  const debouncedSearch = useDebouncedValue(search, 300);

  const board = useBoardJams(now, search);
  const calendar = useCalendarJams(search, view === "calendar");
  const archive = useArchiveJams({ ...archiveState, search: debouncedSearch }, view === "archive");

  // A new search should always show archive page 1.
  useEffect(() => {
    setArchiveStateRaw((s) => (s.page === 0 ? s : { ...s, page: 0 }));
  }, [debouncedSearch]);

  const setView = (next: ViewMode) => {
    void navigate({ to: VIEW_PATHS[next] });
  };

  const setBoardLayout = (next: BoardLayout) => {
    setBoardLayoutState(next);
    try {
      window.localStorage.setItem(LAYOUT_STORAGE_KEY, next);
    } catch {
      // Storage may be unavailable (private mode); the toggle still
      // works for the session.
    }
  };

  const value: JamsPageContextValue = {
    compact: isMobile,
    monthStart,
    today,
    now,
    board,
    calendar,
    archive,
    totalTracked: board.totalTracked,
    view,
    search,
    boardSort,
    boardLayout,
    archiveState: { ...archiveState, search: debouncedSearch },
    setMonth: (delta) => setMonthStart((m) => addMonthsUTC(m, delta)),
    setMonthAt: (month) => setMonthStart(startOfMonthUTC(month)),
    setView,
    setSearch,
    setBoardSort,
    setBoardLayout,
    setArchiveState: (patch) => setArchiveStateRaw((s) => ({ ...s, ...patch })),
  };

  return <JamsPageContext.Provider value={value}>{children}</JamsPageContext.Provider>;
}

export function useJamsPage(): JamsPageContextValue {
  const ctx = useContext(JamsPageContext);
  if (!ctx) throw new Error("useJamsPage must be used inside the /jams layout route");
  return ctx;
}

const LAYOUT_STORAGE_KEY = "jams-board-layout";

function readStoredLayout(): BoardLayout {
  if (typeof window === "undefined") return "cards";
  return window.localStorage.getItem(LAYOUT_STORAGE_KEY) === "list" ? "list" : "cards";
}
