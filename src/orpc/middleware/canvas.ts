import { ORPCError } from "@orpc/client";
import { os } from "@orpc/server";

import { isActiveBan } from "@/lib/ban-state";
import { ANONYMOUS_FLAG_DISTINCT_ID, isServerFlagEnabled } from "@/lib/posthog-server";
import { BANNED_MESSAGE, readSession } from "@/orpc/middleware/auth";

/**
 * The server half of the `canvases-enabled` flag: every canvas procedure,
 * reads included, answers NOT_FOUND while it's off for the caller.
 */
async function assertCanvasesEnabled(userId: string | null): Promise<void> {
  if (!(await isServerFlagEnabled("canvases-enabled", userId ?? ANONYMOUS_FLAG_DISTINCT_ID))) {
    throw new ORPCError("NOT_FOUND", { message: "Not found." });
  }
}

/** Canvas reads: open to everyone, a banned session reads as anonymous. */
export const canvasRead = os.middleware(async ({ context, next }) => {
  let session = await readSession(context);
  if (session && isActiveBan(session.user)) session = null;
  await assertCanvasesEnabled(session?.user.id ?? null);

  return next({ context: { session, user: session?.user ?? null } });
});

/**
 * Signed in and not banned. The guild bar isn't here: on an existing canvas
 * it's part of `canvasAccess` (a non-member's write drops to read), and
 * `createCanvas` checks it itself.
 */
export const canvasSignedIn = os.middleware(async ({ context, next }) => {
  const session = await readSession(context);
  await assertCanvasesEnabled(session?.user.id ?? null);

  if (!session) {
    throw new ORPCError("UNAUTHORIZED", { message: "Authentication required." });
  }
  if (isActiveBan(session.user)) {
    throw new ORPCError("FORBIDDEN", { message: BANNED_MESSAGE });
  }

  return next({ context: { session, user: session.user } });
});
