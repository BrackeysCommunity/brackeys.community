import { ORPCError } from "@orpc/client";
import { os } from "@orpc/server";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { developerProfiles } from "@/db/schema";
import { auth } from "@/lib/auth";
import {
  isStaffMember as checkIsStaff,
  isAdmin as checkIsAdmin,
  isGuildMember,
} from "@/lib/discord";
import { refreshGuildRolesThrottled } from "@/lib/guild-sync";
import { resolveUserRoles } from "@/lib/staff-roles";

type SessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

async function readSession(context: unknown): Promise<SessionResult | null> {
  try {
    return await auth.api.getSession({
      headers: (context as { headers: Headers }).headers,
    });
  } catch {
    // Unauthenticated requests (no cookies) may throw — treat as anonymous
    return null;
  }
}

function isBanned(session: SessionResult | null): boolean {
  return session?.user.bannedAt != null;
}

const BANNED_MESSAGE = "Your account has been suspended.";

/**
 * A banned user's session resolves as anonymous for public reads and is
 * refused outright by every `require*` middleware — one choke point that
 * covers all writes, since every mutation chains through these.
 */
function assertNotBanned(session: NonNullable<SessionResult>): void {
  if (session.user.bannedAt != null) {
    throw new ORPCError("FORBIDDEN", { message: BANNED_MESSAGE });
  }
}

export const authMiddleware = os.middleware(async ({ context, next }) => {
  let session = await readSession(context);
  if (isBanned(session)) session = null;

  return next({
    context: {
      session,
      user: session?.user ?? null,
    },
  });
});

export const requireAuth = os.middleware(async ({ context, next }) => {
  const session = await readSession(context);

  if (!session) {
    throw new ORPCError("UNAUTHORIZED", { message: "Authentication required." });
  }
  assertNotBanned(session);

  return next({
    context: {
      session,
      user: session.user,
    },
  });
});

/**
 * The guild bar as a predicate, for handlers that vary a payload by it
 * rather than refusing the call outright (the gated contact block on
 * `getPostViewerState`).
 */
export async function userIsGuildMember(userId: string): Promise<boolean> {
  const [profile] = await db
    .select({ discordId: developerProfiles.discordId })
    .from(developerProfiles)
    .where(eq(developerProfiles.id, userId))
    .limit(1);

  return profile?.discordId ? await isGuildMember(profile.discordId) : false;
}

/** Requires auth + verifies the user is a member of the Brackeys Discord server. */
export const requireGuildMember = os.middleware(async ({ context, next }) => {
  const session = await readSession(context);

  if (!session) {
    throw new ORPCError("UNAUTHORIZED", { message: "Authentication required." });
  }
  assertNotBanned(session);

  if (!(await userIsGuildMember(session.user.id))) {
    throw new ORPCError("FORBIDDEN", {
      message: "You must be a member of the Brackeys Discord server to perform this action.",
    });
  }

  return next({
    context: {
      session,
      user: session.user,
    },
  });
});

/** Requires auth + enriches context with isStaff/isAdmin booleans. */
export const requireAuthWithPermissions = os.middleware(async ({ context, next }) => {
  const session = await readSession(context);

  if (!session) {
    throw new ORPCError("UNAUTHORIZED", { message: "Authentication required." });
  }
  assertNotBanned(session);

  const guildRoles = await resolveUserRoles(session.user.id);
  const isStaff = checkIsStaff(guildRoles);

  if (isStaff) {
    void refreshGuildRolesThrottled(session.user.id);
  }

  return next({
    context: {
      session,
      user: session.user,
      isStaff,
      isAdmin: checkIsAdmin(guildRoles),
    },
  });
});

export const requireStaff = os.middleware(async ({ context, next }) => {
  const session = await readSession(context);

  if (!session) {
    throw new ORPCError("UNAUTHORIZED", { message: "Authentication required." });
  }
  assertNotBanned(session);

  const guildRoles = await resolveUserRoles(session.user.id);

  if (!checkIsStaff(guildRoles)) {
    throw new ORPCError("FORBIDDEN", { message: "Staff access required." });
  }

  // Cached roles are only as fresh as the last sign-in; a throttled
  // background re-fetch bounds how long a Discord demotion goes unnoticed.
  // Deliberately not awaited — staff routes never wait on discord.com.
  void refreshGuildRolesThrottled(session.user.id);

  return next({
    context: {
      session,
      user: session.user,
      isStaff: true as const,
      isAdmin: checkIsAdmin(guildRoles),
    },
  });
});

export const requireAdmin = os.middleware(async ({ context, next }) => {
  const session = await readSession(context);

  if (!session) {
    throw new ORPCError("UNAUTHORIZED", { message: "Authentication required." });
  }
  assertNotBanned(session);

  const guildRoles = await resolveUserRoles(session.user.id);

  if (!checkIsAdmin(guildRoles)) {
    throw new ORPCError("FORBIDDEN", { message: "Admin access required." });
  }

  void refreshGuildRolesThrottled(session.user.id);

  return next({
    context: {
      session,
      user: session.user,
      isStaff: true as const,
      isAdmin: true as const,
    },
  });
});
