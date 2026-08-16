import { motion } from "framer-motion";

import { PageStack } from "@/components/ui/page-motion";
import { fadeUp } from "@/lib/motion";

import { JamCalendarSpans } from "../JamCalendarSpans";
import { useJamsPage } from "../jams-context";
import { JamsToolbar } from "../JamsToolbar";

/** `/jams/calendar` — the named-span month calendar. */
export function JamCalendarView() {
  const { monthStart, today, calendar, now, compact, setMonth, setMonthAt } = useJamsPage();

  return (
    // The stack replaces what used to be a fragment, so it has to carry
    // the layout's own column gap to keep the spacing it had as siblings.
    <PageStack className={compact ? "flex flex-col gap-6" : "flex flex-col gap-8"}>
      <motion.div variants={fadeUp}>
        <JamsToolbar />
      </motion.div>
      <motion.div variants={fadeUp}>
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
      </motion.div>
    </PageStack>
  );
}
