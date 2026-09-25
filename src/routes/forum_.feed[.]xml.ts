import { createFileRoute } from "@tanstack/react-router";

import { forumAtomResponse } from "@/lib/forum-atom";
import { withErrorReporting } from "@/lib/posthog-server";
import { SITE_NAME } from "@/lib/site-meta";

/** `/forum/feed.xml` — every devlog on the forum, newest first. */
function handle() {
  return forumAtomResponse({
    title: `${SITE_NAME} — devlogs`,
    subtitle: "Devlogs from the Brackeys community forum.",
    selfPath: "/forum/feed.xml",
    alternatePath: "/forum?kind=devlog",
  });
}

const reportedHandle = withErrorReporting("/forum/feed.xml", handle);

export const Route = createFileRoute("/forum_/feed.xml")({
  server: { handlers: { HEAD: reportedHandle, GET: reportedHandle } },
});
