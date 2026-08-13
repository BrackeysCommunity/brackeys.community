import { db } from "@/db";
import { recordNotification, SIDE_EFFECTS_JOB_OPTIONS, type NotifyParams } from "@/lib/notify-core";
import { getNotificationsQueue } from "@/lib/queue";

export type { NotifyParams };

/**
 * Records an in-app notification and enqueues async side-effects (email,
 * push, SSE broadcast) for the worker. The DB write is synchronous so the
 * bell badge reflects the new row on next poll; the enqueue is best-effort
 * and never fails the caller if Redis is unreachable.
 *
 * The write itself (preference gating, dedupe, insert) lives in
 * `notify-core.ts`, shared with the lifecycle-sweep service.
 */
export async function notify(params: NotifyParams): Promise<void> {
  if (params.actorId && params.actorId === params.userId) return;
  if (process.env.DISABLE_NOTIFICATIONS === "1") return;

  const result = await recordNotification(db, params);
  if (!result) return;

  try {
    const queue = await getNotificationsQueue();
    // bullmq's add() waits for connection readiness and never settles while
    // Redis is unreachable — fire-and-forget so an outage can't hold the
    // response; the job lands whenever the connection comes back.
    queue
      .add("side_effects", { notificationId: result.id }, SIDE_EFFECTS_JOB_OPTIONS)
      .catch((err: unknown) => {
        console.warn("[notify] failed to enqueue side-effects", { id: result.id, err });
      });
  } catch (err) {
    console.warn("[notify] failed to enqueue side-effects", { id: result.id, err });
  }
}
