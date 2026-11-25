import { REST } from "discord.js";

import {
  type CommandRest,
  type SyncResult,
  syncGuildCommands,
} from "../../../packages/discord-kit/src/index.ts";
import type { Config } from "./config.ts";
import { MANIFEST } from "./manifest.ts";

/**
 * The guild commands in every guild the bot serves (MMO_GUILD_IDS), each
 * diffed before its PUT. One guild's failure is logged and the rest are
 * still registered.
 */
export async function registerGuilds(
  rest: CommandRest,
  config: Pick<Config, "applicationId" | "guildIds">,
  force = false,
  log: (line: string) => void = console.log,
): Promise<Map<string, SyncResult | Error>> {
  const out = new Map<string, SyncResult | Error>();
  for (const guildId of config.guildIds) {
    try {
      out.set(
        guildId,
        await syncGuildCommands(rest, {
          applicationId: config.applicationId,
          guildId,
          commands: [...MANIFEST],
          force,
          log: (line) => log(`${line} (guild ${guildId})`),
        }),
      );
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      log(`[register] guild ${guildId} failed: ${err.message}`);
      out.set(guildId, err);
    }
  }
  return out;
}

export function registerCommands(config: Config, force = false) {
  return registerGuilds(new REST().setToken(config.token), config, force);
}

/** `bun run register [--force]`. */
if (import.meta.main) {
  const { loadConfig } = await import("./config.ts");
  const results = await registerCommands(loadConfig(), process.argv.includes("--force"));
  for (const [guild, r] of results)
    console.log(`[register] ${guild}: ${r instanceof Error ? `failed: ${r.message}` : r}`);
  if ([...results.values()].some((r) => r instanceof Error)) process.exitCode = 1;
}
