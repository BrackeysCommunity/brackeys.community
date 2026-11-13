import "@/polyfill";
import { createFileRoute } from "@tanstack/react-router";

import { resolveChannelPlay } from "@/lib/engine/game-play";
import { engineGamesOpen } from "@/lib/engine/guard-server";
import { liveStreamResponse } from "@/lib/engine/live-events";
import { isEngineProjectId } from "@/lib/engine/projects";
import { releaseChannel } from "@/lib/engine/release-access";
import { viewerOf } from "@/lib/engine/viewer";
import { withErrorReporting } from "@/lib/posthog-server";
import { readRouteSession } from "@/lib/route-session";

const notFound = () => new Response("Not found", { status: 404 });

/**
 * One channel's moves for a hosted game, as `liveStreamResponse` sends
 * them. The gate is the play page's: a staff session, then
 * `engine-games-enabled` and the production guard, then whoever
 * `resolveChannelPlay` lets play that channel. Every refusal is the same 404.
 */
async function handle({ request, params }: { request: Request; params: { projectId: string } }) {
  const { projectId } = params;
  const parsed = releaseChannel.safeParse(new URL(request.url).searchParams.get("channel"));
  if (!parsed.success || !isEngineProjectId(projectId)) return notFound();
  const channel = parsed.data;

  const session = await readRouteSession(request, "engine_live_stream.session_read");
  const userId = session?.user.id ?? null;
  if (!(await engineGamesOpen(userId))) return notFound();

  const viewer = await viewerOf(userId, projectId);
  if (!viewer.staff) return notFound();
  const play = await resolveChannelPlay({ projectId, channel, viewer });
  if (!play.ok) return notFound();

  return liveStreamResponse(request, projectId, channel);
}

const reportedHandle = withErrorReporting("/api/engine/live/$projectId/stream", handle);

export const Route = createFileRoute("/api/engine/live/$projectId/stream")({
  server: {
    handlers: {
      GET: reportedHandle,
    },
  },
});
