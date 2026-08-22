import type { QueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { HomePage } from "@/components/home/HomePage";
import { selectShowcaseJams } from "@/components/home/JamShowcaseBand";
import { MobileHome } from "@/components/home/MobileHome";
import { newestSignupsQueryOptions } from "@/components/home/NewestSignups";
import { recentCollabPostsQueryOptions } from "@/components/home/use-recent-collab-posts";
import { entryJamIdsFor, recentEntriesQueryOptions } from "@/components/home/use-recent-entries";
import {
  boardJamsQueryOptions,
  heroPinsQueryOptions,
  homeJamsFrom,
} from "@/components/jams/JamCalendarPage/use-jam-data";
import { siteOrigin, siteUrl } from "@/env";
import { useIsMobile } from "@/lib/hooks/use-mobile";
import { isServerLoad } from "@/lib/route-prefetch";
import { buildMeta, jsonLd, organizationNode, SITE_NAME } from "@/lib/site-meta";

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
  const pinOptions = heroPinsQueryOptions();
  // Both must land before the band's set is known — a pin can move the hero,
  // and the band is the jams the hero didn't take.
  const heroInputs = Promise.all([
    queryClient.prefetchQuery(boardOptions),
    queryClient.prefetchQuery(pinOptions),
  ]);
  // Independent of the board and of each other, so they run alongside it
  // rather than behind it.
  const sections = [
    queryClient.prefetchQuery(recentCollabPostsQueryOptions()),
    queryClient.prefetchQuery(newestSignupsQueryOptions()),
  ];
  if (!isServerLoad()) return;

  await heroInputs;
  const all = queryClient.getQueryData(boardOptions.queryKey)?.jams ?? [];
  const pins = queryClient.getQueryData(pinOptions.queryKey)?.pins ?? [];
  const { featured, upcoming, heroSlides } = homeJamsFrom(all, Date.now(), pins);
  const heroJamIds = heroSlides.map((slide) => slide.jam.jamId);
  const showcase = selectShowcaseJams(featured, upcoming, heroJamIds);
  // The rotation rides along — its covers drive the panel's entries view.
  const entryJamIds = entryJamIdsFor(heroJamIds, showcase);
  if (entryJamIds.length > 0) {
    sections.push(queryClient.prefetchQuery(recentEntriesQueryOptions(entryJamIds)));
  }

  await Promise.all(sections);
}

export const Route = createFileRoute("/")({
  loader: ({ context: { queryClient } }) => prefetchHome(queryClient),
  head: () => ({
    ...buildMeta({ path: "/" }),
    scripts: jsonLd([
      { "@context": "https://schema.org", ...organizationNode() },
      {
        "@context": "https://schema.org",
        "@type": "WebSite",
        "@id": `${siteOrigin()}/#website`,
        name: SITE_NAME,
        url: siteOrigin(),
        publisher: { "@id": `${siteOrigin()}/#organization` },
        // The broadest search surface, so it is where a sitelinks search
        // box should land.
        potentialAction: {
          "@type": "SearchAction",
          target: {
            "@type": "EntryPoint",
            urlTemplate: siteUrl("/members?q={search_term_string}"),
          },
          "query-input": "required name=search_term_string",
        },
      },
    ]),
  }),
  component: HomeRoute,
});
