import { ORPCError } from "@orpc/client";
import { os } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import * as z from "zod";

import { db } from "@/db";
import { linkedAccounts } from "@/db/schema";
import { validateToken } from "@/lib/itchio";
import { syncItchIoJamParticipations } from "@/lib/itchio-jam-sync";
import { ItchIoSyncFetchError, syncItchIoLibrary } from "@/lib/itchio-sync";
import { requireAuth } from "@/orpc/middleware/auth";

export const linkItchIo = os
  .use(requireAuth)
  .input(z.object({ accessToken: z.string().min(1) }))
  .handler(async ({ input, context }) => {
    const userId = context.user.id;

    const itchUser = await validateToken(input.accessToken).catch(() => {
      throw new ORPCError("BAD_REQUEST", {
        message: "Invalid itch.io access token. Please try linking again.",
      });
    });

    const [linked] = await db
      .insert(linkedAccounts)
      .values({
        profileId: userId,
        provider: "itchio",
        providerUserId: String(itchUser.id),
        providerUsername: itchUser.username,
        providerAvatarUrl: itchUser.cover_url ?? null,
        providerProfileUrl: itchUser.url ?? null,
        accessToken: input.accessToken,
        scopes: "profile:me profile:games",
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
          scopes: "profile:me profile:games",
          updatedAt: new Date(),
        },
      })
      .returning();

    return {
      id: linked.id,
      provider: linked.provider,
      providerUsername: linked.providerUsername,
      providerProfileUrl: linked.providerProfileUrl,
    };
  });

export const unlinkItchIo = os
  .use(requireAuth)
  .input(z.object({}))
  .handler(async ({ context }) => {
    const [deleted] = await db
      .delete(linkedAccounts)
      .where(
        and(eq(linkedAccounts.profileId, context.user.id), eq(linkedAccounts.provider, "itchio")),
      )
      .returning();

    if (!deleted) {
      throw new ORPCError("NOT_FOUND", {
        message: "No itch.io account linked.",
      });
    }

    return { success: true };
  });

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
      .where(eq(linkedAccounts.profileId, context.user.id));

    return accounts;
  });

export const importItchIoGames = os
  .use(requireAuth)
  .input(z.object({}))
  .handler(async ({ context }) => {
    const result = await syncItchIoLibrary(context.user.id).catch((err) => {
      if (err instanceof ItchIoSyncFetchError) {
        throw new ORPCError("BAD_REQUEST", {
          message:
            "Failed to fetch games from itch.io. Your token may have expired — try re-linking.",
        });
      }
      throw err;
    });

    if (!result) {
      throw new ORPCError("BAD_REQUEST", {
        message: "No itch.io account linked or access token missing.",
      });
    }

    // Jam participation rides along with the explicit import, but a failure
    // here shouldn't fail the game import the user actually asked for — the
    // cron sweep retries it daily anyway.
    await syncItchIoJamParticipations(context.user.id).catch((err) => {
      console.error(`[itchio] jam backfill failed for ${context.user.id}`, err);
    });

    return result;
  });
