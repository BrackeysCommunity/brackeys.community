import "@/polyfill";
import { createFileRoute } from "@tanstack/react-router";

import { auth } from "@/lib/auth";
import { withErrorReporting } from "@/lib/posthog-server";
import {
  presenceChannel,
  refreshConnection,
  registerConnection,
  unregisterConnection,
} from "@/lib/presence";
import { createRedisClient } from "@/lib/redis";

const HEARTBEAT_MS = 25_000;

async function handle({ request }: { request: Request }) {
  const session = await auth.api.getSession({ headers: request.headers }).catch(() => null);

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
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;

  const cleanup = async () => {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    try {
      controllerRef?.close();
    } catch {
      // Already closed or errored by the adapter.
    }
    try {
      await subscriber.unsubscribe(channel);
    } catch {
      // ignore
    }
    await subscriber.quit().catch(() => {});
    await unregisterConnection(userId, connectionId).catch(() => {});
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controllerRef = controller;
      const encoder = new TextEncoder();
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // Stream already closed — swallow so the listener cleanup runs once.
        }
      };

      // Presence and pub/sub are best-effort: with Redis down the stream
      // stays open for heartbeats (the inbox still polls), it just loses
      // live push until the client reconnects.
      await registerConnection(userId, connectionId).catch(() => {});

      subscriber.on("message", (_channel, message) => {
        // Each payload is a single SSE `data:` event; the client parses it.
        send(`event: notification\ndata: ${message}\n\n`);
      });
      await subscriber.subscribe(channel).catch(() => {});

      // Initial comment so the client immediately knows the stream is open
      // (many EventSource impls don't fire `onopen` until a first byte).
      send(`: connected ${connectionId}\n\n`);

      heartbeat = setInterval(() => {
        send(`: ping\n\n`);
        refreshConnection(userId, connectionId).catch(() => {});
      }, HEARTBEAT_MS);
    },
    async cancel() {
      await cleanup();
    },
  });

  // If the client aborts, the ReadableStream's cancel runs — we also listen
  // on `request.signal` for fast cleanup behind proxies that don't surface
  // the cancel promptly. The stream is locked to the adapter's reader by
  // then, so tear down the subscriber directly rather than cancelling it.
  request.signal?.addEventListener(
    "abort",
    () => {
      void cleanup();
    },
    { once: true },
  );

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Disable proxy buffering (nginx-style) so events flush immediately.
      "X-Accel-Buffering": "no",
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
