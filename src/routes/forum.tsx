import { ORPCError } from "@orpc/client";
import { createFileRoute, notFound, Outlet } from "@tanstack/react-router";

import { forumCategoriesQueryOptions } from "@/components/forum/forum-queries";
import { GuildGateModal } from "@/components/forum/guild-gate";
import { NotFoundPage } from "@/components/layout/NotFoundPage";
import { useFlagBlocks } from "@/lib/hooks/use-flag";

/**
 * Every `/forum/*` page sits behind `forum-enabled`. The loader is the real
 * gate: every forum procedure answers NOT_FOUND while the flag is off for
 * the caller, so the categories read (which the sidebar needs anyway)
 * doubles as the check and a dark forum is a 404 even when the browser
 * blocks PostHog. `useFlagBlocks` still covers a flag flipped off mid-visit.
 */
export const Route = createFileRoute("/forum")({
  loader: async ({ context: { queryClient } }) => {
    await queryClient.ensureQueryData(forumCategoriesQueryOptions()).catch((error: unknown) => {
      if (error instanceof ORPCError && error.code === "NOT_FOUND") throw notFound();
      throw error;
    });
  },
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
