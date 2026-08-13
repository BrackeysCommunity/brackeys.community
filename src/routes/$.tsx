import { createFileRoute, notFound } from "@tanstack/react-router";

import { NotFoundPage } from "@/components/layout/NotFoundPage";

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
  head: () => ({
    meta: [{ title: "Not found · Brackeys Community" }, { name: "robots", content: "noindex" }],
  }),
  component: () => null,
  notFoundComponent: () => <NotFoundPage />,
});
