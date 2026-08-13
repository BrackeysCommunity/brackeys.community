import { createFileRoute, notFound } from "@tanstack/react-router";

import { JamDetailPage } from "@/components/jams/JamDetailPage";
import { NotFoundPage } from "@/components/layout/NotFoundPage";
import { htmlToPlainText } from "@/components/ui/typography";
import { client } from "@/orpc/client";

/**
 * A jam's permanent page.
 *
 * The `jams_` escape opts out of the `/jams` layout route — that layout
 * owns the board hero, the view switcher and the shared search state, none
 * of which belong over a single jam.
 *
 * Unlike every other page here, this one loads through a route `loader`
 * rather than a `useQuery` in the component. That's deliberate: these
 * pages exist to make ~23k tracked jams shareable and indexable, and a
 * client-fetched page serves a crawler an empty shell. The loader runs on
 * the server (where `client` calls the router directly, no HTTP hop), so
 * the title, description, banner and first page of submissions are all in
 * the document — and `head()` can build real meta tags from the data.
 */
export const Route = createFileRoute("/jams_/$jamSlug")({
  loader: async ({ params }) => {
    const detail = await client.getJam({ idOrSlug: params.jamSlug });
    // A jam stamped `missing_since` 404s on itch, and `getJam` treats it as
    // absent — a row we keep for the scraper's sake isn't a page.
    if (!detail) throw notFound();

    const [initialEntries, results] = await Promise.all([
      // Matches `JamEntriesSection`'s default query exactly, so the grid
      // seeds from this instead of refetching on mount.
      detail.trackedEntries > 0
        ? client.listJamEntries({ jamId: detail.jam.jamId, page: 0, sortBy: "rank" })
        : Promise.resolve({ entries: [], total: 0 }),
      detail.hasResults
        ? client.getJamResults({ jamId: detail.jam.jamId })
        : Promise.resolve({ criteria: [] }),
    ]);

    return { detail, initialEntries, results: results.criteria };
  },
  head: ({ loaderData }) => {
    const jam = loaderData?.detail.jam;
    if (!jam) return {};
    const title = `${jam.title} · Brackeys Community`;
    const description =
      htmlToPlainText(jam.contentHtml, 180) ??
      `${jam.title} on itch.io — dates, submissions and results, tracked by Brackeys.`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: jam.title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        ...(jam.bannerUrl ? [{ property: "og:image", content: jam.bannerUrl }] : []),
        { name: "twitter:card", content: jam.bannerUrl ? "summary_large_image" : "summary" },
      ],
    };
  },
  component: JamDetailRoute,
  notFoundComponent: JamNotFound,
});

function JamDetailRoute() {
  const { detail, initialEntries, results } = Route.useLoaderData();
  return <JamDetailPage detail={detail} initialEntries={initialEntries} results={results} />;
}

function JamNotFound() {
  return <NotFoundPage subject="Jam" message="That link doesn't match any jam we track." />;
}
