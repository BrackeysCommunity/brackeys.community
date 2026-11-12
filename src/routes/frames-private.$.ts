import { createFileRoute } from "@tanstack/react-router";

import { createFrameRoute } from "@/lib/engine/frame-route";
import { minioReleaseStore } from "@/lib/engine/release-storage";
import { withErrorReporting } from "@/lib/posthog-server";

/** A private or team release's files: `/frames-private/<releaseId>/<token>/<path>`, never cached at the edge. */
const frameRoute = createFrameRoute({ store: minioReleaseStore });

const reportedHandle = withErrorReporting(
  "/frames-private/$",
  ({ request }: { request: Request }) => frameRoute(request, "frames-private"),
);

export const Route = createFileRoute("/frames-private/$")({
  server: {
    handlers: {
      HEAD: reportedHandle,
      GET: reportedHandle,
    },
  },
});
