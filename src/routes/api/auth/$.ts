import { createFileRoute } from "@tanstack/react-router";

import { auth } from "@/lib/auth";
import { withErrorReporting } from "@/lib/posthog-server";

const handle = withErrorReporting("/api/auth/$", ({ request }: { request: Request }) =>
  auth.handler(request),
);

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      HEAD: handle,
      GET: handle,
      POST: handle,
      PUT: handle,
      PATCH: handle,
      DELETE: handle,
    },
  },
});
