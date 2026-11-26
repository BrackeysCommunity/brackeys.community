import { REST } from "discord.js";

import {
  type CommandRest,
  type SyncResult,
  syncGlobalCommands,
  syncGuildCommands,
} from "../../../packages/discord-kit/src/index.ts";
import type { CommandScope, Config } from "./config.ts";
import { MANIFEST } from "./manifest.ts";

/** The key a global registration is reported under, beside the guild ids. */
export const GLOBAL = "global";

/**
 * The guild commands in every guild the bot serves (MMO_GUILD_IDS), each
 * diffed before its PUT. One guild's failure is logged and the rest are
 * still registered. With clear, each guild's own commands are emptied
 * instead, so a server does not show the global ones twice.
 */
export async function registerGuilds(
  rest: CommandRest,
  config: Pick<Config, "applicationId" | "guildIds">,
  force = false,
  log: (line: string) => void = console.log,
  clear = false,
): Promise<Map<string, SyncResult | Error>> {
  const out = new Map<string, SyncResult | Error>();
  for (const guildId of config.guildIds) {
    try {
      out.set(
        guildId,
        await syncGuildCommands(rest, {
          applicationId: config.applicationId,
          guildId,
          commands: clear ? [] : [...MANIFEST],
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

export interface RegisterPlan {
  scope: CommandScope;
  force?: boolean;
  /** Empty the guild commands of every guild in MMO_GUILD_IDS. */
  clearGuilds?: boolean;
}

/**
 * Registers the manifest where the plan's scope says: globally, or to each
 * guild. Clearing the guilds replaces guild registration, so in the guild
 * scope it only clears.
 */
export async function register(
  rest: CommandRest,
  config: Pick<Config, "applicationId" | "guildIds">,
  plan: RegisterPlan,
  log: (line: string) => void = console.log,
): Promise<Map<string, SyncResult | Error>> {
  const out = new Map<string, SyncResult | Error>();
  if (plan.scope === "global") {
    try {
      out.set(
        GLOBAL,
        await syncGlobalCommands(rest, config.applicationId, [...MANIFEST], {
          force: plan.force,
          log,
        }),
      );
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      log(`[register] global failed: ${err.message}`);
      out.set(GLOBAL, err);
    }
  }
  if (plan.scope === "guild" || plan.clearGuilds)
    for (const [k, v] of await registerGuilds(rest, config, plan.force, log, plan.clearGuilds))
      out.set(k, v);
  return out;
}

/** What `bun run register` was asked: --force, --global, --clear-guilds. */
export function registerPlan(argv: readonly string[], scope: CommandScope): RegisterPlan {
  for (const a of argv)
    if (!["--force", "--global", "--clear-guilds"].includes(a))
      throw new Error(`usage: bun run register [--force] [--global] [--clear-guilds], not "${a}"`);
  return {
    scope: argv.includes("--global") ? "global" : scope,
    force: argv.includes("--force"),
    clearGuilds: argv.includes("--clear-guilds"),
  };
}

/** The bot's own registration at ready: MMO_COMMANDS's scope, diffed. */
export function registerCommands(config: Config, force = false) {
  return register(new REST().setToken(config.token), config, { scope: config.commands, force });
}

/** `bun run register [--force] [--global] [--clear-guilds]`. */
if (import.meta.main) {
  const { loadConfig } = await import("./config.ts");
  // --global needs no DISCORD_GUILD_ID, as MMO_COMMANDS=global does not.
  if (process.argv.includes("--global")) process.env.MMO_COMMANDS = "global";
  const config = loadConfig();
  const plan = registerPlan(process.argv.slice(2), config.commands);
  const results = await register(new REST().setToken(config.token), config, plan);
  for (const [where, r] of results)
    console.log(`[register] ${where}: ${r instanceof Error ? `failed: ${r.message}` : r}`);
  if ([...results.values()].some((r) => r instanceof Error)) process.exitCode = 1;
}
