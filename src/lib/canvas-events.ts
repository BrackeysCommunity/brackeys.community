import type IORedis from "ioredis";

import { publishCanvasRevoke } from "@/lib/canvas-sync-publish";
import { type CanvasEvent, revokesFor } from "@/lib/canvas/revokes";
import { bestEffort } from "@/lib/posthog-server";
import { createRedisClient } from "@/lib/redis";

/**
 * Every change to who can reach a canvas is announced here, once, after its
 * write commits. In-process listeners hear it first; then it goes out on the
 * `canvas:events` Redis channel, which is the seam the vault sync feed
 * subscribes to (the way `/api/forum/stream` follows `forum-live`). Until
 * that feed exists nothing outside this process listens, and that is fine:
 * the canvas rows already carry the new state and a bumped `updatedAt`.
 */

const CHANNEL = "canvas:events";

export type {
  CanvasEvent,
  CanvasEventScope,
  CanvasMemberRole,
  CanvasRevoke,
} from "@/lib/canvas/revokes";
export { revokesFor } from "@/lib/canvas/revokes";

declare global {
  // eslint-disable-next-line no-var
  var __appCanvasEventsPublisher: IORedis | undefined;
  // eslint-disable-next-line no-var
  var __appCanvasEventListeners: Set<(event: CanvasEvent) => void> | undefined;
}

function listeners(): Set<(event: CanvasEvent) => void> {
  globalThis.__appCanvasEventListeners ??= new Set();
  return globalThis.__appCanvasEventListeners;
}

async function publisher(): Promise<IORedis> {
  globalThis.__appCanvasEventsPublisher ??= await createRedisClient("canvas-events");
  return globalThis.__appCanvasEventsPublisher;
}

/** Listen on this instance; returns the unsubscribe. */
export function onCanvasEvent(listener: (event: CanvasEvent) => void): () => void {
  listeners().add(listener);
  return () => {
    listeners().delete(listener);
  };
}

/**
 * Never throws: the change it describes has already landed, so a listener
 * or Redis failing must not turn it into an error for the caller.
 */
export async function emitCanvasEvent(event: CanvasEvent): Promise<void> {
  for (const listener of listeners()) {
    try {
      listener(event);
    } catch (error) {
      console.error("[canvas-events] listener failed", error);
    }
  }
  for (const revoke of revokesFor(event)) await publishCanvasRevoke(revoke);
  if (!process.env.REDIS_URL) return;
  await bestEffort(
    "canvas_events.publish",
    { canvas_id: event.canvasId, type: event.type },
    async () => {
      await (await publisher()).publish(CHANNEL, JSON.stringify(event));
    },
  );
}
