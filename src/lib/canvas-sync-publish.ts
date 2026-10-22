import { and, eq, isNull } from "drizzle-orm";
import type IORedis from "ioredis";

import { db } from "@/db";
import { canvases } from "@/db/schema";
import { SYNC_LIMITS } from "@/lib/canvas/limits";
import {
  applyChannel,
  type ApplyMessage,
  REVOKE_CLOCK_SKEW_MS,
  revokeChannel,
  type RevokeMessage,
  sendRevoke,
  syncEnvPrefix,
} from "@/lib/canvas/sync-channels";
import { bestEffort } from "@/lib/posthog-server";
import { createRedisClient } from "@/lib/redis";

/**
 * The web app's side of live canvases: tell `canvas-sync` when access
 * changes (close those sockets now) and when a server-side write changed a
 * canvas's stored state (load it into the live doc). Best-effort: with
 * Redis down a revoked member keeps their socket until it next reconnects,
 * when the token mint refuses them.
 */

declare global {
  // eslint-disable-next-line no-var
  var __appCanvasSyncPublisher: Promise<IORedis> | undefined;
}

const READY_TIMEOUT_MS = 2_000;

async function publisher(): Promise<IORedis> {
  globalThis.__appCanvasSyncPublisher ??= createRedisClient("canvas-sync-publish").catch(
    (error: unknown) => {
      globalThis.__appCanvasSyncPublisher = undefined;
      throw error;
    },
  );
  const client = await globalThis.__appCanvasSyncPublisher;
  // The offline queue is off, so a publish on a client still connecting
  // would be dropped; the first revoke after a boot must not be.
  if (client.status !== "ready") {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Redis not ready")), READY_TIMEOUT_MS);
      client.once("ready", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  return client;
}

function prefix(): string {
  return syncEnvPrefix(process.env.RAILWAY_ENVIRONMENT_NAME);
}

async function publish(channel: string, message: RevokeMessage | ApplyMessage): Promise<void> {
  if (!process.env.REDIS_URL) return;
  await bestEffort("canvas_sync.publish", { channel }, async () => {
    await (await publisher()).publish(channel, JSON.stringify(message));
  });
}

/** As long as a token minted before a revoke could still be presented. */
const TOMBSTONE_TTL_MS = SYNC_LIMITS.tokenTtlMs + REVOKE_CLOCK_SKEW_MS;

/**
 * Closes live sockets: one person's on a canvas, everyone's on it, or one
 * person's everywhere. The tombstone covers an instance that starts after
 * the publish, which would otherwise accept a token minted before it.
 */
export async function publishCanvasRevoke(message: RevokeMessage): Promise<void> {
  if (!process.env.REDIS_URL) return;
  const channel = revokeChannel(prefix());
  await bestEffort("canvas_sync.publish", { channel }, async () => {
    await sendRevoke(await publisher(), prefix(), message, TOMBSTONE_TTL_MS);
  });
}

/** The stored state changed outside the service; connected editors should see it. */
export async function publishCanvasApply(canvasId: string): Promise<void> {
  await publish(applyChannel(prefix()), { canvasId });
}

/** A team's canvases that can be open right now. Read before a delete that cascades them away. */
export async function liveTeamCanvasIds(teamId: string): Promise<string[]> {
  const rows = await bestEffort("canvas_sync.team_canvases", { team_id: teamId }, () =>
    db
      .select({ id: canvases.id })
      .from(canvases)
      .where(and(eq(canvases.teamId, teamId), isNull(canvases.deletedAt))),
  );
  return (rows ?? []).map((row) => row.id);
}

/** `userId` closes one person's sockets on each canvas, none closes everyone's. */
export async function revokeCanvases(canvasIds: string[], userId?: string): Promise<void> {
  for (const canvasId of canvasIds) {
    await publishCanvasRevoke(userId ? { canvasId, userId } : { canvasId });
  }
}

/**
 * Every live canvas of a team: `userId` when one member left or was
 * removed, none when the team was archived or hidden.
 */
export async function revokeTeamCanvases(teamId: string, userId?: string): Promise<void> {
  await revokeCanvases(await liveTeamCanvasIds(teamId), userId);
}
