import { ORPCError } from "@orpc/client";
import { os } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import * as z from "zod";

import { db } from "@/db";
import { account, linkedAccounts } from "@/db/schema";
import { fetchGitHubUser, fetchContributionCalendar } from "@/lib/github";
import { requireAuth, authMiddleware } from "@/orpc/middleware/auth";

export const syncGitHubLink = os
  .use(requireAuth)
  .input(z.object({}))
  .handler(async ({ context }) => {
    const userId = context.user.id;

    const [ghAccount] = await db
      .select()
      .from(account)
      .where(and(eq(account.userId, userId), eq(account.providerId, "github")))
      .limit(1);

    if (!ghAccount?.accessToken) {
      throw new ORPCError("BAD_REQUEST", {
        message: "No GitHub account found. Please try linking again.",
      });
    }

    const ghUser = await fetchGitHubUser(ghAccount.accessToken).catch(() => {
      throw new ORPCError("BAD_REQUEST", {
        message: "Failed to fetch GitHub profile. Token may be invalid.",
      });
    });

    const [linked] = await db
      .insert(linkedAccounts)
      .values({
        profileId: userId,
        provider: "github",
        providerUserId: String(ghUser.id),
        providerUsername: ghUser.login,
        providerAvatarUrl: ghUser.avatar_url ?? null,
        providerProfileUrl: ghUser.html_url ?? null,
        accessToken: ghAccount.accessToken,
        scopes: "read:user",
        linkedAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [linkedAccounts.profileId, linkedAccounts.provider],
        set: {
          providerUserId: String(ghUser.id),
          providerUsername: ghUser.login,
          providerAvatarUrl: ghUser.avatar_url ?? null,
          providerProfileUrl: ghUser.html_url ?? null,
          accessToken: ghAccount.accessToken,
          scopes: "read:user",
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

export const unlinkGitHub = os
  .use(requireAuth)
  .input(z.object({}))
  .handler(async ({ context }) => {
    const userId = context.user.id;

    const [deleted] = await db
      .delete(linkedAccounts)
      .where(and(eq(linkedAccounts.profileId, userId), eq(linkedAccounts.provider, "github")))
      .returning();

    if (!deleted) {
      throw new ORPCError("NOT_FOUND", {
        message: "No GitHub account linked.",
      });
    }

    await db
      .delete(account)
      .where(and(eq(account.userId, userId), eq(account.providerId, "github")));

    return { success: true };
  });

export const getContributions = os
  .use(authMiddleware)
  .input(z.object({ userId: z.string() }))
  .handler(async ({ input }) => {
    const [ghLink] = await db
      .select()
      .from(linkedAccounts)
      .where(and(eq(linkedAccounts.profileId, input.userId), eq(linkedAccounts.provider, "github")))
      .limit(1);

    if (!ghLink?.accessToken || !ghLink.providerUsername) {
      return null;
    }

    const calendar = await fetchContributionCalendar(
      ghLink.accessToken,
      ghLink.providerUsername,
    ).catch(() => null);

    return calendar;
  });
