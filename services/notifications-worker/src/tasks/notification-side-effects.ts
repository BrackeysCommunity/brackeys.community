import { and, eq } from "drizzle-orm";

import {
  developerProfiles,
  type NotificationType,
  notificationPreferences,
  notifications,
  user,
} from "../../../../src/db/schema.ts";
import { NOTIFICATION_DEFAULTS } from "../../../../src/lib/notification-copy.ts";
import { isEmailGloballyDisabled } from "../../../../src/lib/unsubscribe.ts";
import { db } from "../db/client.ts";
import {
  emailQueue,
  isUserOnline,
  presenceChannel,
  publisher,
  type NotificationSideEffectsJob,
  type SendEmailJob,
} from "../queue.ts";

export async function handleSideEffects(data: NotificationSideEffectsJob): Promise<void> {
  const [row] = await db
    .select({
      id: notifications.id,
      userId: notifications.userId,
      type: notifications.type,
      actorId: notifications.actorId,
      data: notifications.data,
      createdAt: notifications.createdAt,
      readAt: notifications.readAt,
    })
    .from(notifications)
    .where(eq(notifications.id, data.notificationId))
    .limit(1);

  if (!row) {
    console.warn("[side_effects] notification missing", { id: data.notificationId });
    return;
  }

  // Pull actor display name (used by both SSE payload and email render).
  let actorUsername: string | null = null;
  if (row.actorId) {
    const [actor] = await db
      .select({ discordUsername: developerProfiles.discordUsername })
      .from(developerProfiles)
      .where(eq(developerProfiles.id, row.actorId))
      .limit(1);
    actorUsername = actor?.discordUsername ?? null;
  }

  const prefs = await readPrefs(row.userId, row.type);

  // 1. Publish to the user's SSE channel — fan out to every open tab.
  //    Done before the email decision so live UIs flip the bell ASAP.
  //    Skipped when the user's inApp pref is off: the inbox filters these
  //    rows out at read time, so a live bell bump would count a row the
  //    refetch can never see.
  if (prefs.inApp) {
    const ssePayload = JSON.stringify({
      id: row.id,
      type: row.type,
      actorUsername,
      data: row.data,
      createdAt: row.createdAt,
    });
    try {
      await publisher.publish(presenceChannel(row.userId), ssePayload);
    } catch (err) {
      console.warn("[side_effects] publish failed", { id: row.id, err });
    }
  }

  // 2. Email decision: the user's resolved per-type pref decides — the
  //    NOTIFICATION_DEFAULTS email column is the default for users with no
  //    row, so a ticked Email checkbox works for every type, not just the
  //    default-on ones. Honour the global kill switch, and *suppress* if
  //    any tab is currently streaming the bell (presence registry). When
  //    suppressed we still log so we can audit how often it kicks in.
  if (await isEmailGloballyDisabled(db, row.userId)) {
    console.log("[side_effects] emails disabled by user", { id: row.id, userId: row.userId });
    return;
  }

  if (!prefs.email || !(await hasEmailOnFile(row.userId))) {
    console.log("[side_effects] email pref off", { id: row.id, type: row.type });
    return;
  }

  if (await isUserOnline(row.userId)) {
    console.log("[side_effects] online — suppressing email", { id: row.id, userId: row.userId });
    return;
  }

  const job: SendEmailJob = { kind: "transactional", notificationId: row.id };
  await emailQueue.add("send", job, {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  });
}

/**
 * Resolves the (userId, type) delivery preferences, falling back to the
 * shared default table when the user hasn't customized this type. Also
 * re-read by the email job at send time — a pref can change while a job
 * sits in retry backoff.
 */
export async function readPrefs(
  userId: string,
  type: NotificationType,
): Promise<{ inApp: boolean; email: boolean }> {
  const [pref] = await db
    .select({
      inApp: notificationPreferences.inApp,
      email: notificationPreferences.email,
    })
    .from(notificationPreferences)
    .where(and(eq(notificationPreferences.userId, userId), eq(notificationPreferences.type, type)))
    .limit(1);

  const fallback = NOTIFICATION_DEFAULTS[type as keyof typeof NOTIFICATION_DEFAULTS];
  return {
    inApp: pref?.inApp ?? fallback?.inApp ?? true,
    email: pref?.email ?? fallback?.email ?? false,
  };
}

/** Email delivery additionally requires an address recorded in `auth.user`. */
async function hasEmailOnFile(userId: string): Promise<boolean> {
  const [u] = await db.select({ email: user.email }).from(user).where(eq(user.id, userId)).limit(1);
  return Boolean(u?.email);
}
