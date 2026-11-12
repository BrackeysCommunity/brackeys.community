import { createFileRoute, getRouteApi } from "@tanstack/react-router";

import { EmbedFrame } from "@/components/games/EmbedFrame";
import { buildMeta } from "@/lib/site-meta";

const routeApi = getRouteApi("/games_/$projectId/embed/$version");

/** The embed page: a public or unlisted release's frame with no actions, for other sites. */
export const Route = createFileRoute("/games_/$projectId/embed/$version")({
  staticData: { shell: "takeover" },
  ssr: false,
  head: ({ params }) =>
    buildMeta({
      title: "Play",
      path: `/games/${params.projectId}/embed/${params.version}`,
      noindexNofollow: true,
    }),
  component: EmbedRoute,
});

function EmbedRoute() {
  const { projectId, version } = routeApi.useParams();
  return <EmbedFrame projectId={projectId} version={version} />;
}
