import { and, eq, gt, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";

import {
  notificationPreferences,
  notifications,
  user,
  userNotificationSettings,
} from "../../../../src/db/schema.ts";
import { DIGEST_DEFAULT_ON } from "../../../../src/lib/notification-copy.ts";
import { db } from "../db/client.ts";
import { emailQueue, type SendEmailJob } from "../queue.ts";

/**
 * SQL condition: this notification's type resolves to digest-on for its
 * user — an explicit opt-in row, or no row for a type whose default is on.
 * Requires a LEFT JOIN of notification_preferences on (userId, type).
 */
export const digestEligible = or(
  eq(notificationPreferences.digest, true),
  and(isNull(notificationPreferences.digest), inArray(notifications.type, [...DIGEST_DEFAULT_ON])),
)!;

export const digestPreferenceJoin = and(
  eq(notificationPreferences.userId, notifications.userId),
  eq(notificationPreferences.type, notifications.type),
)!;

const FALLBACK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Tick handler for the weekly digest cron. Finds every user with at
 * least one digest-eligible notification since their last digest
 * watermark (or the past 7 days if there's no watermark), then enqueues
 * a `digest` email job per user.
 *
 * The watermark moves in `sendDigest`, after a successful send — enqueue
 * is not delivery, and a job that exhausts its retries must leave the
 * window claimable by the next tick. Re-running the tick before the job
 * completes is safe because the job id is deterministic per window.
 */
export async function handleWeeklyDigests(): Promise<void> {
  const now = new Date();
  const fallbackSince = new Date(now.getTime() - FALLBACK_WINDOW_MS);

  // Candidates are users with a digest-eligible notification in the
  // fallback window — the same LEFT JOIN + `digestEligible` resolution the
  // send path uses, so "no row + a default-on type" counts. A candidate
  // query over explicit opt-in rows alone would never select the user who
  // sees two ticked Digest boxes on /settings purely by default.
  const candidates = await db
    .selectDistinct({ userId: notifications.userId })
    .from(notifications)
    .leftJoin(notificationPreferences, digestPreferenceJoin)
    .where(and(gt(notifications.createdAt, fallbackSince), digestEligible));

  if (candidates.length === 0) {
    console.log("[weekly_digests] no digest candidates");
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
      .select({
        lastDigestAt: userNotificationSettings.lastDigestAt,
        emailsDisabled: userNotificationSettings.emailsDisabled,
      })
      .from(userNotificationSettings)
      .where(eq(userNotificationSettings.userId, userId))
      .limit(1);

    // Skip while disabled; the watermark never moved, so on re-enable the
    // next tick reopens the window — capped at the 7-day fallback below,
    // so a month away yields the last week, not the month.
    if (settings?.emailsDisabled) continue;

    const since = settings?.lastDigestAt
      ? new Date(Math.max(settings.lastDigestAt.getTime(), fallbackSince.getTime()))
      : fallbackSince;

    // Only count notifications whose type the user actually digests —
    // opting into digest for one type must not sweep every type into the
    // email.
    const [{ n } = { n: 0 }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(notifications)
      .leftJoin(notificationPreferences, digestPreferenceJoin)
      .where(
        and(eq(notifications.userId, userId), gt(notifications.createdAt, since), digestEligible),
      );

    if (!n || n === 0) continue;

    const sinceIso = since.toISOString();
    const job: SendEmailJob = { kind: "digest", userId, since: sinceIso };
    // Deterministic id: a tick re-run before the job completes (or after a
    // crash) dedupes instead of double-sending the same window. Epoch ms,
    // not ISO — BullMQ custom ids must not contain colons.
    await emailQueue.add("send", job, {
      jobId: `digest-${userId}-${since.getTime()}`,
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: 500,
      removeOnFail: 2000,
    });

    queued += 1;
  }

  console.log("[weekly_digests] enqueued", { queued, candidates: candidates.length });
}
