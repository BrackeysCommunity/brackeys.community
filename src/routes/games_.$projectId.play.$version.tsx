import { createFileRoute } from "@tanstack/react-router";

import { PlayPage } from "@/components/games/PlayChrome";
import { buildMeta } from "@/lib/site-meta";

/** The play page: a release in its sandboxed frame, full window. */
export const Route = createFileRoute("/games_/$projectId/play/$version")({
  staticData: { shell: "takeover" },
  ssr: false,
  head: ({ params }) =>
    buildMeta({
      title: "Play",
      path: `/games/${params.projectId}/play/${params.version}`,
      noindexNofollow: true,
    }),
  component: PlayRoute,
});

function PlayRoute() {
  const { projectId, version } = Route.useParams();
  return <PlayPage projectId={projectId} version={version} />;
}
