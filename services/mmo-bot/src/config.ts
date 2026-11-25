function need(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} is required`);
  return v;
}

export interface Config {
  token: string;
  applicationId: string;
  guildId: string;
  /** Every guild the commands are registered to (MMO_GUILD_IDS, comma separated); DISCORD_GUILD_ID alone when unset. */
  guildIds: string[];
  worldUrl: string;
  worldToken: string;
  redisUrl?: string;
  /** The threat line routes stop before; the world's ambush line when unset. */
  threatLine?: number;
  /** The market forum channel (GDD 17.2); no posts when unset. */
  marketForum?: string;
  /** The notice-board forum channel (GDD 17.2); no posts when unset. */
  goalsForum?: string;
  /** The game channel the hunt cards are posted in (GDD 7.6), unless the events channel is set. */
  gameChannel?: string;
  /** The events channel (GDD 17.2): troubles, arc stages, seasons and cities, and the hunt cards. */
  eventsChannel?: string;
  /** The chronicle channel (GDD 12.7, 17.2): one post per closed world day, and each promotion as it happens. */
  chronicleChannel?: string;
  /** The log channel (GDD 14.8, 17.2), by id or name, where a server's settings map none. */
  logChannel?: string;
  /** The opt-in role a raid's start mentions; it must exist and sit below the bot's own role. */
  eventsAlarmRole?: string;
  /** How often the lexicon is read again, so found names reach the cards; unset is LEXICON_REFRESH_MS. */
  lexiconRefreshMs?: number;
  /** The model's key (ANTHROPIC_API_KEY), held by withKey so the config never shows it. */
  anthropicKey?: string;
  /** Narration's master switch: MMO_NARRATION=on. */
  narration: boolean;
  /** The world-wide narration budget a world day, in dollars (MMO_NARRATION_DAY_USD). */
  narrationDayUsd: number;
}

/** The narration budget a world day when MMO_NARRATION_DAY_USD is unset. */
export const NARRATION_DAY_USD = 1;

function integer(name: string): number | undefined {
  const v = process.env[name]?.trim();
  if (!v) return undefined;
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new Error(`${name} must be a whole number, not "${v}"`);
  return n;
}

/** The narration budget a world day from MMO_NARRATION_DAY_USD, or NARRATION_DAY_USD when unset. */
export function narrationDayUsd(env: Record<string, string | undefined> = process.env): number {
  const v = env.MMO_NARRATION_DAY_USD?.trim();
  if (!v) return NARRATION_DAY_USD;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0)
    throw new Error(`MMO_NARRATION_DAY_USD must be a positive number, not "${v}"`);
  return n;
}

const keys = new WeakMap<object, string>();

const KEYED: object = Object.defineProperty({}, "anthropicKey", {
  get(this: object) {
    return keys.get(this);
  },
});

/** A config that holds the key without showing it to JSON, spread or inspection. */
export function withKey<T extends object>(
  config: T,
  key: string | undefined,
): T & { anthropicKey?: string } {
  const out = Object.assign(Object.create(KEYED) as T, config);
  if (key) keys.set(out, key);
  return out;
}

/** The guilds named in MMO_GUILD_IDS, in order and once each, or the primary guild alone. */
export function guildIds(
  primary: string,
  env: Record<string, string | undefined> = process.env,
): string[] {
  const ids = (env.MMO_GUILD_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const id of ids)
    if (!/^\d{1,20}$/.test(id))
      throw new Error(`MMO_GUILD_IDS holds "${id}", not a Discord server id`);
  return ids.length ? [...new Set(ids)] : [primary];
}

/** Reads the bot settings and fails at startup if a required value is missing. */
export function loadConfig(): Config {
  const guildId = need("DISCORD_GUILD_ID");
  const config: Config = {
    token: need("DISCORD_TOKEN"),
    applicationId: need("DISCORD_APP_ID"),
    guildId,
    guildIds: guildIds(guildId),
    worldUrl: process.env.MMO_WORLD_URL?.trim() || "http://localhost:8080",
    worldToken: process.env.MMO_API_TOKEN?.trim() ?? "",
    redisUrl: process.env.REDIS_URL?.trim() || undefined,
    threatLine: integer("MMO_THREAT_LINE"),
    marketForum: process.env.MMO_MARKET_FORUM?.trim() || undefined,
    goalsForum: process.env.MMO_GOALS_FORUM?.trim() || undefined,
    gameChannel: process.env.MMO_GAME_CHANNEL?.trim() || undefined,
    eventsChannel: process.env.MMO_EVENTS_CHANNEL?.trim() || undefined,
    chronicleChannel: process.env.MMO_CHRONICLE_CHANNEL?.trim() || undefined,
    logChannel: process.env.MMO_LOG_CHANNEL?.trim() || undefined,
    eventsAlarmRole: process.env.MMO_EVENTS_ALARM_ROLE?.trim() || undefined,
    lexiconRefreshMs: integer("LEXICON_REFRESH_MS"),
    narration: process.env.MMO_NARRATION?.trim() === "on",
    narrationDayUsd: narrationDayUsd(),
  };
  return withKey(config, process.env.ANTHROPIC_API_KEY?.trim() || undefined);
}
