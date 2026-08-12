import { symmetricDecrypt } from "better-auth/crypto";

/**
 * Decrypt an OAuth token read straight from better-auth's `account` table.
 *
 * With `account.encryptOAuthTokens` on, better-auth stores tokens
 * xchacha20-encrypted under BETTER_AUTH_SECRET — but only its own
 * endpoints decrypt on read. Anything of ours that selects
 * `account.accessToken` directly (the session hook's guild sync, the
 * GitHub link flow) has to go through this.
 *
 * Tolerant on purpose: rows written before the flag are plaintext, and
 * decrypting one throws (non-hex input / auth-tag failure) — those fall
 * through unchanged. They self-heal because better-auth re-writes tokens
 * on each sign-in.
 */
export async function openBetterAuthToken(stored: string): Promise<string> {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) return stored;
  try {
    return await symmetricDecrypt({ key: secret, data: stored });
  } catch {
    return stored;
  }
}
