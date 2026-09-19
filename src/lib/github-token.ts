import { auth } from "@/lib/auth";

/**
 * A GitHub user token that hasn't expired yet.
 *
 * The GitHub credentials this app authenticates with issue `gho_` user
 * tokens that live eight hours, alongside a six-month `ghr_` refresh
 * token. The sealed copy `linked_accounts` takes when the member presses
 * LINK is therefore dead before the day is out — and the ACTIVITY graph
 * with it, since a 401 there is indistinguishable from "no contributions".
 *
 * better-auth owns the refresh. Called with no request attached it
 * authorises off `userId` alone, swaps a token at or past its expiry for a
 * fresh pair, and writes the rotation back to `account`.
 *
 * Null when there's nothing usable left. Refresh tokens are single-use, so
 * a rotation that never lands ends the chain and the member has to link
 * again — and GitHub reports that with a 200 and an error body, which
 * better-auth's refresh reads as "no new tokens" and answers by handing
 * back the stored token unchanged. An expiry still in the past is that
 * case: the token behind it is already dead, so say so here rather than
 * spend a request finding out.
 */
export async function freshGitHubToken(userId: string): Promise<string | null> {
  try {
    const { accessToken, accessTokenExpiresAt } = await auth.api.getAccessToken({
      body: { providerId: "github", userId },
    });
    if (!accessToken) return null;
    if (accessTokenExpiresAt && accessTokenExpiresAt.getTime() <= Date.now()) {
      console.error(`[github] token for ${userId} is expired and could not be refreshed`);
      return null;
    }
    return accessToken;
  } catch (err) {
    console.error(`[github] no refreshable token for ${userId}:`, err);
    return null;
  }
}
