import "@/polyfill";
import { createFileRoute } from "@tanstack/react-router";

import { auth } from "@/lib/auth";
import { isActiveBan } from "@/lib/ban-state";
import { onForumPost } from "@/lib/forum-live";
import {
  ANONYMOUS_FLAG_DISTINCT_ID,
  captureServerException,
  isServerFlagEnabled,
  withErrorReporting,
} from "@/lib/posthog-server";

const HEARTBEAT_MS = 25_000;

/**
 * The forum's live channel: one `post` event per newly published post, for
 * the feed's "N new posts" pill. Dark with the forum — a reader the flag is
 * off for gets the same 404 as every other forum surface.
 */
async function handle({ request }: { request: Request }) {
  const session = await auth.api.getSession({ headers: request.headers }).catch((err: unknown) => {
    captureServerException(err, { scope: "forum_stream.session_read" });
    return null;
  });
  const userId = session?.user && !isActiveBan(session.user) ? session.user.id : null;
  if (!(await isServerFlagEnabled("forum-enabled", userId ?? ANONYMOUS_FLAG_DISTINCT_ID))) {
    return new Response("Not found", { status: 404 });
  }

  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let unsubscribe: (() => void) | null = null;
  let closed = false;
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    unsubscribe?.();
    try {
      controllerRef?.close();
    } catch {
      // Already closed by the adapter.
    }
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
          // Closed underneath us; cleanup runs once from cancel/abort.
        }
      };
      unsubscribe = await onForumPost((event) => {
        send(`event: post\ndata: ${JSON.stringify(event)}\n\n`);
      });
      send(`: connected\n\n`);
      heartbeat = setInterval(() => send(`: ping\n\n`), HEARTBEAT_MS);
    },
    cancel() {
      cleanup();
    },
  });

  request.signal?.addEventListener("abort", cleanup, { once: true });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

const reportedHandle = withErrorReporting("/api/forum/stream", handle);

export const Route = createFileRoute("/api/forum/stream")({
  server: {
    handlers: {
      GET: reportedHandle,
    },
  },
});
