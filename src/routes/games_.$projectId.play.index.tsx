import { createFileRoute, redirect } from "@tanstack/react-router";

/** `/games/<project>/play` goes to the live version. */
export const Route = createFileRoute("/games_/$projectId/play/")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/games/$projectId/play/$version",
      params: { projectId: params.projectId, version: "latest" },
      replace: true,
    });
  },
});
