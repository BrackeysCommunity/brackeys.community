import { createFileRoute } from "@tanstack/react-router";

import { createFrameRoute } from "@/lib/engine/frame-route";
import { minioReleaseStore } from "@/lib/engine/release-storage";
import { withErrorReporting } from "@/lib/posthog-server";

/** A public or unlisted release's files: `/frames/<releaseId>/<path>`, sandboxed by the frame's CSP. */
const frameRoute = createFrameRoute({ store: minioReleaseStore });

const reportedHandle = withErrorReporting("/frames/$", ({ request }: { request: Request }) =>
  frameRoute(request, "frames"),
);

export const Route = createFileRoute("/frames/$")({
  server: {
    handlers: {
      HEAD: reportedHandle,
      GET: reportedHandle,
    },
  },
});
