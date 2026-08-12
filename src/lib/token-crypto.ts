/**
 * At-rest encryption for `linked_accounts.access_token` (itch keys are
 * non-expiring and unrevocable by us; GitHub tokens are copied here by
 * linkGitHub). Defends the stolen-backup / DB-read class of leak — an
 * attacker with the app environment has the key too, and that's fine;
 * that was never the threat this addresses.
 *
 * AES-256-GCM, key from `LINKED_ACCOUNTS_ENC_KEY` (32 bytes, base64).
 * Ciphertext format `enc:v1:<iv>:<tag>:<ct>` (base64 fields) so plaintext
 * rows are trivially distinguishable — `openToken` passes anything without
 * the prefix straight through, which is the whole lazy-migration story:
 * reads tolerate both, writes always seal, and the one-off script in
 * `scripts/encrypt-linked-account-tokens.ts` converts the stragglers.
 *
 * Imported relatively by the itchio-library-sync service (copied into its
 * image), so: no `@/` imports, nothing beyond node:crypto, and the key is
 * read from process.env on every call — no caching, so tests and the
 * service's env handling stay simple.
 *
 * better-auth's own `account` table is covered separately by its
 * `account.encryptOAuthTokens` option (keyed on BETTER_AUTH_SECRET), not
 * by this module.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const PREFIX = "enc:v1:";

function loadKey(): Buffer | null {
  const raw = process.env.LINKED_ACCOUNTS_ENC_KEY;
  if (!raw) return null;
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("LINKED_ACCOUNTS_ENC_KEY must decode to exactly 32 bytes of base64");
  }
  return key;
}

let warnedUnsealed = false;

/**
 * Encrypt a token for storage. With no key configured this returns the
 * token unchanged (with a one-time warning) rather than blocking linking —
 * dev environments without the key keep working, and `openToken`'s
 * passthrough reads the result fine either way.
 */
export function sealToken(token: string): string {
  const key = loadKey();
  if (!key) {
    if (!warnedUnsealed) {
      warnedUnsealed = true;
      console.warn("[token-crypto] LINKED_ACCOUNTS_ENC_KEY not set — storing tokens unsealed");
    }
    return token;
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`;
}

/**
 * Decrypt a stored token. Values without the `enc:` prefix are legacy
 * plaintext and pass through. An encrypted value with no key configured
 * (or a bad key / tampered ciphertext) throws — that's a config error to
 * surface, not something to silently treat as a token.
 */
export function openToken(stored: string): string {
  if (!stored.startsWith(PREFIX)) return stored;
  const key = loadKey();
  if (!key) {
    throw new Error("token is encrypted but LINKED_ACCOUNTS_ENC_KEY is not set");
  }
  const [ivPart, tagPart, ctPart] = stored.slice(PREFIX.length).split(":");
  if (!ivPart || !tagPart || !ctPart) throw new Error("malformed enc:v1 token");
  const iv = Buffer.from(ivPart, "base64");
  const tag = Buffer.from(tagPart, "base64");
  const ciphertext = Buffer.from(ctPart, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export function isSealedToken(stored: string): boolean {
  return stored.startsWith(PREFIX);
}
