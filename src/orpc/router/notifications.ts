import { os } from "@orpc/server";
import { and, count, desc, eq, inArray, isNull, lt, lte } from "drizzle-orm";
import * as z from "zod";

import { db } from "@/db";
import { developerProfiles, notifications } from "@/db/schema";
import { requireAuth } from "@/orpc/middleware/auth";

const NOTIFICATION_TYPES = [
  "collab_response_received",
  "collab_response_accepted",
  "collab_response_declined",
  "collab_post_featured",
  "collab_post_closed_by_staff",
] as const;

export const listNotifications = os
  .use(requireAuth)
  .input(
    z.object({
      cursor: z.number().optional(),
      limit: z.number().min(1).max(50).default(20),
      unreadOnly: z.boolean().optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    const conditions = [eq(notifications.userId, context.user.id)];
    if (input.cursor !== undefined) conditions.push(lt(notifications.id, input.cursor));
    if (input.unreadOnly) conditions.push(isNull(notifications.readAt));

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
      .where(and(eq(notifications.userId, context.user.id), isNull(notifications.readAt)));
    return { count: row?.count ?? 0 };
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

export type NotificationTypeName = (typeof NOTIFICATION_TYPES)[number];
