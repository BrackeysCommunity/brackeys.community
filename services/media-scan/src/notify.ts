import {
  type NotifyParams,
  recordNotification,
  SIDE_EFFECTS_JOB_OPTIONS,
} from "../../../src/lib/notify-core.ts";
import { db } from "./db/client.ts";
import { notificationsQueue } from "./queue.ts";

/**
 * The worker-side `notify()` — the shared write path plus the same
 * `side_effects` job the app enqueues, so the resident notifications
 * worker handles email/SSE for a quarantine notice like any other.
 */
export async function notify(
  params: Omit<NotifyParams, "actorId" | "dedupeWithin">,
): Promise<void> {
  const result = await recordNotification(db, { ...params, actorId: null });
  if (!result) return;
  try {
    await notificationsQueue.add(
      "side_effects",
      { notificationId: result.id },
      SIDE_EFFECTS_JOB_OPTIONS,
    );
  } catch (err) {
    console.warn("[notify] failed to enqueue side-effects", { id: result.id, err });
  }
}
