import { createFileRoute } from "@tanstack/react-router";

import {
  archiveJamsQueryOptions,
  DEFAULT_ARCHIVE_STATE,
} from "@/components/jams/JamCalendarPage/use-jam-data";
import { JamArchiveView } from "@/components/jams/JamCalendarPage/views/JamArchiveView";
import { prefetchInLoader } from "@/lib/route-prefetch";
import { buildMeta } from "@/lib/site-meta";

export const Route = createFileRoute("/jams/archive")({
  // The default view is what an unfiltered arrival asks for, so it is what
  // the document ships with rather than an empty table.
  loader: ({ context: { queryClient } }) =>
    prefetchInLoader(queryClient.prefetchQuery(archiveJamsQueryOptions(DEFAULT_ARCHIVE_STATE))),
  head: () =>
    buildMeta({
      title: "Jam archive",
      description:
        "Every game jam we track that has already run — searchable and sortable by entries, ratings, duration and date. Around 19,000 of them.",
      path: "/jams/archive",
    }),
  component: JamArchiveView,
});
