import { createFileRoute, notFound } from "@tanstack/react-router";

import { JamDetailPage } from "@/components/jams/JamDetailPage";
import { JamDetailSkeleton } from "@/components/jams/JamDetailPage/JamDetailSkeleton";
import { NotFoundPage } from "@/components/layout/NotFoundPage";
import { htmlToPlainText } from "@/components/ui/typography";
import { siteUrl } from "@/env";
import { hostName } from "@/lib/jam-links";
import { isServerLoad } from "@/lib/route-prefetch";
import {
  breadcrumbNode,
  buildMeta,
  jsonLd,
  NOT_FOUND_OG_CARD,
  ogCardPath,
  organizationNode,
} from "@/lib/site-meta";
import { client, orpc } from "@/orpc/client";

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
  loader: async ({ context: { queryClient }, params }) => {
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

    // Which entries have a canonical project page. Without this the only
    // links in the document are the `nofollow` mint links. Returned as well
    // as cached so `head()` can point the ItemList at our own pages.
    const gameIds = initialEntries.entries.map((entry) => entry.gameId);
    const entryProjects =
      isServerLoad() && gameIds.length > 0
        ? (
            await queryClient.ensureQueryData(
              orpc.listProjectsForGames.queryOptions({ input: { gameIds } }),
            )
          ).projects
        : [];

    return { detail, initialEntries, results: results.criteria, entryProjects };
  },
  head: ({ loaderData }) => {
    if (!loaderData) {
      return buildMeta({
        title: "Jam not found",
        path: "/jams",
        card: NOT_FOUND_OG_CARD,
        noindexNofollow: true,
        canonical: false,
      });
    }
    const { detail, initialEntries, entryProjects } = loaderData;
    const jam = detail.jam;
    const path = `/jams/${jam.slug}`;
    const description = jamDescription(jam, detail.trackedEntries);
    // Entries with a canonical project page link inward; the rest stay on
    // itch. Empty on client-side navigations, where JSON-LD has no reader.
    const projectSlugByGame = new Map(
      entryProjects.map((project) => [project.sourceGameId, project.slug]),
    );

    return {
      ...buildMeta({
        title: jam.title,
        description,
        path,
        card: ogCardPath("jam", jam.slug),
        imageAlt: `${jam.title} — dates, entry count and status`,
      }),
      scripts: jsonLd([
        {
          "@context": "https://schema.org",
          "@type": "Event",
          name: jam.title,
          url: siteUrl(path),
          description,
          ...(jam.bannerUrl ? { image: jam.bannerUrl } : {}),
          ...(jam.startsAt ? { startDate: new Date(jam.startsAt).toISOString() } : {}),
          ...(jam.endsAt ? { endDate: new Date(jam.endsAt).toISOString() } : {}),
          eventStatus: "https://schema.org/EventScheduled",
          eventAttendanceMode: "https://schema.org/OnlineEventAttendanceMode",
          location: {
            "@type": "VirtualLocation",
            url: `https://itch.io/jam/${jam.slug}`,
          },
          organizer: jam.hosts[0]
            ? { "@type": "Organization", name: hostName(jam, "itch.io community") }
            : organizationNode(),
        },
        ...(initialEntries.entries.length > 0
          ? [
              {
                "@context": "https://schema.org",
                "@type": "ItemList",
                name: `${jam.title} submissions`,
                numberOfItems: detail.trackedEntries,
                itemListElement: initialEntries.entries.slice(0, 20).map((entry, index) => {
                  const slug = projectSlugByGame.get(entry.gameId);
                  return {
                    "@type": "ListItem",
                    position: index + 1,
                    name: entry.gameTitle,
                    url: slug ? siteUrl(`/projects/${encodeURIComponent(slug)}`) : entry.gameUrl,
                  };
                }),
              },
            ]
          : []),
        {
          "@context": "https://schema.org",
          ...breadcrumbNode([
            { name: "Game jams", path: "/jams" },
            { name: jam.title, path },
          ]),
        },
      ]),
    };
  },
  component: JamDetailRoute,
  // The board's most-clicked destination, and the loader is a round trip:
  // the generic page placeholder would be the wrong shape for the whole
  // wait, so this route names its own.
  pendingComponent: JamDetailSkeleton,
  notFoundComponent: JamNotFound,
});

interface JamDescriptionSource {
  title: string;
  startsAt: Date | string | null;
  endsAt: Date | string | null;
  contentHtml: string | null;
  hosts: { name: string }[];
}

/**
 * Our own data first, the scraped body second — the body alone is the
 * duplicated prose Google's scraped-content guidance is aimed at.
 */
function jamDescription(jam: JamDescriptionSource, trackedEntries: number): string {
  const window = jamDateRange(jam.startsAt, jam.endsAt);
  const host = jam.hosts[0] ? `Hosted by ${hostName(jam)}.` : null;
  const entries =
    trackedEntries > 0
      ? `${trackedEntries.toLocaleString("en-US")} submissions tracked here.`
      : null;
  const lead = [window, host, entries].filter(Boolean).join(" ");
  const room = 200 - lead.length;
  const body = room >= 60 ? htmlToPlainText(jam.contentHtml, room) : undefined;
  return body ? `${lead} ${body}` : lead || `${jam.title}, tracked on Brackeys Community.`;
}

/** "14–23 Feb 2026", in UTC like every other jam date. */
function jamDateRange(startsAt: Date | string | null, endsAt: Date | string | null): string | null {
  const start = startsAt ? new Date(startsAt) : null;
  const end = endsAt ? new Date(endsAt) : null;
  const fmt = (date: Date) =>
    date.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
  if (start && end) return `${fmt(start)} – ${fmt(end)}.`;
  if (start) return `Starts ${fmt(start)}.`;
  if (end) return `Ends ${fmt(end)}.`;
  return null;
}

function JamDetailRoute() {
  const { detail, initialEntries, results } = Route.useLoaderData();
  return <JamDetailPage detail={detail} initialEntries={initialEntries} results={results} />;
}

function JamNotFound() {
  return <NotFoundPage subject="Jam" message="That link doesn't match any jam we track." />;
}
