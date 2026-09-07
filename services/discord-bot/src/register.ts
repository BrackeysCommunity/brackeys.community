import { REST } from "discord.js";

import { buildManifest } from "./commands/manifest.ts";
import { config } from "./config.ts";
import { syncGuildCommands } from "./discord/register.ts";

/**
 * `bun run register [--force]` — the same diff-then-PUT the service runs at
 * boot, without a gateway connection. `--force` skips the diff.
 */
const rest = new REST().setToken(config.DISCORD_BOT_TOKEN);
const result = await syncGuildCommands(rest, {
  applicationId: config.DISCORD_APPLICATION_ID,
  guildId: config.DISCORD_GUILD_ID,
  commands: buildManifest(),
  force: process.argv.includes("--force"),
  log: console.log,
});
console.log(`[register] ${result}`);
