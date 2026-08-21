import { createFileRoute, notFound } from "@tanstack/react-router";

import { NotFoundPage } from "@/components/layout/NotFoundPage";
import { buildMeta, NOT_FOUND_OG_CARD } from "@/lib/site-meta";

/**
 * Catch-all for URLs that match no route. The loader throws rather than the
 * component simply rendering: a thrown not-found is what drops the SSR
 * response to a 404, and a rendered component would answer 200 to crawlers.
 * More specific routes (including the `/api/*` handlers) still win the match.
 */
export const Route = createFileRoute("/$")({
  loader: () => {
    throw notFound();
  },
  head: () =>
    buildMeta({
      title: "Not found",
      description: "Nothing lives at this link — it may have moved or been renamed.",
      path: "/",
      card: NOT_FOUND_OG_CARD,
      noindexNofollow: true,
      canonical: false,
    }),
  component: () => null,
  notFoundComponent: () => <NotFoundPage />,
});
