import { createFileRoute } from "@tanstack/react-router";

import { feedTeam, forumAtomResponse, forumFeedNotFound, forumFeedsOpen } from "@/lib/forum-atom";
import { withErrorReporting } from "@/lib/posthog-server";
import { teamSlug } from "@/lib/team-links";

/** `/teams/<team>/devlog.xml` — one team's devlogs. */
async function handle({ params }: { request: Request; params: { teamId: string } }) {
  if (!(await forumFeedsOpen())) return forumFeedNotFound();
  const team = await feedTeam(params.teamId);
  if (!team) return forumFeedNotFound();
  const path = `/teams/${teamSlug(team)}`;
  return forumAtomResponse({
    teamId: team.id,
    title: `${team.name} — devlog`,
    subtitle: `Devlogs from ${team.name} on the Brackeys community forum.`,
    selfPath: `${path}/devlog.xml`,
    alternatePath: path,
  });
}

const reportedHandle = withErrorReporting("/teams/$teamId/devlog.xml", handle);

export const Route = createFileRoute("/teams_/$teamId/devlog.xml")({
  server: { handlers: { HEAD: reportedHandle, GET: reportedHandle } },
});
