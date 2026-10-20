import { createFileRoute } from "@tanstack/react-router";

import { RELAY_SIGNATURE_HEADER, verifyRelay } from "@/lib/bot-relay-signature";
import { syncDiscordProfileByDiscordId } from "@/lib/guild-sync";
import { bestEffort } from "@/lib/posthog-server";

const SNOWFLAKE = /^\d{17,20}$/;

/**
 * The Discord bot posts here when the gateway reports a member's avatar,
 * nickname or username changed. The body names only who changed; what
 * changed is re-read from Discord by `syncDiscordProfile`, so a signed but
 * stale or forged payload can't write anything Discord doesn't say.
 */
export const Route = createFileRoute("/api/discord/member-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.DISCORD_BOT_TOKEN;
        if (!secret) return new Response(null, { status: 503 });

        const body = await request.text();
        if (!(await verifyRelay(secret, body, request.headers.get(RELAY_SIGNATURE_HEADER)))) {
          return new Response(null, { status: 401 });
        }

        let parsed: { discordId?: unknown };
        try {
          parsed = JSON.parse(body) as { discordId?: unknown };
        } catch {
          return new Response(null, { status: 400 });
        }
        const { discordId } = parsed;
        if (typeof discordId !== "string" || !SNOWFLAKE.test(discordId)) {
          return new Response(null, { status: 400 });
        }

        const synced = await bestEffort("guild_sync.member_relay", { discord_id: discordId }, () =>
          syncDiscordProfileByDiscordId(discordId),
        );
        return new Response(null, { status: synced ? 204 : 202 });
      },
    },
  },
});
