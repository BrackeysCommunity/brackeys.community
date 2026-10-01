import { os } from "@orpc/server";

import { ANONYMOUS_FLAG_DISTINCT_ID, getServerFlags } from "@/lib/posthog-server";
import { authMiddleware } from "@/orpc/middleware/auth";

/**
 * The viewer's flags as the server sees them, bootstrapped into the root
 * loader so `useFlag` has a real answer when the browser never loads
 * PostHog (Global Privacy Control, an ad blocker).
 */
export const getFeatureFlags = os
  .use(authMiddleware)
  .handler(({ context }) => getServerFlags(context.user?.id ?? ANONYMOUS_FLAG_DISTINCT_ID));
