import { capOf, capPattern } from "../../../packages/mmo-narrate/src/index.ts";
import { COOLDOWN_PREFIX } from "./cooldown.ts";
import { HELD_KEY } from "./narration/names.ts";
import { lastKey } from "./narration/voice.ts";
import { PARTY_PREFIX } from "./party.ts";

/**
 * What the bot's Redis holds of one Discord user, removed when the user
 * asks to be forgotten (GDD 14.9): the press limit, the narration's last
 * lines and daily counts, names held for review, and party threads'
 * member lists. Everything else the bot keeps names no user.
 */

/** The Redis calls a forget makes; ioredis's client is one. */
export interface RedisLike {
  scan(
    cursor: string,
    match: "MATCH",
    pattern: string,
    count: "COUNT",
    n: number,
  ): Promise<[cursor: string, keys: string[]]>;
  del(...keys: string[]): Promise<number>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  lrem(key: string, count: number, value: string): Promise<number>;
}

const SCAN_COUNT = 500;

/** A user id as a SCAN pattern matches it literally. */
function literal(s: string): string {
  return s.replace(/[*?[\]\\]/g, (c) => `\\${c}`);
}

async function scanAll(redis: RedisLike, pattern: string): Promise<string[]> {
  const out = new Set<string>();
  let cursor = "0";
  do {
    const [next, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", SCAN_COUNT);
    for (const k of keys) out.add(k);
    cursor = next;
  } while (cursor !== "0");
  return [...out];
}

/** Removes what the bot's Redis holds of a user; returns how many keys, entries and memberships went. */
export async function forgetUser(redis: RedisLike, user: string): Promise<number> {
  const u = literal(user);
  // A glob's * also crosses colons, so each key is checked by its parts.
  const last = (await scanAll(redis, lastKey("*", u))).filter((k) => k.split(":").at(-1) === user);
  const caps = (await scanAll(redis, capPattern(u))).filter((k) => capOf(k)?.who === user);
  const keys = [`${COOLDOWN_PREFIX}${user}`, ...last, ...caps];
  let n = await redis.del(...keys);

  for (const raw of await redis.lrange(HELD_KEY, 0, -1)) {
    let held: { user?: unknown };
    try {
      held = JSON.parse(raw) as { user?: unknown };
    } catch {
      continue;
    }
    if (held?.user === user) n += await redis.lrem(HELD_KEY, 0, raw);
  }

  for (const key of await scanAll(redis, `${PARTY_PREFIX}*`)) {
    const raw = await redis.get(key);
    if (!raw) continue;
    let kept: { members?: unknown };
    try {
      kept = JSON.parse(raw) as { members?: unknown };
    } catch {
      continue;
    }
    if (!kept || !Array.isArray(kept.members) || !kept.members.includes(user)) continue;
    await redis.set(
      key,
      JSON.stringify({ ...kept, members: kept.members.filter((m) => m !== user) }),
    );
    n++;
  }
  return n;
}

/** What `bun run forget <discord id>` does, with its env and Redis handed in; returns the exit code. */
export async function forgetCli(
  argv: string[],
  env: Record<string, string | undefined>,
  connect: (url: string) => RedisLike & { quit(): Promise<unknown> },
  log: (line: string) => void = console.log,
  warn: (line: string) => void = console.error,
): Promise<number> {
  const user = argv[0];
  if (!user || !/^\d+$/.test(user)) {
    warn("usage: bun run forget <discord id>");
    return 2;
  }
  const url = env.REDIS_URL;
  if (!url) {
    warn("[forget] REDIS_URL is not set: point it at the bot's Redis");
    return 2;
  }
  const redis = connect(url);
  try {
    const n = await forgetUser(redis, user);
    log(`[forget] ${n} bot keys removed`);
    return 0;
  } catch (err) {
    // The error may carry the key, and with it the id.
    warn(`[forget] failed: ${err instanceof Error ? err.name : "error"}`);
    return 1;
  } finally {
    await redis.quit().catch(() => {});
  }
}

if (import.meta.main) {
  const { default: IORedis } = await import("ioredis");
  process.exitCode = await forgetCli(process.argv.slice(2), process.env, (url) => new IORedis(url));
}
