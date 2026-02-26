import { os } from '@orpc/server'
import { eq } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { isStaffMember as checkIsStaff, isAdmin as checkIsAdmin } from '@/lib/discord'
import { db } from '@/db'
import { developerProfiles } from '@/db/schema'

export const authMiddleware = os.middleware(async ({ context, next }) => {
  let session: Awaited<ReturnType<typeof auth.api.getSession>> | null = null
  try {
    session = await auth.api.getSession({
      headers: (context as { headers: Headers }).headers,
    })
  } catch {
    // Unauthenticated requests (no cookies) may throw — pass through with null
  }

  return next({
    context: {
      session,
      user: session?.user ?? null,
    },
  })
})

export const requireAuth = os.middleware(async ({ context, next }) => {
  let session: Awaited<ReturnType<typeof auth.api.getSession>> | null = null
  try {
    session = await auth.api.getSession({
      headers: (context as { headers: Headers }).headers,
    })
  } catch {
    // getSession may throw when no cookies are present
  }

  if (!session) {
    throw new Error('Unauthorized')
  }

  return next({
    context: {
      session,
      user: session.user,
    },
  })
})

async function fetchGuildRoles(userId: string): Promise<string[] | null> {
  const [profile] = await db
    .select({ guildRoles: developerProfiles.guildRoles })
    .from(developerProfiles)
    .where(eq(developerProfiles.id, userId))
    .limit(1)

  return profile?.guildRoles ?? null
}

/** Requires auth + enriches context with isStaff/isAdmin booleans. */
export const requireAuthWithPermissions = os.middleware(async ({ context, next }) => {
  let session: Awaited<ReturnType<typeof auth.api.getSession>> | null = null
  try {
    session = await auth.api.getSession({
      headers: (context as { headers: Headers }).headers,
    })
  } catch {
    // getSession may throw when no cookies are present
  }

  if (!session) {
    throw new Error('Unauthorized')
  }

  const guildRoles = await fetchGuildRoles(session.user.id)

  return next({
    context: {
      session,
      user: session.user,
      isStaff: checkIsStaff(guildRoles),
      isAdmin: checkIsAdmin(guildRoles),
    },
  })
})

export const requireStaff = os.middleware(async ({ context, next }) => {
  let session: Awaited<ReturnType<typeof auth.api.getSession>> | null = null
  try {
    session = await auth.api.getSession({
      headers: (context as { headers: Headers }).headers,
    })
  } catch {
    // getSession may throw when no cookies are present
  }

  if (!session) {
    throw new Error('Unauthorized')
  }

  const guildRoles = await fetchGuildRoles(session.user.id)

  if (!checkIsStaff(guildRoles)) {
    throw new Error('Forbidden: staff access required')
  }

  return next({
    context: {
      session,
      user: session.user,
      isStaff: true as const,
      isAdmin: checkIsAdmin(guildRoles),
    },
  })
})

export const requireAdmin = os.middleware(async ({ context, next }) => {
  let session: Awaited<ReturnType<typeof auth.api.getSession>> | null = null
  try {
    session = await auth.api.getSession({
      headers: (context as { headers: Headers }).headers,
    })
  } catch {
    // getSession may throw when no cookies are present
  }

  if (!session) {
    throw new Error('Unauthorized')
  }

  const guildRoles = await fetchGuildRoles(session.user.id)

  if (!checkIsAdmin(guildRoles)) {
    throw new Error('Forbidden: admin access required')
  }

  return next({
    context: {
      session,
      user: session.user,
      isStaff: true as const,
      isAdmin: true as const,
    },
  })
})
