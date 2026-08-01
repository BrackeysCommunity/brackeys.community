import { JamCalendarSpans } from "../JamCalendarSpans";
import { useJamsPage } from "../jams-context";
import { JamsToolbar } from "../JamsToolbar";

/** `/jams/calendar` — the named-span month calendar. */
export function JamCalendarView() {
  const { monthStart, today, calendar, now, compact, setMonth, setMonthAt } = useJamsPage();

  return (
    <>
      <JamsToolbar />
      <JamCalendarSpans
        monthStart={monthStart}
        today={today}
        jams={calendar.jams}
        byDay={calendar.byDay}
        now={now}
        isLoading={calendar.isLoading}
        compact={compact}
        onMonthChange={setMonthAt}
        onPrevMonth={() => setMonth(-1)}
        onNextMonth={() => setMonth(1)}
        onJumpToday={() => setMonthAt(today)}
      />
    </>
  );
}
