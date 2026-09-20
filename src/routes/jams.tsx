import { createFileRoute } from "@tanstack/react-router";

import { JamsPageLayout } from "@/components/jams/JamCalendarPage";
import { trackedJamsQueryOptions } from "@/components/jams/JamCalendarPage/use-jam-data";
import { prefetchInLoader } from "@/lib/route-prefetch";

export const Route = createFileRoute("/jams")({
  // The masthead prints this on all three views, so it belongs to the
  // layout: in the document it is a finished sentence, and switching views
  // reads one cache entry.
  loader: ({ context: { queryClient } }) =>
    prefetchInLoader(queryClient.prefetchQuery(trackedJamsQueryOptions())),
  component: JamsPageLayout,
});
