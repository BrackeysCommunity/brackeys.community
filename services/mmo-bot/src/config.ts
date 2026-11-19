/**
 * The bot's settings, from the environment. A missing required one stops
 * the bot at boot with its name, never with a default that points
 * somewhere real.
 */
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
  threatLine: number;
}

export function loadConfig(): Config {
  return {
    token: need("DISCORD_TOKEN"),
    applicationId: need("DISCORD_APP_ID"),
    guildId: need("DISCORD_GUILD_ID"),
    worldUrl: process.env.MMO_WORLD_URL?.trim() || "http://localhost:8080",
    worldToken: process.env.MMO_API_TOKEN?.trim() ?? "",
    redisUrl: process.env.REDIS_URL?.trim() || undefined,
    threatLine: Number(process.env.MMO_THREAT_LINE ?? 600),
  };
}
