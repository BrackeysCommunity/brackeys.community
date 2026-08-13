import type IORedis from "ioredis";

import { createRedisClient } from "@/lib/redis";

declare global {
  // eslint-disable-next-line no-var
  var __brackeysDiscordRedis: IORedis | undefined;
}

export interface DiscordApiUser {
  id: string;
  avatar: string | null;
}

export interface DiscordGuildMember {
  avatar: string | null;
  nick: string | null;
  roles: string[];
  joined_at: string;
  bio: string | null;
  pending: boolean;
  flags: number;
  user?: DiscordApiUser;
}

const DISCORD_CDN = "https://cdn.discordapp.com";

/**
 * True when a stored avatar URL points at Discord's CDN — i.e. it came from
 * Discord and is safe to refresh, as opposed to a GitHub or custom avatar.
 */
export function isDiscordAvatarUrl(url: string | null | undefined): boolean {
  return url != null && url.startsWith(`${DISCORD_CDN}/`);
}

/**
 * CDN URL for a user's current Discord avatar, matching the format better-auth
 * stores at signup: gif for animated hashes, and the default embed avatar when
 * the user has none.
 */
export function discordAvatarUrl(discordUser: DiscordApiUser): string {
  if (!discordUser.avatar) {
    const index = Number((BigInt(discordUser.id) >> 22n) % 6n);
    return `${DISCORD_CDN}/embed/avatars/${index}.png`;
  }
  const format = discordUser.avatar.startsWith("a_") ? "gif" : "png";
  return `${DISCORD_CDN}/avatars/${discordUser.id}/${discordUser.avatar}.${format}`;
}

// Hardcoded role ID → display name map.
// Update these when guild roles change.
const GUILD_ROLE_NAMES: Record<string, string> = {
  "451380371284557824": "Admin",
  "756285704061059213": "Staff",
  "756178968901582859": "Moderator",
};

/** Resolve an array of role IDs to their display names, dropping unknown IDs. */
export function resolveRoleNames(roleIds: string[]): string[] {
  return roleIds.map((id) => GUILD_ROLE_NAMES[id]).filter((name): name is string => name != null);
}

// Discord *user* IDs granted Admin regardless of their live guild roles —
// the owner break-glass, so a role-map drift or guild mishap can't lock the
// site out of its own admin surface. Applied at sync time (`guild-sync`), so
// the grant lands in the same cached `guildRoles` every check already reads.
const ADMIN_USER_OVERRIDES = new Set(["474678259280510977"]);

/** Union a member's resolved role names with any per-user override grants. */
export function applyRoleOverrides(
  discordUserId: string | null | undefined,
  roleNames: string[],
): string[] {
  if (!discordUserId || !ADMIN_USER_OVERRIDES.has(discordUserId)) return roleNames;
  return roleNames.includes("Admin") ? roleNames : [...roleNames, "Admin"];
}

/** Check if guild roles contain a specific role name. */
export function hasRole(guildRoles: string[] | null, roleName: string): boolean {
  if (!guildRoles) return false;
  return guildRoles.includes(roleName);
}

/** Check if the user is a staff member (Staff, Moderator, or Admin). */
export function isStaffMember(guildRoles: string[] | null): boolean {
  if (!guildRoles) return false;
  return guildRoles.some((role) => role === "Admin" || role === "Staff" || role === "Moderator");
}

/** Check if the user is an Admin. */
export function isAdmin(guildRoles: string[] | null): boolean {
  return hasRole(guildRoles, "Admin");
}

// ── Rate-limit hygiene ─────────────────────────────────────────────
//
// Railway egress IPs are shared across tenants, and a Cloudflare 1015 ban
// on discord.com takes OAuth sign-in down with it (better-auth's token
// exchange hits the same zone). So we are deliberately heavy handed:
// every call funnels through `discordFetch`, any 429 opens a Redis-backed
// backoff window shared across instances, and guild membership is cached
// so middleware traffic to discord.com is near zero. Redis being down must
// never hurt more than Discord being down — the cache/backoff plumbing
// swallows its own errors.

const BACKOFF_KEY = "discord:backoff-until";
const DEFAULT_BACKOFF_SECONDS = 30;
const MAX_BACKOFF_SECONDS = 900;
const MEMBER_CACHE_TTL_SECONDS = 600;
const NON_MEMBER_CACHE_TTL_SECONDS = 120;

/** Thrown when we refuse to call discord.com because a rate-limit backoff window is active. */
export class DiscordBackoffError extends Error {
  constructor(untilEpochMs: number) {
    super(
      `Discord requests suspended until ${new Date(untilEpochMs).toISOString()} (rate limited)`,
    );
    this.name = "DiscordBackoffError";
  }
}

async function getRedis(): Promise<IORedis> {
  if (globalThis.__brackeysDiscordRedis) return globalThis.__brackeysDiscordRedis;
  globalThis.__brackeysDiscordRedis = await createRedisClient("discord");
  return globalThis.__brackeysDiscordRedis;
}

async function getBackoffUntil(): Promise<number | null> {
  try {
    const redis = await getRedis();
    const raw = await redis.get(BACKOFF_KEY);
    if (!raw) return null;
    const until = Number(raw);
    return Number.isFinite(until) && until > Date.now() ? until : null;
  } catch {
    return null;
  }
}

async function openBackoffWindow(retryAfterSeconds: number): Promise<void> {
  const seconds = Math.min(
    Math.max(retryAfterSeconds, DEFAULT_BACKOFF_SECONDS),
    MAX_BACKOFF_SECONDS,
  );
  try {
    const redis = await getRedis();
    const until = Date.now() + seconds * 1000;
    // Keep the furthest-out window if two instances hit 429 concurrently.
    const existing = Number((await redis.get(BACKOFF_KEY)) ?? 0);
    if (until > existing) {
      await redis.set(BACKOFF_KEY, String(until), "EX", seconds);
    }
  } catch {
    // Backoff is best-effort — never let Redis failures mask the 429 itself.
  }
}

function parseRetryAfter(response: Response): number {
  const header = Number(response.headers.get("retry-after"));
  return Number.isFinite(header) && header > 0 ? header : DEFAULT_BACKOFF_SECONDS;
}

/**
 * Fetch against discord.com that fails fast while the shared backoff window
 * is active and opens/extends that window whenever Discord answers 429.
 */
async function discordFetch(url: string, init: RequestInit): Promise<Response> {
  const backoffUntil = await getBackoffUntil();
  if (backoffUntil) throw new DiscordBackoffError(backoffUntil);

  const response = await fetch(url, init);
  if (response.status === 429) {
    await openBackoffWindow(parseRetryAfter(response));
  }
  return response;
}

export async function fetchGuildMember(accessToken: string): Promise<DiscordGuildMember> {
  const guildId = process.env.DISCORD_GUILD_ID!;
  const response = await discordFetch(
    `https://discord.com/api/users/@me/guilds/${guildId}/member`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch guild member: ${response.status}`);
  }

  return response.json() as Promise<DiscordGuildMember>;
}

/**
 * Fetch the OAuth user's own profile. Only needed when the guild-member
 * lookup can't answer (user not in the guild) — the member payload already
 * embeds the user object.
 */
export async function fetchDiscordUser(accessToken: string): Promise<DiscordApiUser> {
  const response = await discordFetch("https://discord.com/api/users/@me", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Discord user: ${response.status}`);
  }

  return response.json() as Promise<DiscordApiUser>;
}

function memberCacheKey(discordUserId: string): string {
  return `discord:guild-member:${discordUserId}`;
}

/**
 * Forget a user's cached membership, e.g. when they delete their account.
 * Errors propagate so deletion flows can surface incomplete cleanup; the
 * cache TTL (≤10 min) is the backstop if this is skipped.
 */
export async function purgeGuildMemberCache(discordUserId: string): Promise<void> {
  const redis = await getRedis();
  await redis.del(memberCacheKey(discordUserId));
}

async function readCachedMembership(discordUserId: string): Promise<boolean | null> {
  try {
    const redis = await getRedis();
    const cached = await redis.get(memberCacheKey(discordUserId));
    return cached === null ? null : cached === "1";
  } catch {
    return null;
  }
}

async function writeCachedMembership(discordUserId: string, isMember: boolean): Promise<void> {
  try {
    const redis = await getRedis();
    await redis.set(
      memberCacheKey(discordUserId),
      isMember ? "1" : "0",
      "EX",
      isMember ? MEMBER_CACHE_TTL_SECONDS : NON_MEMBER_CACHE_TTL_SECONDS,
    );
  } catch {
    // Cache is an optimization — membership answers must not depend on Redis.
  }
}

/**
 * Check if a Discord user is a member of the guild using the bot token,
 * answering from the Redis cache when possible. Fails closed (returns
 * false) when rate limited or when Discord errors.
 */
export async function isGuildMember(discordUserId: string): Promise<boolean> {
  const cached = await readCachedMembership(discordUserId);
  if (cached !== null) return cached;

  const guildId = process.env.DISCORD_GUILD_ID!;
  const botToken = process.env.DISCORD_BOT_TOKEN!;
  let response: Response;
  try {
    response = await discordFetch(
      `https://discord.com/api/v10/guilds/${guildId}/members/${discordUserId}`,
      {
        headers: {
          Authorization: `Bot ${botToken}`,
        },
      },
    );
  } catch {
    return false;
  }

  // Only a definitive yes (200) or no (404) is cacheable; a 429/5xx tells
  // us nothing about membership, so deny without poisoning the cache.
  if (response.ok) {
    await writeCachedMembership(discordUserId, true);
    return true;
  }
  if (response.status === 404) {
    await writeCachedMembership(discordUserId, false);
    return false;
  }
  return false;
}
