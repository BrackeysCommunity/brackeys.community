import { createFileRoute, redirect } from "@tanstack/react-router";

import { SuspendedPage } from "@/components/layout/SuspendedPage";
import { pageTitle } from "@/lib/site-meta";
import { client } from "@/orpc/client";

/**
 * Where a banned account is told what happened — everywhere else resolves their
 * session as anonymous. `getBanStatus` is the one procedure that sees a banned
 * session, so the loader doubles as the guard.
 */
export const Route = createFileRoute("/suspended")({
  loader: async () => {
    const status = await client.getBanStatus();
    if (!status.banned) throw redirect({ to: "/" });
    return status;
  },
  component: SuspendedRoute,
  head: () => ({
    meta: [
      { title: pageTitle("Account suspended") },
      // Nothing about a person's suspension belongs in a search index.
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

function SuspendedRoute() {
  const status = Route.useLoaderData();
  return <SuspendedPage bannedAt={status.bannedAt} until={status.until} reason={status.reason} />;
}
