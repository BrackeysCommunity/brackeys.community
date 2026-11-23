function need(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} is required`);
  return v;
}

export interface Config {
  token: string;
  applicationId: string;
  guildId: string;
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
  /** The opt-in role a raid's start mentions; it must exist and sit below the bot's own role. */
  eventsAlarmRole?: string;
  /** How often the lexicon is read again, so found names reach the cards; unset is LEXICON_REFRESH_MS. */
  lexiconRefreshMs?: number;
}

function integer(name: string): number | undefined {
  const v = process.env[name]?.trim();
  if (!v) return undefined;
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new Error(`${name} must be a whole number, not "${v}"`);
  return n;
}

/** Reads the bot settings and fails at startup if a required value is missing. */
export function loadConfig(): Config {
  return {
    token: need("DISCORD_TOKEN"),
    applicationId: need("DISCORD_APP_ID"),
    guildId: need("DISCORD_GUILD_ID"),
    worldUrl: process.env.MMO_WORLD_URL?.trim() || "http://localhost:8080",
    worldToken: process.env.MMO_API_TOKEN?.trim() ?? "",
    redisUrl: process.env.REDIS_URL?.trim() || undefined,
    threatLine: integer("MMO_THREAT_LINE"),
    marketForum: process.env.MMO_MARKET_FORUM?.trim() || undefined,
    goalsForum: process.env.MMO_GOALS_FORUM?.trim() || undefined,
    gameChannel: process.env.MMO_GAME_CHANNEL?.trim() || undefined,
    eventsChannel: process.env.MMO_EVENTS_CHANNEL?.trim() || undefined,
    chronicleChannel: process.env.MMO_CHRONICLE_CHANNEL?.trim() || undefined,
    eventsAlarmRole: process.env.MMO_EVENTS_ALARM_ROLE?.trim() || undefined,
    lexiconRefreshMs: integer("LEXICON_REFRESH_MS"),
  };
}
