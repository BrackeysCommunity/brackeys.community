import "@/polyfill";
import { createFileRoute } from "@tanstack/react-router";

import { auth } from "@/lib/auth";
import { bestEffort, captureServerException, withErrorReporting } from "@/lib/posthog-server";
import {
  presenceChannel,
  refreshConnection,
  registerConnection,
  unregisterConnection,
} from "@/lib/presence";
import { createRedisClient } from "@/lib/redis";
import { sseResponse } from "@/lib/sse";

async function handle({ request }: { request: Request }) {
  // Reported before degrading to a 401: an auth outage would otherwise read
  // as a surge of logged-out traffic.
  const session = await auth.api.getSession({ headers: request.headers }).catch((err: unknown) => {
    captureServerException(err, { scope: "notifications_stream.session_read" });
    return null;
  });

  if (!session?.user) {
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
      let closed = false;
      // Presence and pub/sub are best-effort: with Redis down the stream
      // stays open for heartbeats (the inbox still polls), it just loses
      // live push until the socket comes back.
      await bestEffort("notifications_stream.register", { user_id: userId }, () =>
        registerConnection(userId, connectionId),
      );

      // Each payload is already the event's JSON; the client parses it.
      subscriber.on("message", (_channel, message) => sendRaw("notification", message));
      // Subscribe on every `ready`, not once up front: with the offline
      // queue off, a subscribe issued while the socket is still connecting
      // rejects, and ioredis only re-subscribes channels that had already
      // succeeded. Re-issuing on (re)connect is what lets the session
      // recover; the client's own error handler reports the outage.
      const subscribe = () => {
        if (closed) return;
        subscriber.subscribe(channel).catch((err: unknown) => {
          console.warn("[notifications_stream.subscribe] deferred to reconnect", {
            user_id: userId,
            err,
          });
        });
      };
      subscriber.on("ready", subscribe);
      if (subscriber.status === "ready") subscribe();

      return () => {
        closed = true;
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
