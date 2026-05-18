import { Queue, Worker } from "bullmq";

import { config } from "./config.ts";
import { pool } from "./db/client.ts";
import { EMAIL_QUEUE, NOTIFICATIONS_QUEUE, publisher, redis, type SendEmailJob } from "./queue.ts";
import { handleSideEffects } from "./tasks/notification-side-effects.ts";
import { handleSendEmail } from "./tasks/send-email.ts";
import { handleWeeklyDigests } from "./tasks/send-weekly-digests.ts";

const notificationsQueue = new Queue(NOTIFICATIONS_QUEUE, { connection: redis });

const notificationsWorker = new Worker(
  NOTIFICATIONS_QUEUE,
  async (job) => {
    if (job.name === "side_effects") return handleSideEffects(job.data);
    if (job.name === "weekly_digests") return handleWeeklyDigests();
    console.warn("[notifications] unknown job", { name: job.name });
  },
  { connection: redis, concurrency: config.NOTIFICATIONS_CONCURRENCY },
);

const emailWorker = new Worker<SendEmailJob>(EMAIL_QUEUE, handleSendEmail, {
  connection: redis,
  concurrency: config.EMAIL_CONCURRENCY,
});

for (const w of [notificationsWorker, emailWorker]) {
  w.on("ready", () => console.log(`[worker:${w.name}] ready`));
  w.on("failed", (job, err) => {
    console.error(`[worker:${w.name}] job failed`, { id: job?.id, name: job?.name, err });
  });
  w.on("error", (err) => console.error(`[worker:${w.name}] error`, err));
}

// Repeatable job for weekly digests (Mondays 14:00 UTC). Stable jobId
// prevents BullMQ from registering duplicate schedulers across redeploys.
await notificationsQueue.add(
  "weekly_digests",
  {},
  {
    repeat: { pattern: "0 14 * * 1", tz: "UTC" },
    jobId: "weekly_digests",
  },
);

console.log("[boot] notifications-worker started");

async function shutdown(signal: string) {
  console.log(`[boot] received ${signal}, draining...`);
  await Promise.allSettled([
    notificationsWorker.close(),
    emailWorker.close(),
    notificationsQueue.close(),
  ]);
  await redis.quit().catch(() => {});
  await publisher.quit().catch(() => {});
  await pool.end().catch(() => {});
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
