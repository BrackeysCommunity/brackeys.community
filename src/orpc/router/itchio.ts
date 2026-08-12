import { ORPCError } from "@orpc/client";
import { os } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import * as z from "zod";

import { db } from "@/db";
import { linkedAccounts } from "@/db/schema";
import { describeItchError, fetchCredentialsInfo, validateToken } from "@/lib/itchio";
import { syncItchIoJamParticipations } from "@/lib/itchio-jam-sync";
import { ItchIoSyncFetchError, syncItchIoLibrary } from "@/lib/itchio-sync";
import { requireAuth } from "@/orpc/middleware/auth";

export const linkItchIo = os
  .use(requireAuth)
  .input(z.object({ accessToken: z.string().min(1) }))
  .handler(async ({ input, context }) => {
    const userId = context.user.id;

    const itchUser = await validateToken(input.accessToken).catch((err) => {
      throw new ORPCError("BAD_REQUEST", { message: describeItchError(err) });
    });

    // Store what itch actually granted, not what we asked for — users can
    // untick scopes on the consent page. A missing games scope still links
    // (the identity is valid) but the caller skips the auto-import.
    const { scopes, gamesScopeMissing } = await fetchCredentialsInfo(input.accessToken)
      .then((info) => {
        if (info.type === "jwt") {
          console.warn(`[itchio] unexpected jwt-type credentials for user ${userId}`);
        }
        return {
          scopes: info.scopes.join(" "),
          gamesScopeMissing: !info.scopes.some((s) => s === "profile:games" || s === "profile"),
        };
      })
      .catch((err) => {
        // A blip on /credentials/info must not fail linking; fall back to
        // the requested scopes as before.
        console.warn(`[itchio] credentials/info failed for user ${userId}; storing requested`, err);
        return { scopes: "profile:me profile:games", gamesScopeMissing: false };
      });

    const [linked] = await db
      .insert(linkedAccounts)
      .values({
        profileId: userId,
        provider: "itchio",
        providerUserId: String(itchUser.id),
        providerUsername: itchUser.username,
        providerDisplayName: itchUser.display_name ?? null,
        providerAvatarUrl: itchUser.cover_url ?? null,
        providerProfileUrl: itchUser.url ?? null,
        accessToken: input.accessToken,
        scopes,
        tokenInvalidAt: null,
        providerRaw: itchUser,
        linkedAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [linkedAccounts.profileId, linkedAccounts.provider],
        set: {
          providerUserId: String(itchUser.id),
          providerUsername: itchUser.username,
          providerDisplayName: itchUser.display_name ?? null,
          providerAvatarUrl: itchUser.cover_url ?? null,
          providerProfileUrl: itchUser.url ?? null,
          accessToken: input.accessToken,
          scopes,
          // Re-linking is the reconnect path: the fresh token clears the flag.
          tokenInvalidAt: null,
          providerRaw: itchUser,
          updatedAt: new Date(),
        },
      })
      .returning();

    return {
      id: linked.id,
      provider: linked.provider,
      providerUsername: linked.providerUsername,
      providerProfileUrl: linked.providerProfileUrl,
      gamesScopeMissing,
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
        tokenInvalidAt: linkedAccounts.tokenInvalidAt,
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
        throw new ORPCError("BAD_REQUEST", { message: describeItchError(err.cause) });
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
