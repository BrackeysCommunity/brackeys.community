import { createFileRoute } from "@tanstack/react-router";

import {
  calendarJamsQueryOptions,
  currentMonthKey,
} from "@/components/jams/JamCalendarPage/use-jam-data";
import { JamCalendarView } from "@/components/jams/JamCalendarPage/views/JamCalendarView";
import { prefetchInLoader } from "@/lib/route-prefetch";
import { buildMeta, ogCardPath } from "@/lib/site-meta";

export const Route = createFileRoute("/jams/calendar")({
  // Without this the server-rendered document has no jams in it at all.
  // The calendar opens on the current month, so that is the window the
  // document carries; stepping to another month fetches it.
  loader: ({ context: { queryClient } }) =>
    prefetchInLoader(queryClient.prefetchQuery(calendarJamsQueryOptions(currentMonthKey()))),
  head: () =>
    buildMeta({
      title: "Jam calendar",
      description:
        "Every game jam on one month grid — what is running now, what opens next, and when submissions and voting close.",
      path: "/jams/calendar",
      card: ogCardPath("board", "calendar"),
    }),
  component: JamCalendarView,
});
