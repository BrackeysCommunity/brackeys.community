import type { QueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { pickHeroJam } from "@/components/home/FeaturedJamPanel";
import { HomePage } from "@/components/home/HomePage";
import { selectShowcaseJams } from "@/components/home/JamShowcaseBand";
import { MobileHome } from "@/components/home/MobileHome";
import { newestSignupsQueryOptions } from "@/components/home/NewestSignups";
import { recentCollabPostsQueryOptions } from "@/components/home/RecentCollabPosts";
import { recentEntriesQueryOptions } from "@/components/home/use-recent-entries";
import {
  boardJamsQueryOptions,
  homeJamsFrom,
} from "@/components/jams/JamCalendarPage/use-jam-data";
import { useIsMobile } from "@/hooks/use-mobile";
import { isServerLoad } from "@/lib/route-prefetch";

function HomeRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileHome /> : <HomePage />;
}

/**
 * Everything the landing page reads, fetched before it renders.
 *
 * The jam half is chained: the band asks for the recent entries of the
 * jams it's showing, and it can't know which jams those are until the
 * board resolves. In the browser that is two round trips back to back,
 * after the bundle has downloaded and hydrated. Server-side the chain runs
 * in-process against the oRPC router, so both land in the document.
 *
 * The band's set is derived through the same functions the page uses, so
 * the prefetch is keyed on what will actually be asked for. The one thing
 * that can drift is `now` — the shelves are time-dependent, and the loader
 * reads the clock a fraction of a second before the page does. A jam
 * crossing a shelf boundary in that gap costs a cache miss and a fetch,
 * which is where we were anyway.
 *
 * Every query here is anonymous, which is the condition for prefetching
 * one at all: the server's cache is serialized into the HTML.
 */
async function prefetchHome(queryClient: QueryClient) {
  const boardOptions = boardJamsQueryOptions();
  const board = queryClient.prefetchQuery(boardOptions);
  // Independent of the board and of each other, so they run alongside it
  // rather than behind it.
  const sections = [
    queryClient.prefetchQuery(recentCollabPostsQueryOptions()),
    queryClient.prefetchQuery(newestSignupsQueryOptions()),
  ];
  if (!isServerLoad()) return;

  await board;
  const all = queryClient.getQueryData(boardOptions.queryKey)?.jams ?? [];
  const { featured, upcoming } = homeJamsFrom(all, Date.now());
  const hero = pickHeroJam(featured);
  const showcase = selectShowcaseJams(featured, upcoming, hero?.jam.jamId ?? null);
  if (showcase.length > 0) {
    sections.push(
      queryClient.prefetchQuery(recentEntriesQueryOptions(showcase.map((j) => j.jamId))),
    );
  }

  await Promise.all(sections);
}

export const Route = createFileRoute("/")({
  loader: ({ context: { queryClient } }) => prefetchHome(queryClient),
  component: HomeRoute,
});
