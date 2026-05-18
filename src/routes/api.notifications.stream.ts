import "@/polyfill";
import { createFileRoute } from "@tanstack/react-router";

import { auth } from "@/lib/auth";
import {
  presenceChannel,
  refreshConnection,
  registerConnection,
  unregisterConnection,
} from "@/lib/presence";

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

  // Dynamic import keeps ioredis out of the SSR static graph (mirrors the
  // queue setup) and only opens a subscriber socket when a client actually
  // connects to /api/notifications/stream.
  const { default: IORedisCtor } = await import("ioredis");
  const subscriber = new IORedisCtor(process.env.REDIS_URL!, {
    maxRetriesPerRequest: null,
  });

  const channel = presenceChannel(userId);
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // Stream already closed — swallow so the listener cleanup runs once.
        }
      };

      await registerConnection(userId, connectionId);

      subscriber.on("message", (_channel, message) => {
        // Each payload is a single SSE `data:` event; the client parses it.
        send(`event: notification\ndata: ${message}\n\n`);
      });
      await subscriber.subscribe(channel);

      // Initial comment so the client immediately knows the stream is open
      // (many EventSource impls don't fire `onopen` until a first byte).
      send(`: connected ${connectionId}\n\n`);

      heartbeat = setInterval(() => {
        send(`: ping\n\n`);
        void refreshConnection(userId, connectionId);
      }, HEARTBEAT_MS);
    },
    async cancel() {
      if (heartbeat) clearInterval(heartbeat);
      try {
        await subscriber.unsubscribe(channel);
      } catch {
        // ignore
      }
      await subscriber.quit().catch(() => {});
      await unregisterConnection(userId, connectionId).catch(() => {});
    },
  });

  // If the client aborts, the ReadableStream's cancel runs — we also
  // close on `request.signal` for fast cleanup behind proxies that don't
  // surface the cancel promptly.
  request.signal?.addEventListener("abort", () => {
    void stream.cancel();
  });

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

export const Route = createFileRoute("/api/notifications/stream")({
  server: {
    handlers: {
      GET: handle,
    },
  },
});
