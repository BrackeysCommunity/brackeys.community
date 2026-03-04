import { ORPCError } from '@orpc/client'
import { os } from '@orpc/server'
import * as z from 'zod'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { linkedAccounts, profileProjects } from '@/db/schema'
import { requireAuth } from '@/orpc/middleware/auth'
import { validateToken, fetchGames } from '@/lib/itchio'

export const linkItchIo = os
  .use(requireAuth)
  .input(z.object({ accessToken: z.string().min(1) }))
  .handler(async ({ input, context }) => {
    const userId = context.user.id

    const itchUser = await validateToken(input.accessToken).catch(() => {
      throw new ORPCError('BAD_REQUEST', {
        message: 'Invalid itch.io access token. Please try linking again.',
      })
    })

    const [linked] = await db
      .insert(linkedAccounts)
      .values({
        profileId: userId,
        provider: 'itchio',
        providerUserId: String(itchUser.id),
        providerUsername: itchUser.username,
        providerAvatarUrl: itchUser.cover_url ?? null,
        providerProfileUrl: itchUser.url ?? null,
        accessToken: input.accessToken,
        scopes: 'profile:me profile:games',
        linkedAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [linkedAccounts.profileId, linkedAccounts.provider],
        set: {
          providerUserId: String(itchUser.id),
          providerUsername: itchUser.username,
          providerAvatarUrl: itchUser.cover_url ?? null,
          providerProfileUrl: itchUser.url ?? null,
          accessToken: input.accessToken,
          scopes: 'profile:me profile:games',
          updatedAt: new Date(),
        },
      })
      .returning()

    return {
      id: linked.id,
      provider: linked.provider,
      providerUsername: linked.providerUsername,
      providerProfileUrl: linked.providerProfileUrl,
    }
  })

export const unlinkItchIo = os
  .use(requireAuth)
  .input(z.object({}))
  .handler(async ({ context }) => {
    const [deleted] = await db
      .delete(linkedAccounts)
      .where(
        and(
          eq(linkedAccounts.profileId, context.user.id),
          eq(linkedAccounts.provider, 'itchio'),
        ),
      )
      .returning()

    if (!deleted) {
      throw new ORPCError('NOT_FOUND', {
        message: 'No itch.io account linked.',
      })
    }

    return { success: true }
  })

export const getLinkedAccounts = os
  .use(requireAuth)
  .input(z.object({}))
  .handler(async ({ context }) => {
    const accounts = await db
      .select({
        id: linkedAccounts.id,
        provider: linkedAccounts.provider,
        providerUserId: linkedAccounts.providerUserId,
        providerUsername: linkedAccounts.providerUsername,
        providerAvatarUrl: linkedAccounts.providerAvatarUrl,
        providerProfileUrl: linkedAccounts.providerProfileUrl,
        linkedAt: linkedAccounts.linkedAt,
      })
      .from(linkedAccounts)
      .where(eq(linkedAccounts.profileId, context.user.id))

    return accounts
  })

export const importItchIoGames = os
  .use(requireAuth)
  .input(z.object({}))
  .handler(async ({ context }) => {
    const userId = context.user.id

    const [itchAccount] = await db
      .select()
      .from(linkedAccounts)
      .where(
        and(
          eq(linkedAccounts.profileId, userId),
          eq(linkedAccounts.provider, 'itchio'),
        ),
      )
      .limit(1)

    if (!itchAccount?.accessToken) {
      throw new ORPCError('BAD_REQUEST', {
        message: 'No itch.io account linked or access token missing.',
      })
    }

    const games = await fetchGames(itchAccount.accessToken).catch(() => {
      throw new ORPCError('BAD_REQUEST', {
        message: 'Failed to fetch games from itch.io. Your token may have expired — try re-linking.',
      })
    })

    if (games.length === 0) {
      return { imported: 0, total: 0 }
    }

    const existing = await db
      .select({ sourceId: profileProjects.sourceId })
      .from(profileProjects)
      .where(
        and(
          eq(profileProjects.profileId, userId),
          eq(profileProjects.source, 'itchio'),
        ),
      )

    const existingIds = new Set(existing.map((e) => e.sourceId))

    const newGames = games.filter(
      (g) => g.published && !existingIds.has(String(g.id)),
    )

    if (newGames.length > 0) {
      await db.insert(profileProjects).values(
        newGames.map((game) => ({
          profileId: userId,
          title: game.title,
          description: game.short_text || null,
          url: game.url || null,
          imageUrl: game.cover_url || null,
          source: 'itchio' as const,
          sourceId: String(game.id),
          status: 'approved',
        })),
      )
    }

    return { imported: newGames.length, total: games.length }
  })
