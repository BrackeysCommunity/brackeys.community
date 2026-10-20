import { auth } from "@/lib/auth";

/**
 * A provider access token that hasn't expired yet, or null when there's
 * nothing usable left.
 *
 * better-auth owns the refresh. Called with no request attached it
 * authorises off `userId` alone, swaps a token at or past its expiry for a
 * fresh pair, and writes the rotation back to `account`. The stored copy is
 * sealed (`encryptOAuthTokens`); this hands back the opened token.
 *
 * Some providers answer a spent refresh token with a 200 and an error body,
 * which better-auth reads as "no new tokens" and answers by handing back the
 * stored token unchanged. An expiry still in the past is that case: the token
 * behind it is already dead, so say so here rather than spend a request
 * finding out.
 */
export async function freshOAuthToken(providerId: string, userId: string): Promise<string | null> {
  try {
    const { accessToken, accessTokenExpiresAt } = await auth.api.getAccessToken({
      body: { providerId, userId },
    });
    if (!accessToken) return null;
    if (accessTokenExpiresAt && accessTokenExpiresAt.getTime() <= Date.now()) {
      console.error(`[${providerId}] token for ${userId} is expired and could not be refreshed`);
      return null;
    }
    return accessToken;
  } catch (err) {
    console.error(`[${providerId}] no refreshable token for ${userId}:`, err);
    return null;
  }
}
