import { createFileRoute, notFound, Outlet } from "@tanstack/react-router";

import { arcadeAccessQueryOptions } from "@/arcade/access";
import { buildMeta } from "@/lib/site-meta";

/**
 * Every `/arcade/*` page sits behind `arcade-enabled`, checked on the server
 * so a browser that blocks PostHog still gets the 404. The pages also read
 * `useFlagBlocks` to cover a flag flipped off mid-visit.
 */
export const Route = createFileRoute("/arcade")({
  loader: async ({ context: { queryClient } }) => {
    const access = await queryClient.ensureQueryData(arcadeAccessQueryOptions());
    if (!access.arcade) throw notFound();
    return access;
  },
  // The arcade is an interactive surface, not content. `canonical: false`
  // for the same reason `/game` sets it: a layout head lands on every route
  // below, and each would otherwise claim to canonically be `/arcade`.
  head: () =>
    buildMeta({ title: "Arcade", path: "/arcade", noindexNofollow: true, canonical: false }),
  component: () => <Outlet />,
});
