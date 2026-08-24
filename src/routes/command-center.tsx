import { createFileRoute } from "@tanstack/react-router";

import { CommandCenterPage } from "@/components/commands/CommandCenterPage";
import { buildMeta } from "@/lib/site-meta";

export const Route = createFileRoute("/command-center")({
  // A signed-in surface that answers an anonymous crawler with a generic
  // shell. `robots.txt` disallows it too; this covers a bot that arrives
  // through a link rather than a crawl of the root.
  head: () =>
    buildMeta({
      title: "Command center",
      path: "/command-center",
      noindexNofollow: true,
    }),
  component: CommandCenterPage,
});
