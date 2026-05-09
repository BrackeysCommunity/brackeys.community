import { JamCalendarHero } from "./JamCalendarHero";
import { JamCalendarMonthGrid } from "./JamCalendarMonthGrid";
import { JamCalendarTimeline } from "./JamCalendarTimeline";
import { JamCalendarToolbar } from "./JamCalendarToolbar";
import type { JamCalendarLayoutProps } from "./shared-types";

/**
 * Stacked touch layout: hero, toolbar, the calendar (or timeline) in
 * compact mode. Day-detail surfaces as a spotlight popover anchored to
 * the tapped cell.
 */
export function JamCalendarMobile(props: JamCalendarLayoutProps) {
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
    <div className="flex flex-col gap-6">
      <JamCalendarHero
        totalJams={totalAll}
        stats={stats}
        statsLayout="hidden"
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
        layout="stacked"
      />
      {view === "calendar" ? (
        <JamCalendarMonthGrid
          monthStart={monthStart}
          today={today}
          selectedDay={selectedDay}
          byDay={byDay}
          visibleChips={visibleChips}
          compact
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
