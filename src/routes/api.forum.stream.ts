import "@/polyfill";
import { createFileRoute } from "@tanstack/react-router";

import { onForumPost } from "@/lib/forum-live";
import {
  ANONYMOUS_FLAG_DISTINCT_ID,
  isServerFlagEnabled,
  withErrorReporting,
} from "@/lib/posthog-server";
import { readRouteSession } from "@/lib/route-session";
import { sseResponse } from "@/lib/sse";

/**
 * The forum's live channel: one `post` event per newly published post, for
 * the feed's "N new posts" pill. Dark with the forum — a reader the flag is
 * off for gets the same 404 as every other forum surface.
 */
async function handle({ request }: { request: Request }) {
  const session = await readRouteSession(request, "forum_stream.session_read");
  const userId = session?.user.id ?? null;
  if (!(await isServerFlagEnabled("forum-enabled", userId ?? ANONYMOUS_FLAG_DISTINCT_ID))) {
    return new Response("Not found", { status: 404 });
  }

  return sseResponse(request, {
    subscribe: (send) => onForumPost((event) => send("post", event)),
  });
}

const reportedHandle = withErrorReporting("/api/forum/stream", handle);

export const Route = createFileRoute("/api/forum/stream")({
  server: {
    handlers: {
      GET: reportedHandle,
    },
  },
});
