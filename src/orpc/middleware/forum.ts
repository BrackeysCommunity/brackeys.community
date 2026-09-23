import { ORPCError } from "@orpc/client";
import { os } from "@orpc/server";

import { isActiveBan } from "@/lib/ban-state";
import { ANONYMOUS_FLAG_DISTINCT_ID, isServerFlagEnabled } from "@/lib/posthog-server";
import {
  BANNED_MESSAGE,
  NOT_GUILD_MEMBER_MESSAGE,
  readSession,
  userIsGuildMember,
} from "@/orpc/middleware/auth";

/**
 * The server half of the `forum-enabled` flag. `useFlagBlocks` hides the
 * pages, but a browser that blocks PostHog would get past that, so every
 * forum procedure — reads included — answers NOT_FOUND while the flag is
 * off for the caller. Signed-out callers share one anonymous distinct id.
 */
async function assertForumEnabled(userId: string | null): Promise<void> {
  if (!(await isServerFlagEnabled("forum-enabled", userId ?? ANONYMOUS_FLAG_DISTINCT_ID))) {
    throw new ORPCError("NOT_FOUND", { message: "Not found." });
  }
}

/** Forum reads: open to everyone, a banned session reads as anonymous. */
export const forumRead = os.middleware(async ({ context, next }) => {
  let session = await readSession(context);
  if (session && isActiveBan(session.user)) session = null;
  await assertForumEnabled(session?.user.id ?? null);

  return next({ context: { session, user: session?.user ?? null } });
});

/**
 * Forum writes: the flag first (so a dark forum never answers FORBIDDEN),
 * then the same bar as `requireGuildMember` — signed in, not banned, in
 * the Brackeys Discord. One session read for all three.
 */
export const forumWrite = os.middleware(async ({ context, next }) => {
  const session = await readSession(context);
  await assertForumEnabled(session?.user.id ?? null);

  if (!session) {
    throw new ORPCError("UNAUTHORIZED", { message: "Authentication required." });
  }
  if (isActiveBan(session.user)) {
    throw new ORPCError("FORBIDDEN", { message: BANNED_MESSAGE });
  }
  if (!(await userIsGuildMember(session.user.id))) {
    throw new ORPCError("FORBIDDEN", { message: NOT_GUILD_MEMBER_MESSAGE });
  }

  return next({ context: { session, user: session.user } });
});
