import {
  Client,
  Events,
  GatewayIntentBits,
  type GuildMember,
  type PartialGuildMember,
  type PartialUser,
  Partials,
  type User,
} from "discord.js";

import { createServiceTelemetry } from "../../../src/lib/service-telemetry.ts";
import { createPublicApi } from "./api.ts";
import { buildManifest } from "./commands/manifest.ts";
import { config } from "./config.ts";
import { createCooldown } from "./cooldown.ts";
import { createInteractionHandler } from "./discord/adapter.ts";
import { syncGuildCommands } from "./discord/register.ts";
import { createMemberRelay, identityChanged, type MemberIdentity } from "./member-relay.ts";
import { createMemo } from "./memo.ts";
import { siteName } from "./reply.ts";

/**
 * The Discord bot (plan 28): slash commands answered from the site's public
 * API tier. One gateway connection with the `Guilds` intent — interactions
 * arrive regardless of intents, and nothing here reads messages — and every
 * answer is a GET to `$APP_URL/api/public/rpc` through the edge. No
 * database, no Redis, no queue; plan 20 adds those to this process.
 *
 * With `MEMBER_RELAY` on it also holds `GuildMembers`, and tells the site
 * when a member's avatar or name changes so their profile doesn't wait for
 * the daily resync. That intent needs Discord's privileged intent review
 * first (see README).
 */

const telemetry = createServiceTelemetry("discord-bot");
const log = (line: string) => console.log(line);

const api = createPublicApi(config.APP_URL, { timeoutMs: config.BOT_API_TIMEOUT_MS, log });
const memo = createMemo(api, { hostName: config.JAM_HOST_NAME, log });
const cooldown = createCooldown({
  limit: config.COOLDOWN_LIMIT,
  windowMs: config.COOLDOWN_WINDOW_MS,
});

const memberRelay = config.MEMBER_RELAY
  ? createMemberRelay({ appUrl: config.APP_URL, secret: config.DISCORD_BOT_TOKEN, log })
  : null;

const client = new Client({
  intents: memberRelay
    ? [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
    : [GatewayIntentBits.Guilds],
  // Members aren't cached ahead of time, so an update for one we haven't
  // seen arrives with a partial old copy — without these it isn't emitted.
  partials: memberRelay ? [Partials.GuildMember, Partials.User] : [],
});

function userIdentity(user: User | PartialUser): MemberIdentity | null {
  if (user.partial) return null;
  return { guildAvatar: null, nickname: null, avatar: user.avatar, username: user.username };
}

function memberIdentity(member: GuildMember | PartialGuildMember): MemberIdentity | null {
  if (member.partial) return null;
  return {
    guildAvatar: member.avatar,
    nickname: member.nickname,
    avatar: member.user.avatar,
    username: member.user.username,
  };
}

if (memberRelay) {
  client.on(Events.GuildMemberUpdate, (old, next) => {
    if (next.guild.id !== config.DISCORD_GUILD_ID) return;
    if (identityChanged(memberIdentity(old), memberIdentity(next)!)) memberRelay.relay(next.id);
  });
  client.on(Events.UserUpdate, (old, next) => {
    if (identityChanged(userIdentity(old), userIdentity(next)!)) memberRelay.relay(next.id);
  });
}

client.on(
  Events.InteractionCreate,
  createInteractionHandler({
    api,
    memo,
    cooldown,
    telemetry,
    appUrl: config.APP_URL,
    hostName: config.JAM_HOST_NAME,
    shareGate: {
      roleIds: config.SHARE_ROLE_IDS,
      botChannelId: config.BOT_CHANNEL_ID ?? null,
      botChannelName: config.BOT_CHANNEL_NAME,
    },
    log,
  }),
);

client.once(Events.ClientReady, async (ready) => {
  log(`[boot] gateway ready as ${ready.user.tag}`);
  try {
    await syncGuildCommands(ready.rest, {
      applicationId: config.DISCORD_APPLICATION_ID,
      guildId: config.DISCORD_GUILD_ID,
      commands: buildManifest(siteName(config.APP_URL)),
      log,
    });
  } catch (error) {
    // Registration failing must not crash-loop the process: each loop would
    // re-attempt the PUT. Commands already registered keep working.
    console.error("[register] failed", error);
    telemetry.captureException(error, { scope: "register" });
  }
});

client.on(Events.Error, (error) => {
  console.error("[gateway] error", error);
  telemetry.captureException(error, { scope: "gateway" });
});
client.on(Events.ShardDisconnect, (event) => log(`[gateway] disconnected (${event.code})`));
client.on(Events.ShardResume, (_id, replayed) =>
  log(`[gateway] resumed, ${replayed} events replayed`),
);

// The memo warms while the gateway connects; autocomplete answers empty
// until the first refresh lands rather than holding the login.
const warm = memo.start().then(() => log(`[memo] warm ${JSON.stringify(memo.sizes())}`));
await client.login(config.DISCORD_BOT_TOKEN);
await warm;

log(`[boot] discord-bot started — api ${config.APP_URL}, guild ${config.DISCORD_GUILD_ID}`);

async function shutdown(signal: string) {
  log(`[boot] received ${signal}, draining...`);
  memo.stop();
  memberRelay?.stop();
  await client.destroy();
  // Before exit, not after: an interaction that failed in the last seconds
  // is exactly the one worth keeping.
  await telemetry.shutdown();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
