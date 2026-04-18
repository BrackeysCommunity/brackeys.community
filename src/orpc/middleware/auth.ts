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

export const authMiddleware = os.middleware(async ({ context, next }) => {
  let session: Awaited<ReturnType<typeof auth.api.getSession>> | null = null;
  try {
    session = await auth.api.getSession({
      headers: (context as { headers: Headers }).headers,
    });
  } catch {
    // Unauthenticated requests (no cookies) may throw — pass through with null
  }

  return next({
    context: {
      session,
      user: session?.user ?? null,
    },
  });
});

export const requireAuth = os.middleware(async ({ context, next }) => {
  let session: Awaited<ReturnType<typeof auth.api.getSession>> | null = null;
  try {
    session = await auth.api.getSession({
      headers: (context as { headers: Headers }).headers,
    });
  } catch {
    // getSession may throw when no cookies are present
  }

  if (!session) {
    throw new ORPCError("UNAUTHORIZED", { message: "Authentication required." });
  }

  return next({
    context: {
      session,
      user: session.user,
    },
  });
});

/** Requires auth + verifies the user is a member of the Brackeys Discord server. */
export const requireGuildMember = os.middleware(async ({ context, next }) => {
  let session: Awaited<ReturnType<typeof auth.api.getSession>> | null = null;
  try {
    session = await auth.api.getSession({
      headers: (context as { headers: Headers }).headers,
    });
  } catch {
    // getSession may throw when no cookies are present
  }

  if (!session) {
    throw new ORPCError("UNAUTHORIZED", { message: "Authentication required." });
  }

  const [profile] = await db
    .select({ discordId: developerProfiles.discordId })
    .from(developerProfiles)
    .where(eq(developerProfiles.id, session.user.id))
    .limit(1);

  if (!profile?.discordId || !(await isGuildMember(profile.discordId))) {
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

async function fetchGuildRoles(userId: string): Promise<string[] | null> {
  const [profile] = await db
    .select({ guildRoles: developerProfiles.guildRoles })
    .from(developerProfiles)
    .where(eq(developerProfiles.id, userId))
    .limit(1);

  return profile?.guildRoles ?? null;
}

/** Requires auth + enriches context with isStaff/isAdmin booleans. */
export const requireAuthWithPermissions = os.middleware(async ({ context, next }) => {
  let session: Awaited<ReturnType<typeof auth.api.getSession>> | null = null;
  try {
    session = await auth.api.getSession({
      headers: (context as { headers: Headers }).headers,
    });
  } catch {
    // getSession may throw when no cookies are present
  }

  if (!session) {
    throw new ORPCError("UNAUTHORIZED", { message: "Authentication required." });
  }

  const guildRoles = await fetchGuildRoles(session.user.id);

  return next({
    context: {
      session,
      user: session.user,
      isStaff: checkIsStaff(guildRoles),
      isAdmin: checkIsAdmin(guildRoles),
    },
  });
});

export const requireStaff = os.middleware(async ({ context, next }) => {
  let session: Awaited<ReturnType<typeof auth.api.getSession>> | null = null;
  try {
    session = await auth.api.getSession({
      headers: (context as { headers: Headers }).headers,
    });
  } catch {
    // getSession may throw when no cookies are present
  }

  if (!session) {
    throw new ORPCError("UNAUTHORIZED", { message: "Authentication required." });
  }

  const guildRoles = await fetchGuildRoles(session.user.id);

  if (!checkIsStaff(guildRoles)) {
    throw new ORPCError("FORBIDDEN", { message: "Staff access required." });
  }

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
  let session: Awaited<ReturnType<typeof auth.api.getSession>> | null = null;
  try {
    session = await auth.api.getSession({
      headers: (context as { headers: Headers }).headers,
    });
  } catch {
    // getSession may throw when no cookies are present
  }

  if (!session) {
    throw new ORPCError("UNAUTHORIZED", { message: "Authentication required." });
  }

  const guildRoles = await fetchGuildRoles(session.user.id);

  if (!checkIsAdmin(guildRoles)) {
    throw new ORPCError("FORBIDDEN", { message: "Admin access required." });
  }

  return next({
    context: {
      session,
      user: session.user,
      isStaff: true as const,
      isAdmin: true as const,
    },
  });
});
