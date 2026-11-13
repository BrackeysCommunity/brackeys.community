import { createBroadcast } from "@/lib/live-broadcast";
import { sseResponse } from "@/lib/sse";

import { LIVE_STREAM_MINUTES } from "./limits";
import { releaseChannel, type ReleaseChannel } from "./release-access";

/** A move on a channel's live state: its release or a scene pointer. Play pages refetch when `rev` grows. */
export type EngineLiveEvent = { projectId: string; channel: ReleaseChannel; rev: number };

/** An announcement as it arrives over Redis, or null when it isn't one. */
export function parseEngineLiveEvent(raw: unknown): EngineLiveEvent | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { projectId, channel, rev } = raw as Record<string, unknown>;
  if (typeof projectId !== "string" || projectId === "") return null;
  const named = releaseChannel.safeParse(channel);
  if (!named.success) return null;
  if (typeof rev !== "number" || !Number.isSafeInteger(rev) || rev < 0) return null;
  return { projectId, channel: named.data, rev };
}

/** Every channel move of every hosted game; the live stream filters it per project and channel. */
export const engineLive = createBroadcast<EngineLiveEvent>({
  name: "engine-live",
  channel: "engine:live",
  parse: parseEngineLiveEvent,
  localWithoutRedis: true,
});

/**
 * One channel's moves as server-sent events, for a caller already let in:
 * an `event: live` with `{"channel","rev"}` each time its release or a scene
 * pointer moves, closed after `LIVE_STREAM_MINUTES` (`EventSource` reconnects).
 */
export function liveStreamResponse(
  request: Request,
  projectId: string,
  channel: ReleaseChannel,
): Response {
  return sseResponse(request, {
    maxMs: LIVE_STREAM_MINUTES * 60_000,
    subscribe: (send) =>
      engineLive.listen((event) => {
        if (event.projectId !== projectId || event.channel !== channel) return;
        send("live", { channel: event.channel, rev: event.rev });
      }),
  });
}
