import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";

import { NotFoundPage } from "@/components/layout/NotFoundPage";
import { TeamPage, type RpcTeam } from "@/components/teams/TeamPage";
import { TeamPageSkeleton } from "@/components/teams/TeamPageSkeleton";
import { useTeamViewerState } from "@/components/teams/use-team-viewer-state";
import { authStore } from "@/lib/auth-store";
import { orpc } from "@/orpc/client";

export const Route = createFileRoute("/teams/$teamId")({
  component: TeamById,
});

/**
 * A team's public page. The route param accepts both the raw team id
 * and the slug form — resolution happens server-side in `getTeam`,
 * mirroring how `/profile/$userId` resolves vanity stubs.
 */
function TeamById() {
  const { teamId } = Route.useParams();
  const { session } = useStore(authStore);
  const queryOptions = orpc.getTeam.queryOptions({ input: { teamId } });
  const { data, isLoading } = useQuery({ ...queryOptions, staleTime: 30 * 1000 });

  // The anonymous core and the viewer's standing are two reads; the page
  // and everything under it still see one team object.
  const { viewerState, invalidate } = useTeamViewerState(teamId, Boolean(session?.user));

  if (isLoading) return <TeamPageSkeleton />;
  if (!data) return <TeamNotFoundState />;

  const team = { ...data, ...viewerState } as unknown as RpcTeam;

  return <TeamPage team={team} onInvalidate={invalidate} />;
}

function TeamNotFoundState() {
  return (
    <NotFoundPage subject="Team" message="The handle you're looking for doesn't match any team." />
  );
}
