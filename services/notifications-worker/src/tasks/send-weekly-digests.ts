import { and, eq, gt, isNotNull, sql } from "drizzle-orm";

import {
  notificationPreferences,
  notifications,
  user,
  userNotificationSettings,
} from "../../../../src/db/schema.ts";
import { db } from "../db/client.ts";
import { emailQueue, type SendEmailJob } from "../queue.ts";

const FALLBACK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Tick handler for the weekly digest cron. Finds every user with at
 * least one digest-eligible notification since their last digest
 * watermark (or the past 7 days if there's no watermark), then enqueues
 * a `digest` email job per user. The watermark is bumped only after
 * enqueue so a worker crash mid-tick re-runs the same window safely.
 */
export async function handleWeeklyDigests(): Promise<void> {
  const now = new Date();
  const fallbackSince = new Date(now.getTime() - FALLBACK_WINDOW_MS);

  // Users who have *any* type opted into digest. We treat the lower
  // bound as MAX(lastDigestAt, fallbackSince) per user, then group their
  // unread notifications since that bound.
  //
  // Implemented in two passes for clarity: (1) collect candidate users,
  // (2) for each, count items in window and enqueue if non-zero. The
  // candidate set is small (only opt-ins) so the second pass is cheap.
  const candidates = await db
    .selectDistinct({ userId: notificationPreferences.userId })
    .from(notificationPreferences)
    .where(eq(notificationPreferences.digest, true));

  if (candidates.length === 0) {
    console.log("[weekly_digests] no digest opt-ins");
    return;
  }

  let queued = 0;
  for (const { userId } of candidates) {
    // Confirm the user has an email on file before we do any work.
    const [recipient] = await db
      .select({ email: user.email })
      .from(user)
      .where(and(eq(user.id, userId), isNotNull(user.email)))
      .limit(1);
    if (!recipient?.email) continue;

    const [settings] = await db
      .select({ lastDigestAt: userNotificationSettings.lastDigestAt })
      .from(userNotificationSettings)
      .where(eq(userNotificationSettings.userId, userId))
      .limit(1);

    const since = settings?.lastDigestAt
      ? new Date(Math.max(settings.lastDigestAt.getTime(), fallbackSince.getTime()))
      : fallbackSince;

    const [{ n } = { n: 0 }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), gt(notifications.createdAt, since)));

    if (!n || n === 0) continue;

    const job: SendEmailJob = { kind: "digest", userId, since: since.toISOString() };
    await emailQueue.add("send", job, {
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: 500,
      removeOnFail: 2000,
    });

    await db
      .insert(userNotificationSettings)
      .values({ userId, lastDigestAt: now })
      .onConflictDoUpdate({
        target: userNotificationSettings.userId,
        set: { lastDigestAt: now, updatedAt: now },
      });

    queued += 1;
  }

  console.log("[weekly_digests] enqueued", { queued, candidates: candidates.length });
}
