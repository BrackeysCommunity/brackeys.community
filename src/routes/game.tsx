import { createFileRoute, Outlet } from "@tanstack/react-router";

import { buildMeta } from "@/lib/site-meta";

export const Route = createFileRoute("/game")({
  // The whole `/game` subtree is an interactive surface, not content.
  head: () => buildMeta({ title: "Game", path: "/game", noindexNofollow: true }),
  component: () => <Outlet />,
});
