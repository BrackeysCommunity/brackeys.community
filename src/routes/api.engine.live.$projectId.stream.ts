import "@/polyfill";
import { createFileRoute } from "@tanstack/react-router";

import { auth } from "@/lib/auth";
import { isActiveBan } from "@/lib/ban-state";
import { resolvePlay } from "@/lib/engine/game-play";
import { engineGamesOpen } from "@/lib/engine/guard-server";
import { LIVE_STREAM_MINUTES } from "@/lib/engine/limits";
import { engineLive } from "@/lib/engine/live-events";
import { isEngineProjectId } from "@/lib/engine/projects";
import { releaseChannel, type ReleaseChannel } from "@/lib/engine/release-access";
import { viewerOf } from "@/lib/engine/viewer";
import { captureServerException, withErrorReporting } from "@/lib/posthog-server";
import { sseResponse } from "@/lib/sse";

const notFound = () => new Response("Not found", { status: 404 });

/** The play page's version name for a channel, so the stream admits whoever that page admits. */
const PLAY_VERSION: Record<ReleaseChannel, string> = {
  production: "latest",
  preview: "preview",
};

/**
 * One channel's moves for a hosted game: an `event: live` with
 * `{"channel","rev"}` each time its release or a scene pointer moves, so
 * the play page refetches. The gate is the play page's: a staff session,
 * then `engine-games-enabled` and the production guard, then whoever
 * `resolvePlay` lets play that channel. Every refusal is the same 404.
 */
async function handle({ request, params }: { request: Request; params: { projectId: string } }) {
  const { projectId } = params;
  const parsed = releaseChannel.safeParse(new URL(request.url).searchParams.get("channel"));
  if (!parsed.success || !isEngineProjectId(projectId)) return notFound();
  const channel = parsed.data;

  const session = await auth.api.getSession({ headers: request.headers }).catch((err: unknown) => {
    captureServerException(err, { scope: "engine_live_stream.session_read" });
    return null;
  });
  const userId = session?.user && !isActiveBan(session.user) ? session.user.id : null;
  if (!(await engineGamesOpen(userId))) return notFound();

  const viewer = await viewerOf(userId, projectId);
  if (!viewer.staff) return notFound();
  const play = await resolvePlay({ projectId, version: PLAY_VERSION[channel], viewer });
  if (!play.ok) return notFound();

  return sseResponse(request, {
    maxMs: LIVE_STREAM_MINUTES * 60_000,
    subscribe: (send) =>
      engineLive.listen((event) => {
        if (event.projectId !== projectId || event.channel !== channel) return;
        send("live", { channel: event.channel, rev: event.rev });
      }),
  });
}

const reportedHandle = withErrorReporting("/api/engine/live/$projectId/stream", handle);

export const Route = createFileRoute("/api/engine/live/$projectId/stream")({
  server: {
    handlers: {
      GET: reportedHandle,
    },
  },
});
