import { REST } from "discord.js";

import { syncGuildCommands } from "../../../packages/discord-kit/src/index.ts";
import { loadConfig } from "./config.ts";
import { MANIFEST } from "./manifest.ts";

/** `bun run register [--force]`: the guild commands, diffed before a PUT. */
const config = loadConfig();
const rest = new REST().setToken(config.token);
const result = await syncGuildCommands(rest, {
  applicationId: config.applicationId,
  guildId: config.guildId,
  commands: MANIFEST,
  force: process.argv.includes("--force"),
  log: console.log,
});
console.log(`[register] ${result}`);
