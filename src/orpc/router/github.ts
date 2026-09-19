import { ORPCError } from "@orpc/client";
import { os } from "@orpc/server";
import { and, eq, ne } from "drizzle-orm";
import * as z from "zod";

import { db } from "@/db";
import { account, linkedAccounts } from "@/db/schema";
import { openBetterAuthToken } from "@/lib/better-auth-tokens";
import { EVENTS } from "@/lib/event-taxonomy";
import { fetchGitHubUser } from "@/lib/github";
import { captureServerEvent } from "@/lib/posthog-server";
import { sealLinkedAccountToken } from "@/orpc/linked-account-tokens";
import { requireAuth } from "@/orpc/middleware/auth";

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

    // better-auth stores its tokens encrypted under its own secret; this
    // read bypasses its endpoints, so decryption is on us — and the copy
    // we keep in linked_accounts is sealed with our own key.
    const ghToken = await openBetterAuthToken(ghAccount.accessToken);

    const ghUser = await fetchGitHubUser(ghToken).catch(() => {
      throw new ORPCError("BAD_REQUEST", {
        message: "Failed to fetch GitHub profile. Token may be invalid.",
      });
    });
    const sealed = sealLinkedAccountToken(ghToken);

    const [linked] = await db
      .insert(linkedAccounts)
      .values({
        profileId: userId,
        provider: "github",
        providerUserId: String(ghUser.id),
        providerUsername: ghUser.login,
        providerAvatarUrl: ghUser.avatar_url ?? null,
        providerProfileUrl: ghUser.html_url ?? null,
        accessToken: sealed,
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
          accessToken: sealed,
          scopes: "read:user",
          updatedAt: new Date(),
        },
      })
      .returning();

    captureServerEvent(EVENTS.accountLinkCompleted, userId, { provider: "github" });

    return {
      id: linked.id,
      provider: linked.provider,
      providerUsername: linked.providerUsername,
      providerProfileUrl: linked.providerProfileUrl,
    };
  });

/**
 * Drop GitHub from both places it lives.
 *
 * The two rows arrive by different doors: the profile integration writes
 * `linked_accounts` (sealed token, contribution graph) through the OAuth
 * callback, while `/settings/account` links GitHub purely as a *sign-in
 * identity* and only ever creates better-auth's `account` row. Either one
 * alone counts as linked — insisting on the profile row refused the
 * Settings case and left its sealed token sitting in the database after
 * the member had withdrawn consent.
 */
export const unlinkGitHub = os
  .use(requireAuth)
  .input(z.object({}))
  .handler(async ({ context }) => {
    const userId = context.user.id;

    const [githubAccounts, otherAccounts] = await Promise.all([
      db
        .select({ id: account.id })
        .from(account)
        .where(and(eq(account.userId, userId), eq(account.providerId, "github"))),
      db
        .select({ id: account.id })
        .from(account)
        .where(and(eq(account.userId, userId), ne(account.providerId, "github"))),
    ]);

    // better-auth's own `unlinkAccount` refuses to remove the last
    // credential, and it is the right refusal — removing GitHub here goes
    // around better-auth, so the guard has to be restated or an account
    // whose only door is GitHub would be locked out for good.
    if (githubAccounts.length > 0 && otherAccounts.length === 0) {
      throw new ORPCError("BAD_REQUEST", {
        message: "GitHub is the only way to sign in to this account. Link another provider first.",
      });
    }

    const unlinked = await db
      .delete(linkedAccounts)
      .where(and(eq(linkedAccounts.profileId, userId), eq(linkedAccounts.provider, "github")))
      .returning();

    if (githubAccounts.length > 0) {
      await db
        .delete(account)
        .where(and(eq(account.userId, userId), eq(account.providerId, "github")));
    }

    if (unlinked.length === 0 && githubAccounts.length === 0) {
      throw new ORPCError("NOT_FOUND", {
        message: "No GitHub account linked.",
      });
    }

    return { success: true };
  });
