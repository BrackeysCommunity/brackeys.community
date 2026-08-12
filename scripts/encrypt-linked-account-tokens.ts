/**
 * One-time (but re-runnable) backfill: seal every plaintext
 * `linked_accounts.access_token` with LINKED_ACCOUNTS_ENC_KEY.
 *
 * Reads tolerate both forms (`openToken` passes plaintext through), so this
 * can run any time after the key is set on the environment — but run it
 * before real users link, because rows it hasn't reached yet sit plaintext
 * in every backup taken in the meantime.
 *
 *   railway run -- bun scripts/encrypt-linked-account-tokens.ts            # apply
 *   railway run -- bun scripts/encrypt-linked-account-tokens.ts --dry-run  # count only
 *
 * Idempotent: already-sealed rows (enc:v1: prefix) are skipped.
 */
import { eq, isNotNull } from "drizzle-orm";

import { db } from "@/db";
import { linkedAccounts } from "@/db/schema";
import { isSealedToken, sealToken } from "@/lib/token-crypto";

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  if (!process.env.LINKED_ACCOUNTS_ENC_KEY) {
    console.error("LINKED_ACCOUNTS_ENC_KEY is not set — sealing would be a no-op. Aborting.");
    process.exit(1);
  }

  const rows = await db
    .select({ id: linkedAccounts.id, accessToken: linkedAccounts.accessToken })
    .from(linkedAccounts)
    .where(isNotNull(linkedAccounts.accessToken));

  const plaintext = rows.filter((row) => row.accessToken && !isSealedToken(row.accessToken));
  console.log(
    `${rows.length} token-bearing linked accounts; ${plaintext.length} plaintext, ${
      rows.length - plaintext.length
    } already sealed`,
  );

  if (DRY_RUN || plaintext.length === 0) return;

  let sealed = 0;
  for (const row of plaintext) {
    if (!row.accessToken) continue;
    await db
      .update(linkedAccounts)
      .set({ accessToken: sealToken(row.accessToken) })
      .where(eq(linkedAccounts.id, row.id));
    sealed++;
  }
  console.log(`sealed ${sealed} tokens`);
}

await main();
process.exit(0);
