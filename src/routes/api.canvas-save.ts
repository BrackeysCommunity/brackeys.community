import "@/polyfill";
import { ORPCError } from "@orpc/client";
import { call } from "@orpc/server";
import { createFileRoute } from "@tanstack/react-router";

import { withErrorReporting } from "@/lib/posthog-server";
import { saveCanvas } from "@/orpc/router/canvas";

const STATUS: Record<string, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  PAYLOAD_TOO_LARGE: 413,
};

/**
 * The editor's last save as a tab closes: `fetch(…, { keepalive: true })`
 * can't go through the oRPC client, so this takes the same JSON and runs
 * the same procedure. The reply is ignored; the page is gone.
 */
async function handle({ request }: { request: Request }) {
  const input = (await request.json().catch(() => null)) as unknown;
  if (!input || typeof input !== "object") {
    return Response.json({ message: "Expected JSON." }, { status: 400 });
  }
  try {
    await call(saveCanvas, input as { canvasId: string; update: string; stateVector: string }, {
      context: { headers: request.headers },
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof ORPCError) {
      return Response.json({ message: error.message }, { status: STATUS[error.code] ?? 500 });
    }
    throw error;
  }
}

export const Route = createFileRoute("/api/canvas-save")({
  server: { handlers: { POST: withErrorReporting("/api/canvas-save", handle) } },
});
