import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  NOTIFICATIONS_CONCURRENCY: z.coerce.number().int().positive().default(5),
  EMAIL_CONCURRENCY: z.coerce.number().int().positive().default(10),
});

export const config = schema.parse(process.env);
export type Config = typeof config;
