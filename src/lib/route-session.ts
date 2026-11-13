import { auth } from "@/lib/auth";
import { isActiveBan } from "@/lib/ban-state";
import { captureServerException } from "@/lib/posthog-server";

/**
 * The session for a handler outside the oRPC middleware chain, read as
 * `authMiddleware` reads it: a banned user is signed out. A failed read is
 * reported under `scope` before it degrades to signed out, so an auth outage
 * doesn't pass for a surge of signed-out visitors.
 */
export async function readRouteSession(request: Request, scope: string) {
  const session = await auth.api.getSession({ headers: request.headers }).catch((err: unknown) => {
    captureServerException(err, { scope });
    return null;
  });
  if (!session || isActiveBan(session.user)) return null;
  return session;
}
