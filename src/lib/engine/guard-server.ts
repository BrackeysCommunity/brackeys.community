import { ORPCError } from "@orpc/client";

import { ANONYMOUS_FLAG_DISTINCT_ID, isServerFlagEnabled } from "@/lib/posthog-server";

import { engineGamesAllowed } from "./guard";

/** The deployment allows games and the caller's `engine-games-enabled` flag is on; signed-out callers share one id. */
export async function engineGamesOpen(userId: string | null): Promise<boolean> {
  if (!engineGamesAllowed()) return false;
  return isServerFlagEnabled("engine-games-enabled", userId ?? ANONYMOUS_FLAG_DISTINCT_ID);
}

/** Refuses as NOT_FOUND unless `engineGamesOpen`, so a closed site reads as one without games. */
export async function assertEngineGames(ctx: { userId: string | null }): Promise<void> {
  if (!(await engineGamesOpen(ctx.userId))) {
    throw new ORPCError("NOT_FOUND", { message: "Not found." });
  }
}
