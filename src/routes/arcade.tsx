import { createFileRoute, Outlet } from "@tanstack/react-router";

import { buildMeta } from "@/lib/site-meta";

export const Route = createFileRoute("/arcade")({
  // The arcade is an interactive surface, not content. `canonical: false`
  // for the same reason `/game` sets it: a layout head lands on every route
  // below, and each would otherwise claim to canonically be `/arcade`.
  head: () =>
    buildMeta({ title: "Arcade", path: "/arcade", noindexNofollow: true, canonical: false }),
  component: () => <Outlet />,
});
