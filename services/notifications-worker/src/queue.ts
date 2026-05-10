import IORedis from "ioredis";

import { config } from "./config.ts";

export const redis = new IORedis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
});

export const NOTIFICATIONS_QUEUE = "notifications";
export const EMAIL_QUEUE = "email";

export type NotificationSideEffectsJob = { notificationId: number };
