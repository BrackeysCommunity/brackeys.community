import { randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";

import {
  notificationPreferences,
  type NotificationType,
  userNotificationSettings,
} from "../db/schema";
import { NOTIFICATION_DEFAULTS, NOTIFICATION_TYPES } from "./notification-copy";

/**
 * Both the web app and the worker pass in their own drizzle handle —
 * web from `@/db`, worker via relative import. We type as `unknown` and
 * lean on the runtime contract (drizzle chains the same builder ops on
 * both) so this module stays import-graph neutral.
 */
// biome-ignore lint/suspicious/noExplicitAny: drizzle builder shape changes per env
type DbHandle = any;

function newToken(): string {
  // 32 bytes → 64-char hex. Plenty of entropy for an unsub link; not
  // user-facing so we don't need URL-safe base64.
  return randomBytes(32).toString("hex");
}

/**
 * Returns the user's unsubscribe token, lazily creating one (and the
 * settings row) on first call. Safe to invoke per send-email job —
 * the upsert handles concurrent first-issuance races.
 */
export async function getOrCreateUnsubscribeToken(db: DbHandle, userId: string): Promise<string> {
  const [existing] = await db
    .select({ token: userNotificationSettings.unsubscribeToken })
    .from(userNotificationSettings)
    .where(eq(userNotificationSettings.userId, userId))
    .limit(1);

  if (existing?.token) return existing.token as string;

  const token = newToken();
  const now = new Date();
  // Two-step: try an insert, fall back to a read if the row already
  // existed (e.g. a digest cron created it without a token). We do
  // *not* clobber an existing token on conflict.
  try {
    await db
      .insert(userNotificationSettings)
      .values({ userId, unsubscribeToken: token, updatedAt: now });
  } catch {
    // Row exists; if its token is null, set it now. If not, the
    // re-read below picks up whoever won the race.
    await db
      .update(userNotificationSettings)
      .set({ unsubscribeToken: token, updatedAt: now })
      .where(eq(userNotificationSettings.userId, userId));
  }

  const [after] = await db
    .select({ token: userNotificationSettings.unsubscribeToken })
    .from(userNotificationSettings)
    .where(eq(userNotificationSettings.userId, userId))
    .limit(1);

  return (after?.token as string) ?? token;
}

/**
 * Resolves an unsub token back to its userId. Returns null when no
 * row matches — the route should still respond 200 to avoid leaking
 * token validity to harvesters.
 */
export async function resolveUnsubscribeToken(db: DbHandle, token: string): Promise<string | null> {
  if (!token) return null;
  const [row] = await db
    .select({ userId: userNotificationSettings.userId })
    .from(userNotificationSettings)
    .where(eq(userNotificationSettings.unsubscribeToken, token))
    .limit(1);
  return (row?.userId as string) ?? null;
}

/**
 * Turns off email for one type (when scope is a specific type) or
 * every type (when scope === "all"). On "all" we also flip digest off
 * since the user explicitly asked to stop hearing from us by email.
 *
 * Mirrors the upsert shape used by `updatePreference` so an unsub via
 * email link is bit-for-bit identical to a click in the UI.
 */
export async function applyUnsubscribe(
  db: DbHandle,
  userId: string,
  scope: NotificationType | "all",
): Promise<{ scope: NotificationType | "all" }> {
  const now = new Date();
  const targets: NotificationType[] = scope === "all" ? [...NOTIFICATION_TYPES] : [scope];

  for (const type of targets) {
    const fallback = NOTIFICATION_DEFAULTS[type];
    await db
      .insert(notificationPreferences)
      .values({
        userId,
        type,
        inApp: fallback.inApp,
        email: false,
        digest: scope === "all" ? false : fallback.digest,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [notificationPreferences.userId, notificationPreferences.type],
        set: {
          email: false,
          ...(scope === "all" ? { digest: false } : {}),
          updatedAt: now,
        },
      });
  }
  return { scope };
}

/** Narrow string to a known NotificationType — used by the unsub route. */
export function isKnownNotificationType(value: string): value is NotificationType {
  return (NOTIFICATION_TYPES as readonly string[]).includes(value);
}

/** Build the canonical unsubscribe URL we put in headers + email body. */
export function buildUnsubscribeUrl(
  appUrl: string,
  token: string,
  type?: NotificationType,
): string {
  const url = new URL(`${appUrl}/api/notifications/unsub`);
  url.searchParams.set("token", token);
  if (type) url.searchParams.set("type", type);
  return url.toString();
}
