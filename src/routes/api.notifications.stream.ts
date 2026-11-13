import "@/polyfill";
import { createFileRoute } from "@tanstack/react-router";

import { subscribeOnReady } from "@/lib/live-broadcast";
import { bestEffort, withErrorReporting } from "@/lib/posthog-server";
import {
  presenceChannel,
  refreshConnection,
  registerConnection,
  unregisterConnection,
} from "@/lib/presence";
import { createRedisClient } from "@/lib/redis";
import { readRouteSession } from "@/lib/route-session";
import { sseResponse } from "@/lib/sse";

async function handle({ request }: { request: Request }) {
  const session = await readRouteSession(request, "notifications_stream.session_read");
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const userId = session.user.id;
  const connectionId =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;

  // One subscriber socket per SSE connection, opened only when a client
  // actually connects to /api/notifications/stream.
  const subscriber = await createRedisClient("sse-subscriber");
  const channel = presenceChannel(userId);

  return sseResponse(request, {
    onHeartbeat: () => void refreshConnection(userId, connectionId).catch(() => {}),
    async subscribe(_send, sendRaw) {
      // Presence and pub/sub are best-effort: with Redis down the stream
      // stays open for heartbeats (the inbox still polls), it just loses
      // live push until the socket comes back.
      await bestEffort("notifications_stream.register", { user_id: userId }, () =>
        registerConnection(userId, connectionId),
      );

      // Each payload is already the event's JSON; the client parses it.
      subscriber.on("message", (_channel, message) => sendRaw("notification", message));
      const stopSubscribing = subscribeOnReady(subscriber, channel, (err) => {
        console.warn("[notifications_stream.subscribe] deferred to reconnect", {
          user_id: userId,
          err,
        });
      });

      return () => {
        stopSubscribing();
        void (async () => {
          await subscriber.unsubscribe(channel).catch(() => {});
          await subscriber.quit().catch(() => {});
          await unregisterConnection(userId, connectionId).catch(() => {});
        })();
      };
    },
  });
}

/** Reports an unhandled throw before it becomes an opaque 500. */
const reportedHandle = withErrorReporting("/api/notifications/stream", handle);

export const Route = createFileRoute("/api/notifications/stream")({
  server: {
    handlers: {
      GET: reportedHandle,
    },
  },
});
