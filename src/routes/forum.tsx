import { createFileRoute, Outlet } from "@tanstack/react-router";

import { GuildGateModal } from "@/components/forum/guild-gate";
import { NotFoundPage } from "@/components/layout/NotFoundPage";
import { useFlagBlocks } from "@/lib/hooks/use-flag";

/**
 * Every `/forum/*` page sits behind `forum-enabled`. Rendered, not thrown,
 * like the arcade: the flag is only known in the browser. The server
 * answers NOT_FOUND to every forum procedure on its own, so a browser that
 * blocks PostHog still gets nothing.
 */
export const Route = createFileRoute("/forum")({
  component: ForumLayout,
});

function ForumLayout() {
  if (useFlagBlocks("forum-enabled")) return <NotFoundPage />;
  return (
    <>
      <Outlet />
      <GuildGateModal />
    </>
  );
}
