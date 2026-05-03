import { useMemo, useState } from "react";

import { useIsTouchDevice } from "@/hooks/use-touch-device";
import useDateNow from "@/lib/hooks/use-date-now";

import { addMonthsUTC, type ChipKind, startOfMonthUTC, type ViewMode } from "./helpers";
import { JamCalendarDesktop } from "./JamCalendarDesktop";
import { JamCalendarMobile } from "./JamCalendarMobile";
import type { JamCalendarLayoutProps, TimelineRange } from "./shared-types";
import { useJamCalendar } from "./use-jam-calendar";

/**
 * Owns the calendar's UI state (selected day, visible month, view mode,
 * chip visibility, search) and the data fetch, then hands a bundle off
 * to one of two presentational layouts based on input device.
 */
export function JamCalendarPage() {
  const isTouch = useIsTouchDevice();
  const nowMs = useDateNow();
  const now = useMemo(() => new Date(nowMs), [nowMs]);
  // Only rebuild `today` when the UTC day actually rolls over, not on
  // every `now` tick — otherwise downstream components (calendar grid,
  // motion-driven modal) re-render every second and lose stable
  // identity / interrupt in-flight layout animations.
  const todayDayBucket = Math.floor(nowMs / 86_400_000);
  const today = useMemo(() => {
    const d = new Date(todayDayBucket * 86_400_000);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }, [todayDayBucket]);

  const [monthStart, setMonthStart] = useState(() => startOfMonthUTC(today));
  const [selectedDay, setSelectedDay] = useState<Date>(today);
  // Timeline is the default view — most users land here looking for
  // "what's coming up", and the calendar's grid is more useful as the
  // alternate "browse a specific date" affordance.
  const [view, setView] = useState<ViewMode>("timeline");
  const [search, setSearch] = useState("");
  const [timelineRange, setTimelineRange] = useState<TimelineRange>("upcoming");
  const [visibleChips, setVisibleChips] = useState<Record<ChipKind, boolean>>({
    starting: true,
    deadline: true,
    ending: true,
  });

  const { isLoading, jams, byDay, stats, totalAll } = useJamCalendar({ now, search });

  const setMonth = (delta: number) => {
    setMonthStart((m) => addMonthsUTC(m, delta));
  };

  const setMonthAt = (month: Date) => {
    setMonthStart(startOfMonthUTC(month));
  };

  const toggleChip = (kind: ChipKind) => {
    setVisibleChips((prev) => ({ ...prev, [kind]: !prev[kind] }));
  };

  const handleSelectDay = (day: Date) => {
    setSelectedDay(day);
    // Snap the visible month to the selected day's month — covers both
    // tapping a leading/trailing cell from an adjacent month and the
    // TODAY button (which selects today, possibly in a different month
    // from the one currently on screen).
    if (
      day.getUTCFullYear() !== monthStart.getUTCFullYear() ||
      day.getUTCMonth() !== monthStart.getUTCMonth()
    ) {
      setMonthStart(startOfMonthUTC(day));
    }
  };

  const layoutProps: JamCalendarLayoutProps = {
    monthStart,
    today,
    selectedDay,
    now,
    isLoading,
    jams,
    byDay,
    stats,
    totalShown: jams.length,
    totalAll,
    view,
    search,
    visibleChips,
    timelineRange,
    setMonth,
    setMonthAt,
    setSelectedDay: handleSelectDay,
    setView,
    setSearch,
    toggleChip,
    setTimelineRange,
  };

  return isTouch ? <JamCalendarMobile {...layoutProps} /> : <JamCalendarDesktop {...layoutProps} />;
}
