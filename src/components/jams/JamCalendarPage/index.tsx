import { useEffect, useMemo, useState } from "react";

import { useIsTouchDevice } from "@/hooks/use-touch-device";
import useDateNow from "@/lib/hooks/use-date-now";

import { type BoardLayout, type BoardSort } from "./board/build-board";
import { addMonthsUTC, startOfMonthUTC, type ViewMode } from "./helpers";
import { JamCalendarDesktop } from "./JamCalendarDesktop";
import { JamCalendarMobile } from "./JamCalendarMobile";
import type { JamCalendarLayoutProps, StatKey } from "./shared-types";
import {
  type ArchiveQueryState,
  useArchiveJams,
  useBoardJams,
  useCalendarJams,
} from "./use-jam-data";

/**
 * Owns the jams page's UI state (view, search, visible month, archive
 * paging) and the per-view data fetches, then hands a bundle off to one
 * of two presentational layouts based on input device.
 */
export function JamCalendarPage() {
  const isTouch = useIsTouchDevice();
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

  // The board is the default view: most visitors are picking a jam to
  // join, and ranked shelves answer that; the calendar and archive are
  // the date-lookup and research lenses.
  const [view, setView] = useState<ViewMode>("board");
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

  // Shelf-jump from a stat tile: the board may not be mounted yet when
  // the tile is clicked (e.g. jumping from the archive view), so the
  // scroll runs in an effect once the target anchor exists in the DOM.
  const [pendingShelf, setPendingShelf] = useState<StatKey | null>(null);
  useEffect(() => {
    if (!pendingShelf || view !== "board" || board.isLoading) return;
    const el = document.getElementById(`shelf-${pendingShelf}`);
    if (el) {
      // Instant, not smooth: in-flight smooth scrolls get canceled by
      // other scroll writes in the app shell and silently go nowhere.
      el.scrollIntoView({ behavior: "instant", block: "start" });
      setPendingShelf(null);
    }
  }, [pendingShelf, view, board.isLoading]);

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

  const layoutProps: JamCalendarLayoutProps = {
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
  };

  return isTouch ? <JamCalendarMobile {...layoutProps} /> : <JamCalendarDesktop {...layoutProps} />;
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
