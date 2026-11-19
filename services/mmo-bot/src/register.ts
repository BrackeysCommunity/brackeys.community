import { REST } from "discord.js";

import { syncGuildCommands } from "../../../packages/discord-kit/src/index.ts";
import type { Config } from "./config.ts";
import { MANIFEST } from "./manifest.ts";

/** The guild commands, diffed before a PUT. */
export function registerCommands(config: Config, force = false) {
  return syncGuildCommands(new REST().setToken(config.token), {
    applicationId: config.applicationId,
    guildId: config.guildId,
    commands: [...MANIFEST],
    force,
    log: console.log,
  });
}

/** `bun run register [--force]`. */
if (import.meta.main) {
  const { loadConfig } = await import("./config.ts");
  const result = await registerCommands(loadConfig(), process.argv.includes("--force"));
  console.log(`[register] ${result}`);
}
