import { createFileRoute } from "@tanstack/react-router";

import { boardJamsQueryOptions } from "@/components/jams/JamCalendarPage/use-jam-data";
import { JamBoardView } from "@/components/jams/JamCalendarPage/views/JamBoardView";
import { prefetchInLoader } from "@/lib/route-prefetch";
import { buildMeta, ogCardPath } from "@/lib/site-meta";

export const Route = createFileRoute("/jams/")({
  // The board's ~500 rows used to be requested only once the bundle had
  // downloaded and hydrated — strictly after the skeleton painted. On the
  // server this puts them in the document instead; on the client it starts
  // the request at hover (`defaultPreload: "intent"`) rather than at mount.
  loader: ({ context: { queryClient } }) =>
    prefetchInLoader(queryClient.prefetchQuery(boardJamsQueryOptions())),
  head: () =>
    buildMeta({
      title: "Game jams",
      description:
        "Every game jam worth entering, on one board — what is live, what opens next, what is in voting, and how many people are in.",
      path: "/jams",
      card: ogCardPath("board", "jams"),
    }),
  component: JamBoardView,
});
