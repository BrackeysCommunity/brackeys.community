import { and, eq, gte } from "drizzle-orm";
import { createElement } from "react";

import { developerProfiles, notifications, user } from "../../../../src/db/schema.ts";
import { NotificationEmail } from "../../../../src/emails/NotificationEmail.tsx";
import { WeeklyDigestEmail } from "../../../../src/emails/WeeklyDigestEmail.tsx";
import { NOTIFICATION_TYPE_LABEL } from "../../../../src/lib/notification-copy.ts";
import {
  buildUnsubscribeUrl,
  getOrCreateUnsubscribeToken,
} from "../../../../src/lib/unsubscribe.ts";
import { db } from "../db/client.ts";
import { APP_URL, sendEmail } from "../email.ts";
import type { SendEmailJob } from "../queue.ts";

/** Headers required by RFC 8058 + bulk-sender rules. The same URL is
 * surfaced in the email body so the inbox affordance and visible link
 * never disagree. */
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

  let actorUsername: string | null = null;
  if (row.actorId) {
    const [actor] = await db
      .select({ discordUsername: developerProfiles.discordUsername })
      .from(developerProfiles)
      .where(eq(developerProfiles.id, row.actorId))
      .limit(1);
    actorUsername = actor?.discordUsername ?? null;
  }

  const token = await getOrCreateUnsubscribeToken(db, row.userId);
  const unsubscribeUrl = buildUnsubscribeUrl(APP_URL, token, row.type);
  const unsubscribeAllUrl = buildUnsubscribeUrl(APP_URL, token);

  const subject = NOTIFICATION_TYPE_LABEL[row.type] ?? "New notification";
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
      unsubscribeUrl,
      unsubscribeAllUrl,
    }),
    tags: [
      { name: "category", value: "notification" },
      { name: "type", value: row.type },
    ],
    headers: listUnsubHeaders(unsubscribeUrl),
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

  const rows = await db
    .select({
      type: notifications.type,
      data: notifications.data,
      createdAt: notifications.createdAt,
      actorUsername: developerProfiles.discordUsername,
    })
    .from(notifications)
    .leftJoin(developerProfiles, eq(notifications.actorId, developerProfiles.id))
    .where(and(eq(notifications.userId, userId), gte(notifications.createdAt, since)))
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
  console.log("[send_email:digest] sent", { userId, count: items.length, resendId: result?.id });
}
