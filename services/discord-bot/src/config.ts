import { z } from "zod";

import { parseServiceConfig } from "../../../src/lib/service-config.ts";

const snowflake = z.string().regex(/^\d{17,20}$/, "expected a Discord snowflake id");

const schema = z
  .object({
    DISCORD_BOT_TOKEN: z.string().min(1),
    // The application id is the OAuth client id — the bot and sign-in are one
    // Discord application — and the web app already ships it to Railway as
    // DISCORD_CLIENT_ID. Either name works so the shared variable can be
    // referenced as-is.
    DISCORD_APPLICATION_ID: snowflake.optional(),
    DISCORD_CLIENT_ID: snowflake.optional(),
    DISCORD_GUILD_ID: snowflake,
    // Required, never defaulted: deep links and the API origin come from one
    // variable, and a bot that silently defaulted to production would answer
    // a scratch guild with real data (or the real guild with staging's).
    APP_URL: z.url().transform((url) => url.replace(/\/+$/, "")),
    JAM_HOST_NAME: z.string().trim().min(1).default("Brackeys"),
    // Per API call, after the interaction is deferred. Comfortably inside the
    // 3 s initial-response window and Discord's 15 min follow-up token.
    BOT_API_TIMEOUT_MS: z.coerce.number().int().positive().max(10_000).default(2000),
    // Per-user sliding window. A free-text `search` is the one input that
    // reaches Postgres uncached; this stops one member turning the bot into
    // a load generator.
    COOLDOWN_LIMIT: z.coerce.number().int().positive().default(10),
    COOLDOWN_WINDOW_MS: z.coerce.number().int().positive().default(10_000),
  })
  .transform(({ DISCORD_APPLICATION_ID, DISCORD_CLIENT_ID, ...rest }, ctx) => {
    const applicationId = DISCORD_APPLICATION_ID ?? DISCORD_CLIENT_ID;
    if (!applicationId) {
      ctx.addIssue({
        code: "custom",
        path: ["DISCORD_APPLICATION_ID"],
        message: "set DISCORD_APPLICATION_ID or DISCORD_CLIENT_ID",
      });
      return z.NEVER;
    }
    return { ...rest, DISCORD_APPLICATION_ID: applicationId };
  });

export const config = parseServiceConfig(schema);
export type Config = typeof config;
