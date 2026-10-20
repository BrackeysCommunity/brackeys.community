import { and, eq } from "drizzle-orm";
import type IORedis from "ioredis";

import { db } from "@/db";
import { account, developerProfiles, profileUrlStubs, user } from "@/db/schema";
import {
  type DiscordGuildMember,
  discordAvatarUrl,
  discordGuildAvatarUrl,
  fetchBoostingSince,
  fetchDiscordUser,
  fetchGuildMember,
  fetchGuildMemberAsBot,
  isDiscordAvatarUrl,
  resolveRoleNames,
} from "@/lib/discord";
import { freshOAuthToken } from "@/lib/oauth-token";
import { bestEffort } from "@/lib/posthog-server";
import { createRedisClient } from "@/lib/redis";
import { discordUsernameToStub } from "@/lib/url-stub";

/**
 * Pull the user's current Discord identity (guild nickname, roles, avatar)
 * into `developer_profiles`. Runs on every session create, from
 * `refreshDiscordProfileThrottled` so nothing stays frozen at last sign-in,
 * and from the bot's member-update relay
 * (`syncDiscordProfileByDiscordId`) when a member changes their avatar.
 *
 * Returns whether the guild-member fetch actually succeeded — a failure
 * (not in guild, expired token, Discord down) never clears cached data.
 */
export async function syncDiscordProfile(userId: string): Promise<{ guildRolesSynced: boolean }> {
  const [userRecord] = await db.select().from(user).where(eq(user.id, userId)).limit(1);
  if (!userRecord) return { guildRolesSynced: false };

  let discordId: string | null = null;
  let guildNickname: string | null = null;
  let guildJoinedAt: Date | null = null;
  let guildRoles: string[] | null = null;
  // Undefined until the member payload is in hand: a failed fetch must not
  // clear a guild avatar we already stored, but a successful one with no
  // avatar on it means they removed theirs, and that has to land as null.
  let guildAvatarUrl: string | null | undefined;
  // Same three-state reason as the avatar above: `fetchBoostingSince` answers
  // null for a member who has stopped boosting — which must clear the stamp —
  // and undefined when Discord didn't say, which must leave it alone.
  let discordBoosterSince: Date | null | undefined;
  let latestDiscordAvatarUrl: string | null = null;
  let latestDiscordUsername: string | null = null;

  try {
    const [discordAccount] = await db
      .select({ accountId: account.accountId })
      .from(account)
      .where(and(eq(account.userId, userId), eq(account.providerId, "discord")))
      .limit(1);

    if (discordAccount) {
      discordId = discordAccount.accountId;
      // Sessions roll forward for as long as the member stays active, but the
      // Discord grant behind them lasts a week, so the stored token has to be
      // refreshed rather than read as-is.
      const discordToken = await freshOAuthToken("discord", userId);
      let member: DiscordGuildMember | null | undefined;
      if (discordToken) {
        try {
          member = await fetchGuildMember(discordToken);
        } catch {
          // User not in guild (or rate limited) — the bot read below decides
        }
      }
      // Same payload through the bot token, so a dead grant can't freeze
      // the profile at whatever it was on the last sign-in.
      member ??= await fetchGuildMemberAsBot(discordId);
      if (member) {
        guildNickname = member.nick;
        guildJoinedAt = new Date(member.joined_at);
        guildRoles = resolveRoleNames(member.roles);
        guildAvatarUrl = discordGuildAvatarUrl(discordId, member.avatar);
        // The member payload embeds the user object, so guild members
        // get their current avatar with no extra Discord call.
        if (member.user) {
          latestDiscordAvatarUrl = discordAvatarUrl(member.user);
          latestDiscordUsername = member.user.username;
        }
      }
      // Its own call on purpose: boosting is absent from the OAuth member
      // payload above, so the bot token is the only route to it. Cached in
      // Redis by `fetchBoostingSince`, and sync runs on session create, so
      // this is nowhere near Discord's rate limits.
      discordBoosterSince = await fetchBoostingSince(discordId);
      if (!latestDiscordAvatarUrl && discordToken) {
        const discordUser = await fetchDiscordUser(discordToken);
        latestDiscordAvatarUrl = discordAvatarUrl(discordUser);
        latestDiscordUsername = discordUser.username;
      }
    }
  } catch {
    // Discord unavailable — continue with what we have
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
      discordHandle: latestDiscordUsername,
      avatarUrl,
      guildNickname,
      guildAvatarUrl: guildAvatarUrl ?? null,
      guildJoinedAt,
      guildRoles,
      discordBoosterSince: discordBoosterSince ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: developerProfiles.id,
      set: {
        discordId: discordId ?? undefined,
        discordUsername: userRecord.name,
        // `?? undefined` for the same reason the guild fields use it: a
        // failed Discord fetch must not blank a handle we already hold.
        discordHandle: latestDiscordUsername ?? undefined,
        avatarUrl,
        guildNickname: guildNickname ?? undefined,
        guildAvatarUrl,
        guildJoinedAt: guildJoinedAt ?? undefined,
        guildRoles: guildRoles ?? undefined,
        discordBoosterSince,
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
 * The sync for a Discord id rather than a site user — what the bot knows
 * when the gateway reports a member change. False when no account is linked
 * to that id.
 */
export async function syncDiscordProfileByDiscordId(discordId: string): Promise<boolean> {
  const [linked] = await db
    .select({ userId: account.userId })
    .from(account)
    .where(and(eq(account.providerId, "discord"), eq(account.accountId, discordId)))
    .limit(1);
  if (!linked) return false;
  await syncDiscordProfile(linked.userId);
  return true;
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

// ── Throttled refresh ───────────────────────────────────────────────────────
//
// Without these the profile is as stale as the user's last sign-in, and
// sessions roll forward for as long as they stay active: a demoted moderator
// would keep staff power, and a changed avatar would go on pointing at a
// Discord CDN hash that no longer exists. Every signed-in request asks for
// the daily refresh and staff-gated ones for the hourly; Redis NX keys keep
// actual Discord traffic to one refresh per user per window.

declare global {
  // eslint-disable-next-line no-var
  var __appGuildSyncRedis: IORedis | undefined;
}

const REFRESH_WINDOWS = {
  staff: { ttlSeconds: 3600, retryAfterFailureSeconds: 0 },
  // A member who left the guild fails every sync, so a failure can't simply
  // release the key here the way it does for staff, or each of their
  // requests would reach Discord.
  daily: { ttlSeconds: 86_400, retryAfterFailureSeconds: 3600 },
} as const;
export type RefreshWindow = keyof typeof REFRESH_WINDOWS;

// Short initial lock: it only has to outlive one refresh attempt. The full
// window is granted on success.
const LOCK_TTL_SECONDS = 300;

// The daily check runs on every signed-in request; remembering which keys
// are already held saves a Redis round trip on all but the first.
const heldUntil = new Map<string, number>();
const HELD_MAX_ENTRIES = 50_000;

function isHeldLocally(key: string): boolean {
  const until = heldUntil.get(key);
  if (until === undefined) return false;
  if (until > Date.now()) return true;
  heldUntil.delete(key);
  return false;
}

function holdLocally(key: string, seconds: number): void {
  if (heldUntil.size >= HELD_MAX_ENTRIES) heldUntil.clear();
  heldUntil.set(key, Date.now() + seconds * 1000);
}

async function getRedis(): Promise<IORedis> {
  if (globalThis.__appGuildSyncRedis) return globalThis.__appGuildSyncRedis;
  globalThis.__appGuildSyncRedis = await createRedisClient("guild-sync");
  return globalThis.__appGuildSyncRedis;
}

/**
 * Fire-and-forget Discord profile refresh, at most once per window per user.
 * Never throws: Redis being down skips the refresh entirely rather than
 * bypassing the throttle, and Discord being down leaves the cached profile
 * in place — no request path may gain a hard Discord dependency.
 */
export async function refreshDiscordProfileThrottled(
  userId: string,
  window: RefreshWindow,
): Promise<void> {
  const { ttlSeconds, retryAfterFailureSeconds } = REFRESH_WINDOWS[window];
  const key = `guild-sync:refresh:${window}:${userId}`;
  if (isHeldLocally(key)) return;

  let redis: IORedis;
  let won: string | null;
  try {
    redis = await getRedis();
    won = await redis.set(key, "1", "EX", LOCK_TTL_SECONDS, "NX");
  } catch {
    return;
  }
  if (won !== "OK") {
    // Another request or replica holds it; don't ask Redis again for a while.
    holdLocally(key, LOCK_TTL_SECONDS);
    return;
  }

  // A failed refresh gates who `requireGuildMember` lets comment and post,
  // so it's reported, not just logged.
  const result = await bestEffort("guild_sync.refresh", { user_id: userId, window }, () =>
    syncDiscordProfile(userId),
  );
  const synced = result?.guildRolesSynced ?? false;

  try {
    if (synced) {
      await redis.set(key, "1", "EX", ttlSeconds, "XX");
      holdLocally(key, ttlSeconds);
    } else if (retryAfterFailureSeconds > 0) {
      await redis.set(key, "1", "EX", retryAfterFailureSeconds, "XX");
      holdLocally(key, retryAfterFailureSeconds);
    } else {
      await redis.del(key);
    }
  } catch {
    // Best-effort: Redis being down here just leaves the 5-minute lock.
  }
}
