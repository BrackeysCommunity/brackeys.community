import type { QueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { HomePage } from "@/components/home/HomePage";
import { MobileHome } from "@/components/home/MobileHome";
import { newestSignupsQueryOptions } from "@/components/home/NewestSignups";
import { recentCollabPostsQueryOptions } from "@/components/home/use-recent-collab-posts";
import { entryJamIdsFor, recentEntriesQueryOptions } from "@/components/home/use-recent-entries";
import { homeJamsQueryOptions } from "@/components/jams/JamCalendarPage/use-jam-data";
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
 * jams it's showing, and it can't know which jams those are until
 * `homeJams` resolves. In the browser that is two round trips back to
 * back, after the bundle has downloaded and hydrated. Server-side the
 * chain runs in-process against the oRPC router, so both land in the
 * document.
 *
 * The chain used to run over the whole board listing, with the loader
 * repeating the page's own tiering to work out which jams the band would
 * show. `homeJams` returns the tiered answer, so the loader just reads the
 * ids off it — and the board listing, ~560 rows the page rendered sixteen
 * of, stays out of the home document entirely.
 *
 * Every query here is anonymous, which is the condition for prefetching
 * one at all: the server's cache is serialized into the HTML.
 */
async function prefetchHome(queryClient: QueryClient) {
  const homeOptions = homeJamsQueryOptions();
  const jamHalf = queryClient.prefetchQuery(homeOptions);
  // Independent of the jam half and of each other, so they run alongside
  // it rather than behind it.
  const sections = [
    queryClient.prefetchQuery(recentCollabPostsQueryOptions()),
    queryClient.prefetchQuery(newestSignupsQueryOptions()),
  ];
  if (!isServerLoad()) return;

  await jamHalf;
  const home = queryClient.getQueryData(homeOptions.queryKey);
  const heroJamIds = (home?.heroSlides ?? []).map((slide) => slide.jam.jamId);
  // The rotation rides along — its covers drive the panel's entries view.
  const entryJamIds = entryJamIdsFor(heroJamIds, home?.showcaseJams ?? []);
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
