import { eq } from "drizzle-orm";

import { notifications } from "../../../../src/db/schema.ts";
import { db } from "../db/client.ts";
import type { NotificationSideEffectsJob } from "../queue.ts";

export async function handleSideEffects(data: NotificationSideEffectsJob): Promise<void> {
  const [row] = await db
    .select()
    .from(notifications)
    .where(eq(notifications.id, data.notificationId))
    .limit(1);

  if (!row) {
    // Notification was deleted (e.g. user deleted account between insert and
    // worker pickup). Treat as a successful no-op so BullMQ doesn't retry.
    console.warn("[side_effects] notification missing", { id: data.notificationId });
    return;
  }

  // PR1: stub. PR4 (Phase 9) will publish to the user's Redis pub/sub channel
  // for SSE; PR4 (Phase 10) will look up email prefs and enqueue email jobs.
  console.log("[side_effects] processed", {
    id: row.id,
    type: row.type,
    userId: row.userId,
  });
}
