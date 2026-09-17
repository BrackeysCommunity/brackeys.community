import { z } from "zod";

import { parseServiceConfig } from "../../../src/lib/service-config.ts";

const schema = z
  .object({
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1),
    NOTIFICATIONS_CONCURRENCY: z.coerce.number().int().positive().default(5),
    EMAIL_CONCURRENCY: z.coerce.number().int().positive().default(10),
    // Required, never defaulted: staging shares auth tables with production,
    // so a worker that silently minted production URLs would email real
    // users working unsubscribe links for the real site.
    APP_URL: z.url(),
    // Only the lifecycle sweep uses it, and only to DELETE the Discord
    // mirror of a post it just expired. Optional: without it the sweep
    // simply leaves mirrors alone, which is how every deploy behaved
    // before the mirror existed.
    DISCORD_BOT_TOKEN: z.string().min(1).optional(),
    RESEND_API_KEY: z.string().min(1).optional(),
    EMAIL_FROM: z.string().min(1).optional(),
    DISABLE_EMAIL: z.string().optional(),
  })
  .refine((cfg) => cfg.DISABLE_EMAIL === "1" || Boolean(cfg.RESEND_API_KEY), {
    message: "RESEND_API_KEY is required unless DISABLE_EMAIL=1",
    path: ["RESEND_API_KEY"],
  });

export const config = parseServiceConfig(schema);
export type Config = typeof config;
