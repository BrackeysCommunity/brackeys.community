import { and, eq } from "drizzle-orm";

import {
  developerProfiles,
  notificationPreferences,
  notifications,
  user,
} from "../../../../src/db/schema.ts";
import { EMAIL_IMMEDIATE, NOTIFICATION_DEFAULTS } from "../../../../src/lib/notification-copy.ts";
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

  // 1. Publish to the user's SSE channel — fan out to every open tab.
  //    Done before the email decision so live UIs flip the bell ASAP.
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

  // 2. Email decision: only transactional types are eligible; check the
  //    user's per-type pref; and *suppress* if any tab is currently
  //    streaming the bell (presence registry). When suppressed we still
  //    log so we can audit how often it kicks in.
  if (!EMAIL_IMMEDIATE.has(row.type)) {
    console.log("[side_effects] not email-eligible", { id: row.id, type: row.type });
    return;
  }

  const wantsEmail = await readEmailPref(row.userId, row.type);
  if (!wantsEmail) {
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
 * Resolves the email preference for (userId, type). Falls back to the
 * shared default table when the user hasn't customized this type, and
 * requires the user actually has an email address recorded in `auth.user`.
 */
async function readEmailPref(userId: string, type: string): Promise<boolean> {
  const [u] = await db.select({ email: user.email }).from(user).where(eq(user.id, userId)).limit(1);
  if (!u?.email) return false;

  const [pref] = await db
    .select({ email: notificationPreferences.email })
    .from(notificationPreferences)
    .where(and(eq(notificationPreferences.userId, userId), eq(notificationPreferences.type, type)))
    .limit(1);

  if (pref) return pref.email;
  const fallback = NOTIFICATION_DEFAULTS[type as keyof typeof NOTIFICATION_DEFAULTS];
  return fallback?.email ?? false;
}
