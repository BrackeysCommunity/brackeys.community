import { freshOAuthToken } from "@/lib/oauth-token";

/**
 * A GitHub user token that hasn't expired yet.
 *
 * The GitHub credentials this app authenticates with issue `gho_` user
 * tokens that live eight hours, alongside a six-month `ghr_` refresh
 * token. The sealed copy `linked_accounts` takes when the member presses
 * LINK is therefore dead before the day is out — and the ACTIVITY graph
 * with it, since a 401 there is indistinguishable from "no contributions".
 *
 * Refresh tokens are single-use, so a rotation that never lands ends the
 * chain and the member has to link again.
 */
export function freshGitHubToken(userId: string): Promise<string | null> {
  return freshOAuthToken("github", userId);
}
