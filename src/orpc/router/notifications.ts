import { os } from "@orpc/server";
import { and, count, desc, eq, inArray, isNull, lt, lte, or, sql, type SQL } from "drizzle-orm";
import * as z from "zod";

import { db } from "@/db";
import {
  developerProfiles,
  notificationPreferences,
  notifications,
  type NotificationType,
} from "@/db/schema";
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY,
  NOTIFICATION_DEFAULTS,
  NOTIFICATION_TYPES,
  TYPES_BY_CATEGORY,
  type NotificationCategory,
} from "@/lib/notification-copy";
import {
  isEmailGloballyDisabled,
  setEmailsDisabled as setEmailsDisabledForUser,
} from "@/lib/unsubscribe";
import { requireAuth } from "@/orpc/middleware/auth";

const notificationTypeSchema = z.enum(
  NOTIFICATION_TYPES as [NotificationType, ...NotificationType[]],
);

/**
 * Join + condition pair enforcing the inApp preference at read time. Rows
 * whose (user, type) preference resolves to inApp=false stay in the table —
 * the worker still needs them for email/digest — but never surface in the
 * inbox or the bell count. Resolution for a missing row leans on the
 * documented invariant that every NOTIFICATION_DEFAULTS entry has
 * inApp: true ("In-app is always on" by default), so absent-row means
 * visible.
 */
const inAppPreferenceJoin = and(
  eq(notificationPreferences.userId, notifications.userId),
  eq(notificationPreferences.type, notifications.type),
);
const inAppVisible: SQL = or(
  isNull(notificationPreferences.inApp),
  eq(notificationPreferences.inApp, true),
)!;

const categorySchema = z.enum(
  NOTIFICATION_CATEGORIES as [NotificationCategory, ...NotificationCategory[]],
);

export const listNotifications = os
  .use(requireAuth)
  .input(
    z.object({
      cursor: z.number().optional(),
      limit: z.number().min(1).max(50).default(20),
      unreadOnly: z.boolean().optional(),
      /** Narrows to one inbox tab. Filtering here rather than over the
       *  loaded pages is what keeps a quiet category from looking empty
       *  until the reader has scrolled the busy ones into memory. */
      category: categorySchema.optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    const conditions = [eq(notifications.userId, context.user.id), inAppVisible];
    if (input.cursor !== undefined) conditions.push(lt(notifications.id, input.cursor));
    if (input.unreadOnly) conditions.push(isNull(notifications.readAt));
    if (input.category) {
      conditions.push(inArray(notifications.type, TYPES_BY_CATEGORY[input.category]));
    }

    const rows = await db
      .select({
        id: notifications.id,
        type: notifications.type,
        actorId: notifications.actorId,
        entityType: notifications.entityType,
        entityId: notifications.entityId,
        data: notifications.data,
        readAt: notifications.readAt,
        createdAt: notifications.createdAt,
        actorUsername: developerProfiles.discordUsername,
        actorAvatarUrl: developerProfiles.avatarUrl,
      })
      .from(notifications)
      .leftJoin(developerProfiles, eq(notifications.actorId, developerProfiles.id))
      .leftJoin(notificationPreferences, inAppPreferenceJoin)
      .where(and(...conditions))
      .orderBy(desc(notifications.id))
      .limit(input.limit + 1);

    const hasMore = rows.length > input.limit;
    const items = hasMore ? rows.slice(0, input.limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1]?.id : null;

    return { items, nextCursor };
  });

export const unreadCount = os
  .use(requireAuth)
  .input(z.object({}))
  .handler(async ({ context }) => {
    const [row] = await db
      .select({ count: count() })
      .from(notifications)
      .leftJoin(notificationPreferences, inAppPreferenceJoin)
      .where(
        and(eq(notifications.userId, context.user.id), isNull(notifications.readAt), inAppVisible),
      );
    return { count: row?.count ?? 0 };
  });

/**
 * Totals for the inbox masthead and its tab badges, in one round trip. The
 * grouping is by type — the category rollup happens here rather than in a
 * SQL `CASE` so `NOTIFICATION_CATEGORY` stays the only place the mapping is
 * written down.
 */
export const countNotifications = os
  .use(requireAuth)
  .input(z.object({}))
  .handler(async ({ context }) => {
    const rows = await db
      .select({
        type: notifications.type,
        total: count(),
        unread: sql<number>`count(*) filter (where ${notifications.readAt} is null)`.mapWith(
          Number,
        ),
      })
      .from(notifications)
      .leftJoin(notificationPreferences, inAppPreferenceJoin)
      .where(and(eq(notifications.userId, context.user.id), inAppVisible))
      .groupBy(notifications.type);

    const byCategory = Object.fromEntries(
      NOTIFICATION_CATEGORIES.map((c) => [c, { total: 0, unread: 0 }]),
    ) as Record<NotificationCategory, { total: number; unread: number }>;

    let total = 0;
    let unread = 0;
    for (const row of rows) {
      total += row.total;
      unread += row.unread;
      // A type retired from the copy tables can still have rows in the
      // table; it counts toward the totals but belongs to no tab.
      const category = NOTIFICATION_CATEGORY[row.type];
      if (!category) continue;
      byCategory[category].total += row.total;
      byCategory[category].unread += row.unread;
    }

    return { total, unread, byCategory };
  });

export const markRead = os
  .use(requireAuth)
  .input(z.object({ ids: z.array(z.number()).min(1).max(200) }))
  .handler(async ({ input, context }) => {
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.userId, context.user.id),
          inArray(notifications.id, input.ids),
          isNull(notifications.readAt),
        ),
      );
    return { ok: true };
  });

export const markAllRead = os
  .use(requireAuth)
  .input(z.object({ before: z.number().optional() }))
  .handler(async ({ input, context }) => {
    const conditions = [eq(notifications.userId, context.user.id), isNull(notifications.readAt)];
    if (input.before !== undefined) conditions.push(lte(notifications.id, input.before));

    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(...conditions));
    return { ok: true };
  });

// ── Preferences ─────────────────────────────────────────────────────────────

/**
 * Returns one row per notification type, merged with the shared defaults
 * so the UI always sees a complete matrix even on first visit, plus the
 * global email kill switch that overrides the whole matrix.
 */
export const getPreferences = os
  .use(requireAuth)
  .input(z.object({}))
  .handler(async ({ context }) => {
    const [rows, emailsDisabled] = await Promise.all([
      db
        .select()
        .from(notificationPreferences)
        .where(eq(notificationPreferences.userId, context.user.id)),
      isEmailGloballyDisabled(db, context.user.id),
    ]);

    const byType = new Map(rows.map((r) => [r.type as NotificationType, r]));

    return {
      emailsDisabled,
      preferences: NOTIFICATION_TYPES.map((type) => {
        const existing = byType.get(type);
        const fallback = NOTIFICATION_DEFAULTS[type];
        return {
          type,
          inApp: existing?.inApp ?? fallback.inApp,
          email: existing?.email ?? fallback.email,
          digest: existing?.digest ?? fallback.digest,
        };
      }),
    };
  });

/**
 * Global email opt-out. Deliberately separate from the per-type matrix:
 * turning it back off restores whatever the user had configured rather
 * than resetting every type, so it reads as a pause, not a wipe.
 */
export const setEmailsDisabled = os
  .use(requireAuth)
  .input(z.object({ disabled: z.boolean() }))
  .handler(async ({ input, context }) => {
    await setEmailsDisabledForUser(db, context.user.id, input.disabled);
    return { ok: true };
  });

export const updatePreference = os
  .use(requireAuth)
  .input(
    z.object({
      type: notificationTypeSchema,
      inApp: z.boolean().optional(),
      email: z.boolean().optional(),
      digest: z.boolean().optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    const fallback = NOTIFICATION_DEFAULTS[input.type];
    const next = {
      userId: context.user.id,
      type: input.type,
      inApp: input.inApp ?? fallback.inApp,
      email: input.email ?? fallback.email,
      digest: input.digest ?? fallback.digest,
      updatedAt: new Date(),
    };

    await db
      .insert(notificationPreferences)
      .values(next)
      .onConflictDoUpdate({
        target: [notificationPreferences.userId, notificationPreferences.type],
        set: {
          inApp: next.inApp,
          email: next.email,
          digest: next.digest,
          updatedAt: next.updatedAt,
        },
      });

    return { ok: true };
  });

export type NotificationTypeName = NotificationType;
