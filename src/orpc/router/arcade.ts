import { os } from "@orpc/server";

import { ANONYMOUS_FLAG_DISTINCT_ID, isServerFlagEnabled } from "@/lib/posthog-server";
import { authMiddleware } from "@/orpc/middleware/auth";

/**
 * The server half of the arcade flags, which the `/arcade` loaders gate on.
 * The arcade has no other server surface, so without this a browser that
 * blocks PostHog would reach every game.
 */
export const getArcadeAccess = os.use(authMiddleware).handler(async ({ context }) => {
  const distinctId = context.user?.id ?? ANONYMOUS_FLAG_DISTINCT_ID;
  const [arcade, enPrison] = await Promise.all([
    isServerFlagEnabled("arcade-enabled", distinctId),
    isServerFlagEnabled("arcade-en-prison", distinctId),
  ]);
  return { arcade, enPrison: arcade && enPrison };
});
