import { createFileRoute } from "@tanstack/react-router";

import { calendarJamsQueryOptions } from "@/components/jams/JamCalendarPage/use-jam-data";
import { JamCalendarView } from "@/components/jams/JamCalendarPage/views/JamCalendarView";
import { prefetchInLoader } from "@/lib/route-prefetch";
import { buildMeta, ogCardPath } from "@/lib/site-meta";

export const Route = createFileRoute("/jams/calendar")({
  // Without this the server-rendered document has no jams in it at all.
  loader: ({ context: { queryClient } }) =>
    prefetchInLoader(queryClient.prefetchQuery(calendarJamsQueryOptions())),
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
