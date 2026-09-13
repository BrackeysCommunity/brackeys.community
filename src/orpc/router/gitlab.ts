import { ORPCError } from "@orpc/client";
import { os } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import * as z from "zod";

import { db } from "@/db";
import { account, linkedAccounts } from "@/db/schema";
import { openBetterAuthToken } from "@/lib/better-auth-tokens";
import { EVENTS } from "@/lib/event-taxonomy";
import { fetchGitLabUser } from "@/lib/gitlab";
import { gitlabInstance, type GitLabInstance } from "@/lib/gitlab-instances";
import { configuredGitLabInstances, isGitLabInstanceConfigured } from "@/lib/gitlab-oauth";
import { captureServerEvent } from "@/lib/posthog-server";
import { sealLinkedAccountToken } from "@/orpc/linked-account-tokens";
import { requireAuth } from "@/orpc/middleware/auth";

/**
 * A `providerId` off the wire only counts if the registry knows it *and* the
 * deployment has credentials for it — otherwise there is no `account` row it
 * could ever match, and the caller is naming an instance that doesn't exist.
 */
function requireInstance(providerId: string): GitLabInstance {
  const instance = gitlabInstance(providerId);
  if (!instance || !isGitLabInstanceConfigured(providerId)) {
    throw new ORPCError("BAD_REQUEST", { message: "Unknown GitLab instance." });
  }
  return instance;
}

/** The instances this deployment can actually offer, for the `+ ADD` menu. */
export const listGitLabInstances = os
  .route({ method: "GET" })
  .use(requireAuth)
  .input(z.object({}))
  .handler(async () =>
    configuredGitLabInstances().map((i) => ({
      providerId: i.providerId,
      host: i.host,
      label: i.label,
    })),
  );

export const syncGitLabLink = os
  .use(requireAuth)
  .input(z.object({ providerId: z.string().min(1) }))
  .handler(async ({ input, context }) => {
    const instance = requireInstance(input.providerId);
    const userId = context.user.id;

    const [glAccount] = await db
      .select()
      .from(account)
      .where(and(eq(account.userId, userId), eq(account.providerId, instance.providerId)))
      .limit(1);

    if (!glAccount?.accessToken) {
      throw new ORPCError("BAD_REQUEST", {
        message: `No ${instance.host} account found. Please try linking again.`,
      });
    }

    // Same bypass as the GitHub flow: better-auth encrypts its own tokens and
    // only decrypts them at its own endpoints, and our copy is re-sealed
    // under the linked-accounts key.
    const token = await openBetterAuthToken(glAccount.accessToken);

    const glUser = await fetchGitLabUser(instance, token).catch(() => {
      throw new ORPCError("BAD_REQUEST", {
        message: `Failed to fetch your ${instance.host} profile. Token may be invalid.`,
      });
    });
    const sealed = sealLinkedAccountToken(token);

    const values = {
      providerUserId: String(glUser.id),
      providerUsername: glUser.username,
      providerDisplayName: glUser.name ?? null,
      providerAvatarUrl: glUser.avatar_url ?? null,
      providerProfileUrl: glUser.web_url ?? `https://${instance.host}/${glUser.username}`,
      accessToken: sealed,
      scopes: "read_user",
      tokenInvalidAt: null,
      updatedAt: new Date(),
    };

    const [linked] = await db
      .insert(linkedAccounts)
      .values({
        profileId: userId,
        provider: instance.providerId,
        linkedAt: new Date(),
        ...values,
      })
      .onConflictDoUpdate({
        target: [linkedAccounts.profileId, linkedAccounts.provider],
        set: values,
      })
      .returning();

    captureServerEvent(EVENTS.accountLinkCompleted, userId, { provider: instance.providerId });

    return {
      id: linked.id,
      provider: linked.provider,
      host: instance.host,
      providerUsername: linked.providerUsername,
      providerProfileUrl: linked.providerProfileUrl,
    };
  });

export const unlinkGitLab = os
  .use(requireAuth)
  .input(z.object({ providerId: z.string().min(1) }))
  .handler(async ({ input, context }) => {
    const instance = requireInstance(input.providerId);
    const userId = context.user.id;

    const [deleted] = await db
      .delete(linkedAccounts)
      .where(
        and(eq(linkedAccounts.profileId, userId), eq(linkedAccounts.provider, instance.providerId)),
      )
      .returning();

    if (!deleted) {
      throw new ORPCError("NOT_FOUND", {
        message: `No ${instance.host} account linked.`,
      });
    }

    await db
      .delete(account)
      .where(and(eq(account.userId, userId), eq(account.providerId, instance.providerId)));

    return { success: true };
  });
