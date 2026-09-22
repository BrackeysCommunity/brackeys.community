import type IORedis from "ioredis";

import { createRedisClient } from "@/lib/redis";

declare global {
  // eslint-disable-next-line no-var
  var __brackeysDiscordRedis: IORedis | undefined;
}

export interface DiscordApiUser {
  id: string;
  /** The unique login name (not the display name / global_name). */
  username: string;
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

/**
 * CDN URL for a member's guild-specific avatar — the one `member.avatar`
 * names on the guild member payload — or null when they have none, so the
 * caller falls back to the global avatar rather than a broken image.
 */
export function discordGuildAvatarUrl(
  discordUserId: string,
  guildAvatarHash: string | null | undefined,
  guildId: string | undefined = process.env.DISCORD_GUILD_ID,
): string | null {
  if (!guildAvatarHash || !guildId) return null;
  const format = guildAvatarHash.startsWith("a_") ? "gif" : "png";
  return `${DISCORD_CDN}/guilds/${guildId}/users/${discordUserId}/avatars/${guildAvatarHash}.${format}`;
}

// Hardcoded role ID → display name map.
// Update these when guild roles change.
const GUILD_ROLE_NAMES: Record<string, string> = {
  "491536338525356042": "Brackeys Team",
  "451380371284557824": "Admin",
  "756285704061059213": "Staff",
  "756178968901582859": "Moderator",
  "439862048185253891": "Guru",
  "543773411575463941": "BIP",
};

/** Resolve an array of role IDs to their display names, dropping unknown IDs. */
export function resolveRoleNames(roleIds: string[]): string[] {
  return roleIds.map((id) => GUILD_ROLE_NAMES[id]).filter((name): name is string => name != null);
}

// Discord *user* IDs granted Admin regardless of their live guild roles —
// the owner break-glass, so a role-map drift or guild mishap can't lock the
// site out of its own admin surface. Comma-separated in ADMIN_DISCORD_IDS
// (env, not source, so the IDs aren't public in the repo). Applied when
// authorizing, in `lib/staff-roles.ts` — never written to the cache.
export function adminUserOverrides(): Set<string> {
  return new Set(
    (process.env.ADMIN_DISCORD_IDS ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  );
}

/**
 * Role names the same override list grants. "Admin" is the break-glass and
 * is what `isStaffMember` / `isAdmin` read. "Dev" is cosmetic — no gate
 * matches it, it exists only so `guildRankOf` can put a Dev chip on the
 * people who run this place. Both ride one list, so adding an id during an
 * outage hands out the chip as well as the access.
 */
const OVERRIDE_ROLE_NAMES = ["Admin", "Dev"] as const;

/** Union a member's resolved role names with any per-user override grants. */
export function applyRoleOverrides(
  discordUserId: string | null | undefined,
  roleNames: string[],
): string[] {
  if (!discordUserId || !adminUserOverrides().has(discordUserId)) return roleNames;
  const missing = OVERRIDE_ROLE_NAMES.filter((name) => !roleNames.includes(name));
  return missing.length === 0 ? roleNames : [...roleNames, ...missing];
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
// every call funnels through `guardedFetch`, any 429 opens a Redis-backed
// backoff window shared across instances, and guild membership is cached
// so middleware traffic to discord.com is near zero. Redis being down must
// never hurt more than Discord being down — the cache/backoff plumbing
// swallows its own errors.

const BACKOFF_KEY = "discord:backoff-until";
const DEFAULT_BACKOFF_SECONDS = 30;
const MAX_BACKOFF_SECONDS = 900;
const MEMBER_CACHE_TTL_SECONDS = 600;
const NON_MEMBER_CACHE_TTL_SECONDS = 120;
const BOOSTING_CACHE_TTL_SECONDS = 600;
const NOT_BOOSTING_CACHE_TTL_SECONDS = 300;
// Asymmetric: the negative must not pin an un-ban for half an hour.
const GUILD_BAN_CACHE_TTL_SECONDS = 1800;
const NOT_GUILD_BANNED_CACHE_TTL_SECONDS = 300;

/** All `discordFetch` takes: no method, no body, nowhere to put a write. */
type DiscordReadInit = { headers: Record<string, string> };

/** The write funnel's init — a method it must name, and a JSON body. */
export type DiscordWriteInit = {
  method: "POST" | "PATCH" | "DELETE";
  headers: Record<string, string>;
  body?: unknown;
};

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
 * The one place discord.com is called from. Fails fast while the shared
 * backoff window is active, and opens/extends that window on any 429 —
 * whichever caller provoked it, because the thing being protected is the
 * shared egress IP, not a per-route budget.
 */
async function guardedFetch(url: string, init: RequestInit): Promise<Response> {
  const backoffUntil = await getBackoffUntil();
  if (backoffUntil) throw new DiscordBackoffError(backoffUntil);

  const response = await fetch(url, init);
  if (response.status === 429) {
    await openBackoffWindow(parseRetryAfter(response));
  }
  return response;
}

/**
 * Every *read* against discord.com. Read-only by construction: the method is
 * hardcoded to GET and the init type carries nothing else, so no caller can
 * reach a Discord mutation through this funnel.
 *
 * Moderation still flows one way: guild bans are mirrored *into* the app
 * (`isGuildBanned`), never written back out. Banning on Discord stays a
 * thing humans do in Discord.
 */
async function discordFetch(url: string, init: DiscordReadInit): Promise<Response> {
  return guardedFetch(url, { headers: init.headers, method: "GET" });
}

/**
 * The single write funnel, added for the collab feed mirror
 * (`src/lib/collab-discord-feed.ts`) and deliberately narrow: it writes
 * *messages* into one configured channel and nothing else. Guild state —
 * members, roles, bans — stays read-only above.
 *
 * Exported rather than left private so the mirror shares this file's
 * rate-limit hygiene: a 429 on a message POST is the same Cloudflare 1015
 * risk to OAuth sign-in as a 429 on a member read, and it has to open the
 * same window.
 */
export async function discordWriteFetch(url: string, init: DiscordWriteInit): Promise<Response> {
  return guardedFetch(url, {
    method: init.method,
    headers:
      init.body === undefined
        ? init.headers
        : { ...init.headers, "content-type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
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

async function readCachedFlag(key: string): Promise<boolean | null> {
  try {
    const redis = await getRedis();
    const cached = await redis.get(key);
    return cached === null ? null : cached === "1";
  } catch {
    return null;
  }
}

async function writeCachedFlag(key: string, value: boolean, ttlSeconds: number): Promise<void> {
  try {
    const redis = await getRedis();
    await redis.set(key, value ? "1" : "0", "EX", ttlSeconds);
  } catch {
    // Cache is an optimization — answers must not depend on Redis.
  }
}

function readCachedMembership(discordUserId: string): Promise<boolean | null> {
  return readCachedFlag(memberCacheKey(discordUserId));
}

function writeCachedMembership(discordUserId: string, isMember: boolean): Promise<void> {
  return writeCachedFlag(
    memberCacheKey(discordUserId),
    isMember,
    isMember ? MEMBER_CACHE_TTL_SECONDS : NON_MEMBER_CACHE_TTL_SECONDS,
  );
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

function boostCacheKey(discordUserId: string): string {
  return `discord:guild-boost:${discordUserId}`;
}

/** `undefined` is a cache miss; `null` is a cached "not boosting". */
async function readCachedBoost(discordUserId: string): Promise<Date | null | undefined> {
  try {
    const redis = await getRedis();
    const cached = await redis.get(boostCacheKey(discordUserId));
    if (cached === null) return undefined;
    return cached === "0" ? null : new Date(cached);
  } catch {
    return undefined;
  }
}

async function writeCachedBoost(discordUserId: string, since: Date | null): Promise<void> {
  try {
    const redis = await getRedis();
    await redis.set(
      boostCacheKey(discordUserId),
      since ? since.toISOString() : "0",
      "EX",
      since ? BOOSTING_CACHE_TTL_SECONDS : NOT_BOOSTING_CACHE_TTL_SECONDS,
    );
  } catch {
    // Cache is an optimization — answers must not depend on Redis.
  }
}

/**
 * When this member's current server boost began, or null if they aren't
 * boosting. **Undefined means Discord didn't say** — rate limited, down, or
 * an error — and the caller must leave whatever it already stored alone
 * rather than read the silence as "stopped boosting".
 *
 * This needs the bot token even though guild sync already holds a member
 * payload: the OAuth `users/@me/guilds/{id}/member` endpoint does not carry
 * `premium_since`, so boosting is invisible on that route. Verified against
 * a member Discord reports as boosting — the bot endpoint returns the date,
 * the OAuth one omits the field entirely.
 */
export async function fetchBoostingSince(discordUserId: string): Promise<Date | null | undefined> {
  const cached = await readCachedBoost(discordUserId);
  if (cached !== undefined) return cached;

  const guildId = process.env.DISCORD_GUILD_ID!;
  const botToken = process.env.DISCORD_BOT_TOKEN!;
  if (!guildId || !botToken) return undefined;

  let response: Response;
  try {
    response = await discordFetch(
      `https://discord.com/api/v10/guilds/${guildId}/members/${discordUserId}`,
      { headers: { Authorization: `Bot ${botToken}` } },
    );
  } catch {
    return undefined;
  }

  if (response.ok) {
    const member = (await response.json()) as { premium_since?: string | null };
    const since = member.premium_since ? new Date(member.premium_since) : null;
    await writeCachedBoost(discordUserId, since);
    return since;
  }
  // 404 is a member the guild doesn't have, which is a definitive "not
  // boosting". Anything else (429, 5xx) says nothing worth caching.
  if (response.status === 404) {
    await writeCachedBoost(discordUserId, null);
    return null;
  }
  return undefined;
}

function banCacheKey(discordUserId: string): string {
  return `discord:guild-ban:${discordUserId}`;
}

/**
 * Whether Discord has this user banned from the guild. Unlike `isGuildMember`
 * this **fails open** — only 200 (banned) and 404 (not) are answers. Requires
 * the bot to hold BAN_MEMBERS.
 */
export async function isGuildBanned(discordUserId: string): Promise<boolean> {
  const cached = await readCachedFlag(banCacheKey(discordUserId));
  if (cached !== null) return cached;

  const guildId = process.env.DISCORD_GUILD_ID!;
  const botToken = process.env.DISCORD_BOT_TOKEN!;
  if (!guildId || !botToken) return false;

  let response: Response;
  try {
    response = await discordFetch(
      `https://discord.com/api/v10/guilds/${guildId}/bans/${discordUserId}`,
      { headers: { Authorization: `Bot ${botToken}` } },
    );
  } catch {
    return false;
  }

  if (response.ok) {
    await writeCachedFlag(banCacheKey(discordUserId), true, GUILD_BAN_CACHE_TTL_SECONDS);
    return true;
  }
  if (response.status === 404) {
    await writeCachedFlag(banCacheKey(discordUserId), false, NOT_GUILD_BANNED_CACHE_TTL_SECONDS);
    return false;
  }
  // 403 (bot missing BAN_MEMBERS), 429, 5xx — not cacheable, and not a ban.
  return false;
}

/** Forget a cached guild-ban answer, e.g. when staff lift the app ban. */
export async function purgeGuildBanCache(discordUserId: string): Promise<void> {
  const redis = await getRedis();
  await redis.del(banCacheKey(discordUserId));
}
