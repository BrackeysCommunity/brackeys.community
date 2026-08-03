import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { TeamPage, type RpcTeam } from "@/components/teams/TeamPage";
import { Text } from "@/components/ui/typography";
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
  const queryOptions = orpc.getTeam.queryOptions({ input: { teamId } });
  const { data, isLoading } = useQuery({ ...queryOptions, staleTime: 30 * 1000 });

  if (isLoading) return <TeamLoadingState />;
  if (!data) return <TeamNotFoundState />;

  return <TeamPage team={data as unknown as RpcTeam} queryKey={queryOptions.queryKey} />;
}

function TeamLoadingState() {
  return (
    <div className="flex items-center justify-center py-24">
      <Text size="xs" variant="muted" className="animate-pulse tracking-widest uppercase">
        Loading team…
      </Text>
    </div>
  );
}

function TeamNotFoundState() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-24">
      <Text size="xs" variant="muted" className="tracking-widest uppercase">
        ✕ TEAM NOT FOUND
      </Text>
      <Text size="sm" variant="muted">
        The handle you're looking for doesn't match any team.
      </Text>
    </div>
  );
}
