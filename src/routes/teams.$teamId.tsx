import { useQuery } from "@tanstack/react-query";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";

import { NotFoundPage } from "@/components/layout/NotFoundPage";
import { TeamPage, type RpcTeam } from "@/components/teams/TeamPage";
import { TeamPageSkeleton } from "@/components/teams/TeamPageSkeleton";
import { useTeamViewerState } from "@/components/teams/use-team-viewer-state";
import { authStore } from "@/lib/auth-store";
import { breadcrumbNode, buildMeta, jsonLd, ogCardPath } from "@/lib/site-meta";
import { orpc } from "@/orpc/client";

/**
 * A team's public page. The route param accepts both the raw team id
 * and the slug form — resolution happens server-side in `getTeam`,
 * mirroring how `/profile/$userId` resolves vanity stubs.
 *
 * Loads through a `loader` for the same reasons `profile.$userId.tsx` does:
 * content and meta in the document, and a real 404 for an unmatched handle.
 */
export const Route = createFileRoute("/teams/$teamId")({
  loader: async ({ context: { queryClient }, params }) => {
    const data = await queryClient.ensureQueryData(
      orpc.getTeam.queryOptions({ input: { teamId: params.teamId } }),
    );
    if (!data) throw notFound();
    return data;
  },
  head: ({ loaderData }) => {
    if (!loaderData) {
      return buildMeta({ title: "Team not found", path: "/teams", noindexNofollow: true });
    }
    const team = loaderData;
    const memberCount = team.members.length;
    const stack = team.skills
      .slice(0, 3)
      .map((skill) => skill.name)
      .join(", ");
    const description =
      team.tagline?.trim() ||
      team.bio?.trim().slice(0, 180) ||
      [
        `${memberCount} ${memberCount === 1 ? "member" : "members"} on Brackeys Community.`,
        stack && `Works in ${stack}.`,
        team.recruiting && "Currently recruiting.",
      ]
        .filter(Boolean)
        .join(" ");

    const path = `/teams/${team.slug}`;
    const sameAs = [team.websiteUrl, team.itchUrl].filter((url): url is string => Boolean(url));

    return {
      ...buildMeta({
        title: team.name,
        description,
        path,
        card: ogCardPath("team", team.slug),
        imageAlt: `${team.name} on Brackeys Community`,
      }),
      scripts: jsonLd([
        {
          "@context": "https://schema.org",
          "@type": "Organization",
          name: team.name,
          url: path,
          ...(team.avatarUrl ? { logo: team.avatarUrl } : {}),
          ...(team.tagline ? { description: team.tagline } : {}),
          ...(sameAs.length > 0 ? { sameAs } : {}),
          numberOfEmployees: memberCount,
        },
        {
          "@context": "https://schema.org",
          ...breadcrumbNode([
            { name: "Teams", path: "/teams" },
            { name: team.name, path },
          ]),
        },
      ]),
    };
  },
  component: TeamById,
  pendingComponent: TeamPageSkeleton,
  notFoundComponent: TeamNotFoundState,
});

function TeamById() {
  const { teamId } = Route.useParams();
  const { session } = useStore(authStore);
  const queryOptions = orpc.getTeam.queryOptions({ input: { teamId } });
  // Seeded by the loader; still a `useQuery` so writes have a subscriber.
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
