import { and, eq, gt } from "drizzle-orm";
import { createElement } from "react";

import {
  developerProfiles,
  notificationPreferences,
  notifications,
  user,
  userNotificationSettings,
} from "../../../../src/db/schema.ts";
import { NotificationEmail } from "../../../../src/emails/NotificationEmail.tsx";
import { WeeklyDigestEmail } from "../../../../src/emails/WeeklyDigestEmail.tsx";
import { renderNotificationText } from "../../../../src/lib/notification-copy.ts";
import { censorText } from "../../../../src/lib/profanity.ts";
import {
  buildUnsubscribeUrl,
  getOrCreateUnsubscribeToken,
  isEmailGloballyDisabled,
} from "../../../../src/lib/unsubscribe.ts";
import { db } from "../db/client.ts";
import { APP_URL, sendEmail } from "../email.ts";
import type { SendEmailJob } from "../queue.ts";
import { readPrefs } from "./notification-side-effects.ts";
import { digestEligible, digestPreferenceJoin } from "./send-weekly-digests.ts";

/** Headers required by RFC 8058 + bulk-sender rules. Always the all-scope
 * URL: Gmail's header affordance reads as "stop this sender", and pointing
 * it at one of 24 types means mail keeps arriving after the user pressed
 * it — the next press is the spam button. The labelled per-type link stays
 * in the body where its scope is visible. */
function listUnsubHeaders(unsubUrl: string): Record<string, string> {
  return {
    "List-Unsubscribe": `<${unsubUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

export async function handleSendEmail(job: { data: SendEmailJob }): Promise<void> {
  const data = job.data;
  if (data.kind === "transactional") return sendTransactional(data.notificationId);
  if (data.kind === "digest") return sendDigest(data.userId, data.since);
  // Exhaustive — TS will narrow this away if a new kind is added.
  const _exhaustive: never = data;
  throw new Error(`Unknown email kind: ${JSON.stringify(_exhaustive)}`);
}

async function sendTransactional(notificationId: number): Promise<void> {
  const [row] = await db
    .select({
      id: notifications.id,
      userId: notifications.userId,
      type: notifications.type,
      actorId: notifications.actorId,
      data: notifications.data,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(eq(notifications.id, notificationId))
    .limit(1);

  if (!row) {
    console.warn("[send_email:transactional] notification missing", { id: notificationId });
    return;
  }

  const [recipient] = await db
    .select({ email: user.email, name: user.name })
    .from(user)
    .where(eq(user.id, row.userId))
    .limit(1);

  if (!recipient?.email) {
    console.warn("[send_email:transactional] no email on file", { userId: row.userId });
    return;
  }

  // Re-checked here and not just at enqueue: this job may have been queued
  // before the switch was flipped, or be a retry from before it.
  if (await isEmailGloballyDisabled(db, row.userId)) {
    console.log("[send_email:transactional] emails disabled by user", { id: row.id });
    return;
  }

  // Same reasoning, one level down: the user can unsubscribe from this
  // type while the job sits in retry backoff.
  const prefs = await readPrefs(row.userId, row.type);
  if (!prefs.email) {
    console.log("[send_email:transactional] email pref off at send time", {
      id: row.id,
      type: row.type,
    });
    return;
  }

  let actorUsername: string | null = null;
  let actorAvatarUrl: string | null = null;
  if (row.actorId) {
    const [actor] = await db
      .select({
        discordUsername: developerProfiles.discordUsername,
        avatarUrl: developerProfiles.avatarUrl,
      })
      .from(developerProfiles)
      .where(eq(developerProfiles.id, row.actorId))
      .limit(1);
    actorUsername = actor?.discordUsername ?? null;
    actorAvatarUrl = actor?.avatarUrl ?? null;
  }

  const token = await getOrCreateUnsubscribeToken(db, row.userId);
  const unsubscribeUrl = buildUnsubscribeUrl(APP_URL, token, row.type);
  const unsubscribeAllUrl = buildUnsubscribeUrl(APP_URL, token);

  // The rendered headline, not the static per-type label: Gmail threads
  // byte-identical subjects from one sender, hiding the third "someone
  // responded" of the week under the first.
  const subject = censorText(
    renderNotificationText({ type: row.type, actorUsername, data: row.data }).headline,
  );
  const result = await sendEmail({
    to: recipient.email,
    subject,
    react: createElement(NotificationEmail, {
      appUrl: APP_URL,
      recipientName: recipient.name ?? null,
      notification: {
        type: row.type,
        actorUsername,
        data: row.data,
        createdAt: row.createdAt.toISOString(),
      },
      actorAvatarUrl,
      unsubscribeUrl,
      unsubscribeAllUrl,
    }),
    tags: [
      { name: "category", value: "notification" },
      { name: "type", value: row.type },
    ],
    headers: listUnsubHeaders(unsubscribeAllUrl),
  });
  console.log("[send_email:transactional] sent", { id: row.id, resendId: result?.id });
}

async function sendDigest(userId: string, sinceIso: string): Promise<void> {
  const since = new Date(sinceIso);
  const [recipient] = await db
    .select({ email: user.email, name: user.name })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);

  if (!recipient?.email) {
    console.warn("[send_email:digest] no email on file", { userId });
    return;
  }

  if (await isEmailGloballyDisabled(db, userId)) {
    console.log("[send_email:digest] emails disabled by user", { userId });
    return;
  }

  // Mirror the tick handler's eligibility filter — same `gt` bound, same
  // join: only types the user has digest-on (explicitly or by default)
  // land in the email body.
  const rows = await db
    .select({
      type: notifications.type,
      data: notifications.data,
      createdAt: notifications.createdAt,
      actorUsername: developerProfiles.discordUsername,
    })
    .from(notifications)
    .leftJoin(developerProfiles, eq(notifications.actorId, developerProfiles.id))
    .leftJoin(notificationPreferences, digestPreferenceJoin)
    .where(
      and(eq(notifications.userId, userId), gt(notifications.createdAt, since), digestEligible),
    )
    .orderBy(notifications.createdAt);

  const items = rows.map((r) => ({
    type: r.type,
    actorUsername: r.actorUsername,
    data: r.data,
    createdAt: r.createdAt.toISOString(),
  }));

  if (items.length === 0) {
    console.log("[send_email:digest] nothing to send", { userId });
    return;
  }

  const token = await getOrCreateUnsubscribeToken(db, userId);
  const unsubscribeUrl = buildUnsubscribeUrl(APP_URL, token);

  const result = await sendEmail({
    to: recipient.email,
    subject: `Your Brackeys weekly digest — ${items.length} ${items.length === 1 ? "update" : "updates"}`,
    react: createElement(WeeklyDigestEmail, {
      appUrl: APP_URL,
      recipientName: recipient.name ?? null,
      items,
      since: since.toISOString(),
      unsubscribeUrl,
    }),
    tags: [{ name: "category", value: "digest" }],
    headers: listUnsubHeaders(unsubscribeUrl),
  });

  // The watermark moves only after a successful send — enqueue is not
  // delivery, and a job that exhausts its retries must leave the window
  // claimable by the next tick. Bumping to the newest item's timestamp
  // (with `gt` bounds on both sides) means no item repeats and none falls
  // through the boundary.
  const newest = rows[rows.length - 1]!.createdAt;
  await db
    .insert(userNotificationSettings)
    .values({ userId, lastDigestAt: newest })
    .onConflictDoUpdate({
      target: userNotificationSettings.userId,
      set: { lastDigestAt: newest, updatedAt: new Date() },
    });

  console.log("[send_email:digest] sent", { userId, count: items.length, resendId: result?.id });
}
