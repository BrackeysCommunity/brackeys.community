import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { useIsMobile } from "@/hooks/use-mobile";
import useDateNow from "@/lib/hooks/use-date-now";

import { type BoardLayout, type BoardSort } from "./board/build-board";
import { addMonthsUTC, startOfMonthUTC, type ViewMode } from "./helpers";
import type { JamsPageContextValue, StatKey } from "./shared-types";
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
  const todayDayBucket = Math.floor(nowMs / 86_400_000);
  const today = useMemo(() => {
    const d = new Date(todayDayBucket * 86_400_000);
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

  const stats = useMemo(
    () => ({
      upcoming: board.shelfCounts.upcoming,
      live: board.shelfCounts.live,
      voting: board.shelfCounts.voting,
      // Everything tracked that isn't on the board is history.
      archive: Math.max(0, board.totalTracked - board.totalAll),
    }),
    [board.shelfCounts, board.totalTracked, board.totalAll],
  );

  const setView = (next: ViewMode) => {
    void navigate({ to: VIEW_PATHS[next] });
  };

  // Shelf-jump from a stat tile. Clicking a tile from the calendar or
  // archive has to navigate first, and the router's view transition means
  // the board's shelves aren't in the DOM yet when the click is handled —
  // so the target is parked here and the board route performs the scroll
  // once it has actually mounted.
  const [pendingShelf, setPendingShelf] = useState<StatKey | null>(null);
  // Stable identity: the board's scroll effect depends on it, and `now`
  // re-renders this provider every second.
  const clearPendingShelf = useCallback(() => setPendingShelf(null), []);

  const onStatClick = (key: StatKey) => {
    if (key === "archive") {
      setView("archive");
      return;
    }
    setView("board");
    setPendingShelf(key);
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
    stats,
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
    onStatClick,
    pendingShelf,
    clearPendingShelf,
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

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}
