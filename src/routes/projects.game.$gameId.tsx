import { createFileRoute, notFound, redirect } from "@tanstack/react-router";

import { NotFoundPage } from "@/components/layout/NotFoundPage";
import { client } from "@/orpc/client";

/**
 * Mint-and-redirect for the scraped corpus (§7.3): the first visit to a
 * scraped game's page creates its canonical row, and every visit lands on
 * `/projects/<slug>` — this URL is never a destination.
 *
 * `noindex, nofollow` because minting-by-visit must not be something a
 * crawler does at scale; the canonical slug page is the indexable one (and
 * only once it's anchored). A bot that follows anyway only warms the cache —
 * minting is idempotent — but the attributes stay.
 */
export const Route = createFileRoute("/projects/game/$gameId")({
  loader: async ({ params }) => {
    const gameId = Number(params.gameId);
    if (!Number.isSafeInteger(gameId) || gameId <= 0) throw notFound();
    const resolved = await client.resolveProjectForGame({ gameId });
    // Null is both "we hold no live entry for this game" and the staff
    // kill switch on a hidden row — neither has a page.
    if (!resolved) throw notFound();
    throw redirect({
      to: "/projects/$projectSlug",
      params: { projectSlug: resolved.slug },
      replace: true,
    });
  },
  head: () => ({
    meta: [{ name: "robots", content: "noindex, nofollow" }],
  }),
  component: () => null,
  notFoundComponent: GameNotFound,
});

function GameNotFound() {
  return <NotFoundPage subject="Project" message="We don't hold a page for that game." />;
}
