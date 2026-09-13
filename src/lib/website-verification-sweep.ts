/**
 * The re-check pass of the notifications worker's lifecycle sweep. Same
 * import-graph-neutral shape as `project-orphan-sweep.ts`: relative
 * imports, schema + drizzle only, the caller's own drizzle handle.
 *
 * A VERIFIED badge is a claim about the present, and a sold domain would
 * otherwise keep one forever. Every stamp older than the window is re-run
 * and cleared when it no longer passes — the same policy `token_invalid_at`
 * has for OAuth rows, and the reason the stamp stores the host it passed on
 * rather than just a date.
 *
 * Idempotent: a pass either refreshes a stamp or clears it, and the stamp's
 * own age is what selects the row.
 */
import { and, eq, isNotNull, lt } from "drizzle-orm";

import { developerProfiles } from "../db/schema";
import { stampCoversUrl, verifiableHost } from "./website-verification";
import { checkWebsiteVerification } from "./website-verification-check";

// biome-ignore lint/suspicious/noExplicitAny: drizzle builder shape changes per env
type DbHandle = any;

export const VERIFICATION_RECHECK_DAYS = 30;
/** Whole domains don't change hands in bulk; a slow pass keeps the DNS polite. */
const MAX_PER_SWEEP = 50;

export interface VerificationSweepResult {
  checked: number;
  cleared: number;
}

export async function sweepWebsiteVerifications(
  db: DbHandle,
  now: Date,
): Promise<VerificationSweepResult> {
  const cutoff = new Date(now.getTime() - VERIFICATION_RECHECK_DAYS * 86_400_000);

  const due = await db
    .select({
      id: developerProfiles.id,
      websiteUrl: developerProfiles.websiteUrl,
      token: developerProfiles.websiteVerificationToken,
      verifiedHost: developerProfiles.websiteVerifiedHost,
    })
    .from(developerProfiles)
    .where(
      and(
        isNotNull(developerProfiles.websiteVerifiedAt),
        lt(developerProfiles.websiteVerifiedAt, cutoff),
      ),
    )
    .limit(MAX_PER_SWEEP);

  let checked = 0;
  let cleared = 0;

  for (const row of due) {
    const clear = () =>
      db
        .update(developerProfiles)
        .set({ websiteVerifiedAt: null, websiteVerifiedHost: null })
        .where(eq(developerProfiles.id, row.id));

    // The URL moved off the host that was proved, or the token is gone:
    // there is nothing left to re-check, only a stamp to drop.
    if (!row.token || !stampCoversUrl(row.verifiedHost, row.websiteUrl)) {
      await clear();
      cleared++;
      continue;
    }
    const target = verifiableHost(row.websiteUrl);
    if ("error" in target) {
      await clear();
      cleared++;
      continue;
    }

    checked++;
    const result = await checkWebsiteVerification(target.host, row.token);
    if (result.verified) {
      await db
        .update(developerProfiles)
        .set({ websiteVerifiedAt: now, websiteVerifiedHost: target.host })
        .where(eq(developerProfiles.id, row.id));
    } else {
      await clear();
      cleared++;
    }
  }

  return { checked, cleared };
}
