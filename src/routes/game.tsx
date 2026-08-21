import { createFileRoute, Outlet } from "@tanstack/react-router";

import { buildMeta } from "@/lib/site-meta";

export const Route = createFileRoute("/game")({
  // The whole `/game` subtree is an interactive surface, not content.
  // `canonical: false`: a layout head lands on every `/game/$roomId`
  // document, and each would otherwise claim to canonically be `/game`.
  head: () => buildMeta({ title: "Game", path: "/game", noindexNofollow: true, canonical: false }),
  component: () => <Outlet />,
});
