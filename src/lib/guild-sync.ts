import { and, eq } from "drizzle-orm";
import type IORedis from "ioredis";

import { db } from "@/db";
import { account, developerProfiles, profileUrlStubs, user } from "@/db/schema";
import { openBetterAuthToken } from "@/lib/better-auth-tokens";
import {
  discordAvatarUrl,
  fetchDiscordUser,
  fetchGuildMember,
  isDiscordAvatarUrl,
  resolveRoleNames,
} from "@/lib/discord";
import { bestEffort } from "@/lib/posthog-server";
import { createRedisClient } from "@/lib/redis";
import { discordUsernameToStub } from "@/lib/url-stub";

/**
 * Pull the user's current Discord identity (guild nickname, roles, avatar)
 * into `developer_profiles`. Runs on every session create, and again from
 * `refreshGuildRolesThrottled` so staff permissions don't stay frozen at
 * last sign-in.
 *
 * Returns whether the guild-member fetch actually succeeded — a failure
 * (not in guild, expired token, Discord down) never clears cached data.
 */
export async function syncDiscordProfile(userId: string): Promise<{ guildRolesSynced: boolean }> {
  const [userRecord] = await db.select().from(user).where(eq(user.id, userId)).limit(1);
  if (!userRecord) return { guildRolesSynced: false };

  // Fetch Discord guild data from the stored access token
  let discordId: string | null = null;
  let guildNickname: string | null = null;
  let guildJoinedAt: Date | null = null;
  let guildRoles: string[] | null = null;
  let latestDiscordAvatarUrl: string | null = null;
  let latestDiscordUsername: string | null = null;

  try {
    const [discordAccount] = await db
      .select()
      .from(account)
      .where(and(eq(account.userId, userId), eq(account.providerId, "discord")))
      .limit(1);

    if (discordAccount?.accessToken) {
      discordId = discordAccount.accountId;
      // Selected straight from the account table, so decryption is
      // on us (better-auth only decrypts in its own endpoints).
      const discordToken = await openBetterAuthToken(discordAccount.accessToken);
      try {
        // The member payload embeds the user object, so guild members
        // get their current avatar with no extra Discord call.
        const member = await fetchGuildMember(discordToken);
        guildNickname = member.nick;
        guildJoinedAt = new Date(member.joined_at);
        guildRoles = resolveRoleNames(member.roles);
        if (member.user) {
          latestDiscordAvatarUrl = discordAvatarUrl(member.user);
          latestDiscordUsername = member.user.username;
        }
      } catch {
        // User not in guild (or rate limited) — continue without guild data
      }
      if (!latestDiscordAvatarUrl) {
        const discordUser = await fetchDiscordUser(discordToken);
        latestDiscordAvatarUrl = discordAvatarUrl(discordUser);
        latestDiscordUsername = discordUser.username;
      }
    }
  } catch {
    // Token may be expired or Discord unavailable — continue with what we have
  }

  // Refresh a stale Discord avatar, but never clobber a non-Discord
  // one (e.g. sourced from GitHub).
  let avatarUrl = userRecord.image;
  if (
    latestDiscordAvatarUrl &&
    latestDiscordAvatarUrl !== userRecord.image &&
    (userRecord.image == null || isDiscordAvatarUrl(userRecord.image))
  ) {
    avatarUrl = latestDiscordAvatarUrl;
    await db
      .update(user)
      .set({ image: avatarUrl, updatedAt: new Date() })
      .where(eq(user.id, userId));
  }

  await db
    .insert(developerProfiles)
    .values({
      id: userId,
      discordId,
      discordUsername: userRecord.name,
      avatarUrl,
      guildNickname,
      guildJoinedAt,
      guildRoles,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: developerProfiles.id,
      set: {
        discordId: discordId ?? undefined,
        discordUsername: userRecord.name,
        avatarUrl,
        guildNickname: guildNickname ?? undefined,
        guildJoinedAt: guildJoinedAt ?? undefined,
        guildRoles: guildRoles ?? undefined,
        updatedAt: new Date(),
      },
    });

  if (latestDiscordUsername) {
    // Best-effort: a stub collision or DB hiccup must not fail sign-in.
    await bestEffort("guild_sync.url_stub", { user_id: userId }, () =>
      syncDefaultUrlStub(userId, latestDiscordUsername),
    );
  }

  return { guildRolesSynced: guildRoles != null };
}

/**
 * Default the profile's vanity URL to the Discord username, once: only a
 * profile with no stub at all gets one, so anything already claimed —
 * whether defaulted earlier or picked by the member — is never touched,
 * and a stub another profile holds is never stolen. After this, the stub
 * changes only through `setUrlStub`.
 */
async function syncDefaultUrlStub(userId: string, discordUsername: string): Promise<void> {
  const stub = discordUsernameToStub(discordUsername);
  if (!stub) return;

  const [existing] = await db
    .select({ id: profileUrlStubs.id })
    .from(profileUrlStubs)
    .where(eq(profileUrlStubs.profileId, userId))
    .limit(1);
  if (existing) return;

  const [taken] = await db
    .select({ profileId: profileUrlStubs.profileId })
    .from(profileUrlStubs)
    .where(eq(profileUrlStubs.stub, stub))
    .limit(1);
  if (taken) return;

  // `doNothing`, not upsert: concurrent syncs (or a racing claim of the
  // same stub) must not overwrite whoever got there first.
  await db
    .insert(profileUrlStubs)
    .values({
      profileId: userId,
      stub,
      source: "discord",
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoNothing();
}

// ── Throttled staff-role refresh ────────────────────────────────────────────
//
// `guildRoles` is otherwise as stale as the user's last sign-in: a demoted
// moderator would keep staff power until they next authenticate. Staff-gated
// middleware fires this on every hit; the Redis NX key keeps actual Discord
// traffic to at most one refresh per user per hour.

declare global {
  // eslint-disable-next-line no-var
  var __brackeysGuildSyncRedis: IORedis | undefined;
}

const REFRESH_TTL_SECONDS = 3600;
// Short initial lock: it only has to outlive one refresh attempt. The full
// window is granted on success; a failure releases the key so the next
// staff request retries instead of waiting out the hour.
const LOCK_TTL_SECONDS = 300;

async function getRedis(): Promise<IORedis> {
  if (globalThis.__brackeysGuildSyncRedis) return globalThis.__brackeysGuildSyncRedis;
  globalThis.__brackeysGuildSyncRedis = await createRedisClient("guild-sync");
  return globalThis.__brackeysGuildSyncRedis;
}

/**
 * Fire-and-forget guild role refresh, at most once per hour per user.
 * Never throws: Redis being down skips the refresh entirely rather than
 * bypassing the throttle, and Discord being down leaves the cached roles
 * in place — the staff path must never gain a hard Discord dependency.
 */
export async function refreshGuildRolesThrottled(userId: string): Promise<void> {
  const key = `guild-sync:refresh:${userId}`;
  let redis: IORedis;
  let won: string | null;
  try {
    redis = await getRedis();
    won = await redis.set(key, "1", "EX", LOCK_TTL_SECONDS, "NX");
  } catch {
    return;
  }
  if (won !== "OK") return;

  // A failed refresh gates who `requireGuildMember` lets comment and post,
  // so it's reported, not just logged.
  const result = await bestEffort("guild_sync.role_refresh", { user_id: userId }, () =>
    syncDiscordProfile(userId),
  );
  const synced = result?.guildRolesSynced ?? false;

  try {
    if (synced) {
      await redis.set(key, "1", "EX", REFRESH_TTL_SECONDS, "XX");
    } else {
      await redis.del(key);
    }
  } catch {
    // Best-effort: Redis being down here just leaves the 5-minute lock.
  }
}
