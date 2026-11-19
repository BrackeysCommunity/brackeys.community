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
  };
}
