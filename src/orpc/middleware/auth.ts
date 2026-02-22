import { os } from '@orpc/server'
import { auth } from '@/lib/auth'

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
