export type SseOptions = {
  /**
   * Starts the events; answers the unsubscribe, called once when the stream
   * ends. `send` writes `data` as JSON; `sendRaw` writes text that already is
   * the event's data, such as a JSON message off a Redis channel.
   */
  subscribe(
    send: (event: string, data: unknown) => void,
    sendRaw: (event: string, data: string) => void,
  ): Promise<() => void>;
  /** A `: ping` comment this often; default 25 seconds. */
  heartbeatMs?: number;
  /** Runs with every ping, such as to keep a presence key alive. */
  onHeartbeat?: () => void;
  /** Closes the stream after this long; no limit unless given. */
  maxMs?: number;
};

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
} as const;

/** One `data:` line per line of text, so a line break can't end the event early. */
const dataLines = (data: string): string =>
  data
    .split(/\r\n|\r|\n/)
    .map((line) => `data: ${line}`)
    .join("\n");

/**
 * A `text/event-stream` answer that ends with the request: `: connected`
 * once subscribed, a `: ping` every heartbeat, an optional lifetime
 * (`EventSource` reconnects by itself), and one cleanup on close, cancel or
 * abort.
 */
export function sseResponse(request: Request, opts: SseOptions): Response {
  const { heartbeatMs = 25_000, maxMs, onHeartbeat } = opts;
  const encoder = new TextEncoder();
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let lifetime: ReturnType<typeof setTimeout> | null = null;
  let unsubscribe: (() => void) | null = null;
  let closed = false;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    if (lifetime) clearTimeout(lifetime);
    request.signal?.removeEventListener("abort", cleanup);
    unsubscribe?.();
    unsubscribe = null;
    try {
      controllerRef?.close();
    } catch {
      // Already closed or cancelled by the adapter.
    }
  };

  const write = (chunk: string) => {
    if (closed || !controllerRef) return;
    try {
      controllerRef.enqueue(encoder.encode(chunk));
    } catch {
      // Closed underneath us; cleanup runs once from cancel or abort.
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controllerRef = controller;
      if (closed) {
        controller.close();
        return;
      }
      let stop: () => void;
      try {
        stop = await opts.subscribe(
          (event, data) => write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          (event, data) => write(`event: ${event}\n${dataLines(data)}\n\n`),
        );
      } catch (err) {
        console.warn("[sse] subscribe failed", err);
        cleanup();
        return;
      }
      if (closed) {
        stop();
        return;
      }
      unsubscribe = stop;
      write(`: connected\n\n`);
      heartbeat = setInterval(() => {
        write(`: ping\n\n`);
        try {
          onHeartbeat?.();
        } catch (err) {
          console.warn("[sse] heartbeat hook failed", err);
        }
      }, heartbeatMs);
      if (maxMs !== undefined) lifetime = setTimeout(cleanup, maxMs);
    },
    cancel() {
      cleanup();
    },
  });

  if (request.signal?.aborted) cleanup();
  else request.signal?.addEventListener("abort", cleanup, { once: true });

  return new Response(stream, { status: 200, headers: SSE_HEADERS });
}
