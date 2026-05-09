import { JamCalendarHero } from "./JamCalendarHero";
import { JamCalendarMonthGrid } from "./JamCalendarMonthGrid";
import { JamCalendarTimeline } from "./JamCalendarTimeline";
import { JamCalendarToolbar } from "./JamCalendarToolbar";
import type { JamCalendarLayoutProps } from "./shared-types";

/**
 * Desktop layout: hero, toolbar, then the full-width month grid (or
 * timeline list). Selecting a day opens the day-detail popover anchored
 * to that day's cell — no separate side rail.
 */
export function JamCalendarDesktop(props: JamCalendarLayoutProps) {
  const {
    monthStart,
    today,
    selectedDay,
    byDay,
    visibleChips,
    timelineRange,
    view,
    search,
    stats,
    totalShown,
    totalAll,
    isLoading,
    jams,
    now,
    setMonth,
    setMonthAt,
    setSelectedDay,
    setView,
    setSearch,
    toggleChip,
    setTimelineRange,
  } = props;

  return (
    <div className="flex flex-col gap-8">
      <JamCalendarHero
        totalJams={totalAll}
        stats={stats}
        statsLayout="inline"
        view={view}
        onViewChange={setView}
      />
      <JamCalendarToolbar
        view={view}
        visibleChips={visibleChips}
        onToggleChip={toggleChip}
        search={search}
        onSearchChange={setSearch}
        totalShown={totalShown}
        totalAll={totalAll}
        timelineRange={timelineRange}
        onTimelineRangeChange={setTimelineRange}
        layout="wide"
      />
      {view === "calendar" ? (
        <JamCalendarMonthGrid
          monthStart={monthStart}
          today={today}
          selectedDay={selectedDay}
          byDay={byDay}
          visibleChips={visibleChips}
          compact={false}
          onSelectDay={setSelectedDay}
          onMonthChange={setMonthAt}
          onPrevMonth={() => setMonth(-1)}
          onNextMonth={() => setMonth(1)}
          onJumpToday={() => setSelectedDay(today)}
        />
      ) : (
        <JamCalendarTimeline
          jams={jams}
          now={now}
          isLoading={isLoading}
          range={timelineRange}
          visibleChips={visibleChips}
        />
      )}
    </div>
  );
}
