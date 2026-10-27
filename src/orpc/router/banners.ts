import { os } from "@orpc/server";
import { eq, sql } from "drizzle-orm";
import * as z from "zod";

import { db } from "@/db";
import { bannerHistory } from "@/db/schema";
import { assertRateLimit } from "@/lib/rate-limit";
import { requireAuth } from "@/orpc/middleware/auth";

const bannerRecord = z.object({
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/),
  firstSeen: z.number().int().nonnegative(),
  closed: z.boolean(),
});

/**
 * Folds this browser's banner records into the account's and returns the
 * merged history. The earliest first sighting wins and a close is never
 * undone, so two devices can sync in any order and agree.
 */
export const syncBannerHistory = os
  .use(requireAuth)
  .input(z.object({ records: z.array(bannerRecord).max(100) }))
  .handler(async ({ input, context }) => {
    const userId = context.user.id;
    if (input.records.length > 0) {
      await assertRateLimit("banner-history", userId, 60, "Too many banner updates.");
      const now = Date.now();
      await db
        .insert(bannerHistory)
        .values(
          input.records.map((r) => {
            const firstSeenAt = new Date(Math.min(r.firstSeen, now));
            return {
              userId,
              bannerId: r.id,
              firstSeenAt,
              closedAt: r.closed ? new Date(now) : null,
            };
          }),
        )
        .onConflictDoUpdate({
          target: [bannerHistory.userId, bannerHistory.bannerId],
          set: {
            firstSeenAt: sql`least(${bannerHistory.firstSeenAt}, excluded.first_seen_at)`,
            closedAt: sql`coalesce(${bannerHistory.closedAt}, excluded.closed_at)`,
          },
        });
    }

    const rows = await db
      .select({
        id: bannerHistory.bannerId,
        firstSeenAt: bannerHistory.firstSeenAt,
        closedAt: bannerHistory.closedAt,
      })
      .from(bannerHistory)
      .where(eq(bannerHistory.userId, userId));
    return rows.map((r) => ({
      id: r.id,
      firstSeen: r.firstSeenAt.getTime(),
      closed: r.closedAt !== null,
    }));
  });
