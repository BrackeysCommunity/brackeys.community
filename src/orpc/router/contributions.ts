import { os } from "@orpc/server";
import { eq } from "drizzle-orm";
import * as z from "zod";

import { db } from "@/db";
import { linkedAccounts } from "@/db/schema";
import {
  buildContributionCalendar,
  weeksToDayMap,
  type ContributionDayMap,
  type ContributionSource,
} from "@/lib/contributions";
import { fetchContributionCalendar } from "@/lib/github";
import { freshGitHubToken } from "@/lib/github-token";
import { fetchGitLabCalendar } from "@/lib/gitlab";
import { gitlabInstance, isSelfHostedGitLab } from "@/lib/gitlab-instances";
import { openToken } from "@/lib/token-crypto";

/**
 * The ACTIVITY graph. Anonymous and edge-cached (see `public-procedures`),
 * so everything here is either public data or read with the member's own
 * stored token — never the viewer's.
 *
 * One grid, every linked forge summed into it, each source keeping its own
 * colour through `bySource`. A source that fails is absent rather than
 * fatal: the graph is a texture, and half of it beats none of it.
 */

/**
 * The sealed copy in `linked_accounts`, for a row better-auth can't
 * refresh from. A sealed token with no key to open it is a config error,
 * not a reason to 500 the profile page: the graph is just absent.
 */
function openStoredToken(stored: string | null): string | null {
  if (!stored) return null;
  try {
    return openToken(stored);
  } catch (err) {
    console.error("[contributions] cannot open stored token:", err);
    return null;
  }
}

async function githubDays(
  profileId: string,
  link: { accessToken: string | null; providerUsername: string | null },
): Promise<ContributionDayMap | null> {
  if (!link.providerUsername) return null;
  // Refreshed first, stored copy second: GitHub user tokens expire in
  // eight hours, so the one sealed at link time is only ever a fallback.
  const token = (await freshGitHubToken(profileId)) ?? openStoredToken(link.accessToken);
  if (!token) return null;
  const calendar = await fetchContributionCalendar(token, link.providerUsername).catch((err) => {
    // Swallowed so one dark forge can't take the whole graph down — but
    // logged, because silence here is what made an expired token look
    // like a member who simply stopped committing.
    console.error(`[contributions] github calendar failed for ${link.providerUsername}:`, err);
    return null;
  });
  return calendar ? weeksToDayMap(calendar.weeks) : null;
}

export const getContributions = os
  .route({ method: "GET" })
  .input(z.object({ userId: z.string() }))
  .handler(async ({ input }) => {
    const links = await db
      .select({
        provider: linkedAccounts.provider,
        providerUsername: linkedAccounts.providerUsername,
        accessToken: linkedAccounts.accessToken,
      })
      .from(linkedAccounts)
      .where(eq(linkedAccounts.profileId, input.userId));

    const fetches: Array<Promise<{ source: ContributionSource; days: ContributionDayMap } | null>> =
      [];

    for (const link of links) {
      if (link.provider === "github") {
        fetches.push(
          githubDays(input.userId, link).then((days) =>
            days ? { source: { key: "github", label: "GITHUB" }, days } : null,
          ),
        );
        continue;
      }
      const instance = gitlabInstance(link.provider);
      if (!instance || !link.providerUsername) continue;
      fetches.push(
        fetchGitLabCalendar(instance, link.providerUsername).then((days) =>
          days
            ? {
                source: {
                  key: instance.providerId,
                  // The host is the distinguishing half for a self-hosted
                  // instance, and noise for gitlab.com.
                  label: isSelfHostedGitLab(instance) ? instance.host : "GITLAB",
                },
                days,
              }
            : null,
        ),
      );
    }

    if (fetches.length === 0) return null;

    const inputs = (await Promise.all(fetches)).filter((entry) => entry !== null);
    return buildContributionCalendar(inputs, new Date());
  });
