import type { OAuth2Tokens } from "better-auth/oauth2";

const TOKEN_ENDPOINT = "https://github.com/login/oauth/access_token";

interface GitHubTokenResponse {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  scope?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
  error?: string;
  error_description?: string;
}

/**
 * better-auth's GitHub `refreshAccessToken`, minus the silent failure.
 *
 * GitHub rejects a refresh with HTTP 200 and an `error` body. The stock
 * implementation reads that as a response with no tokens in it, writes the
 * empties back over nothing, and `getAccessToken` hands the expired token
 * back as if it were fine — so the reason a chain died never reached a log.
 * Throwing here makes `getAccessToken` fail instead, with GitHub's own words.
 */
export function githubRefreshAccessToken(clientId: string, clientSecret: string) {
  return async (refreshToken: string): Promise<OAuth2Tokens> => {
    const res = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as GitHubTokenResponse;
    if (!res.ok || data.error || !data.access_token) {
      const reason = data.error
        ? `${data.error}${data.error_description ? `: ${data.error_description}` : ""}`
        : `HTTP ${res.status}`;
      console.error(`[github] token refresh rejected — ${reason}`);
      throw new Error(`GitHub token refresh rejected (${reason})`);
    }
    const now = Date.now();
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      tokenType: data.token_type,
      scopes: data.scope?.split(","),
      accessTokenExpiresAt: data.expires_in ? new Date(now + data.expires_in * 1000) : undefined,
      refreshTokenExpiresAt: data.refresh_token_expires_in
        ? new Date(now + data.refresh_token_expires_in * 1000)
        : undefined,
    };
  };
}
