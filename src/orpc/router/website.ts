import { ORPCError } from "@orpc/client";
import { os } from "@orpc/server";
import { eq } from "drizzle-orm";
import * as z from "zod";

import { db } from "@/db";
import { developerProfiles } from "@/db/schema";
import { lookupDnsProvider } from "@/lib/dns-provider-lookup";
import { assertRateLimit } from "@/lib/rate-limit";
import {
  relativeRecordName,
  stampCoversUrl,
  verifiableHost,
  verificationTxtRecord,
  VERIFY_WELL_KNOWN_PATH,
} from "@/lib/website-verification";
import { checkWebsiteVerification, mintVerificationToken } from "@/lib/website-verification-check";
import { requireAuth } from "@/orpc/middleware/auth";

/**
 * The owner side of the PORTFOLIO row's VERIFIED badge — the token, the two
 * placements, and the check. Everyone else sees the badge through
 * `getProfile`; nobody else sees the token.
 */

async function loadOwnRow(userId: string) {
  const [row] = await db
    .select({
      websiteUrl: developerProfiles.websiteUrl,
      token: developerProfiles.websiteVerificationToken,
      verifiedAt: developerProfiles.websiteVerifiedAt,
      verifiedHost: developerProfiles.websiteVerifiedHost,
    })
    .from(developerProfiles)
    .where(eq(developerProfiles.id, userId))
    .limit(1);
  if (!row) throw new ORPCError("NOT_FOUND", { message: "Profile not found." });
  return row;
}

/** Minted once and kept, so the instructions never change under the member. */
async function ensureToken(userId: string, existing: string | null): Promise<string> {
  if (existing) return existing;
  const token = mintVerificationToken();
  await db
    .update(developerProfiles)
    .set({ websiteVerificationToken: token })
    .where(eq(developerProfiles.id, userId));
  return token;
}

export const getWebsiteVerification = os
  .route({ method: "GET" })
  .use(requireAuth)
  .input(z.object({}))
  .handler(async ({ context }) => {
    const row = await loadOwnRow(context.user.id);
    const target = verifiableHost(row.websiteUrl);
    const token = await ensureToken(context.user.id, row.token);
    const verified = stampCoversUrl(row.verifiedHost, row.websiteUrl);
    // "Where do I even add this" is the step members actually get stuck on;
    // a failed lookup just means the dialog doesn't answer it.
    const dnsProvider = "host" in target ? await lookupDnsProvider(target.host) : null;

    return {
      host: "host" in target ? target.host : null,
      /** Who runs the host's DNS, for the record's "open your panel" link. */
      dnsProvider,
      /** What to type in a panel's NAME field — relative to the zone. */
      recordName: "host" in target ? relativeRecordName(target.host, dnsProvider?.zone) : null,
      /** Why no check can run — an http-only or unreadable URL, or none. */
      blockedReason: "error" in target ? target.error : null,
      token,
      txtRecord: verificationTxtRecord(token),
      wellKnownPath: VERIFY_WELL_KNOWN_PATH,
      verifiedAt: verified ? row.verifiedAt : null,
      verifiedHost: verified ? row.verifiedHost : null,
    };
  });

export const verifyWebsite = os
  .use(requireAuth)
  .input(z.object({}))
  .handler(async ({ context }) => {
    const userId = context.user.id;
    // Each check is a DNS query and an outbound request on a host the caller
    // chose; the cost of hammering it belongs to them.
    await assertRateLimit(
      "website-verify",
      userId,
      10,
      "Too many verification checks — try again in a bit.",
    );

    const row = await loadOwnRow(userId);
    const target = verifiableHost(row.websiteUrl);
    if ("error" in target) throw new ORPCError("BAD_REQUEST", { message: target.error });

    const token = await ensureToken(userId, row.token);
    const result = await checkWebsiteVerification(target.host, token);

    if (!result.verified) {
      // A previous stamp on this host is now wrong: the record or file it
      // passed on is gone.
      if (row.verifiedHost === target.host) {
        await db
          .update(developerProfiles)
          .set({ websiteVerifiedAt: null, websiteVerifiedHost: null })
          .where(eq(developerProfiles.id, userId));
      }
      return { verified: false as const, reason: result.reason, verifiedAt: null };
    }

    const verifiedAt = new Date();
    await db
      .update(developerProfiles)
      .set({ websiteVerifiedAt: verifiedAt, websiteVerifiedHost: target.host })
      .where(eq(developerProfiles.id, userId));

    return { verified: true as const, method: result.method, host: target.host, verifiedAt };
  });
