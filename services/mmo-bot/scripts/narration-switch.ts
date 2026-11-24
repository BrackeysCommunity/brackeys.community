import IORedis from "ioredis";

import { USES, type UseId } from "../../../packages/mmo-narrate/src/index.ts";
import { SWITCH_KEY, type SwitchLevels } from "../src/narration/switch.ts";

/**
 * The narration switch (`mmo-narr:switch`), as the operator flips it:
 *
 *   bun run scripts/narration-switch.ts status
 *   bun run scripts/narration-switch.ts all on|off
 *   bun run scripts/narration-switch.ts use <use> on|off
 *   bun run scripts/narration-switch.ts server <guild id> on|off
 *
 * It reads REDIS_URL and nothing else. The master switch is the bot's own
 * MMO_NARRATION=on with its key and Redis; the bot reads a flip within SWITCH_CACHE_MS.
 */

export type SwitchCommand =
  | { kind: "status" }
  | { kind: "set"; field: string; value: "on" | "off" };

const USAGE =
  "usage: narration-switch.ts status | all on|off | use <use> on|off | server <guild id> on|off";

export function parseSwitch(args: readonly string[]): SwitchCommand | string {
  const [what, a, b] = args;
  const onOff = (v: string | undefined) => (v === "on" || v === "off" ? v : null);
  switch (what) {
    case "status":
      return args.length === 1 ? { kind: "status" } : USAGE;
    case "all": {
      const v = onOff(a);
      return v && args.length === 2 ? { kind: "set", field: "all", value: v } : USAGE;
    }
    case "use": {
      const v = onOff(b);
      if (!v || args.length !== 3) return USAGE;
      if (!(USES as readonly string[]).includes(a ?? ""))
        return `unknown use "${a}"; the uses are ${USES.join(", ")}`;
      return { kind: "set", field: `use:${a}`, value: v };
    }
    case "server": {
      const v = onOff(b);
      if (!v || args.length !== 3) return USAGE;
      if (!/^\d{1,20}$/.test(a ?? "")) return `"${a}" is not a Discord server id`;
      return { kind: "set", field: `server:${a}`, value: v };
    }
    default:
      return USAGE;
  }
}

/** The switch's state in lines: the world-wide level, each use's, and each server's. */
export function statusLines(levels: SwitchLevels): string[] {
  const level = (v: string | undefined, dflt: "on" | "off") =>
    v === "on" || v === "off" ? v : `${dflt} (unset)`;
  const servers = Object.entries(levels)
    .filter(([k]) => k.startsWith("server:"))
    .map(([k, v]) => `  ${k.slice("server:".length)}: ${level(v, "off")}`)
    .sort();
  return [
    "master: MMO_NARRATION=on with ANTHROPIC_API_KEY and REDIS_URL on the bot process",
    `all: ${level(levels.all, "on")}`,
    "uses:",
    ...USES.map((u: UseId) => `  ${u}: ${level(levels[`use:${u}`], "on")}`),
    "servers (off unless on):",
    ...(servers.length ? servers : ["  none on"]),
  ];
}

if (import.meta.main) {
  const cmd = parseSwitch(process.argv.slice(2));
  if (typeof cmd === "string") {
    console.error(cmd);
    process.exit(2);
  }
  const url = process.env.REDIS_URL?.trim();
  if (!url) {
    console.error("REDIS_URL is not set");
    process.exit(2);
  }
  const redis = new IORedis(url, { maxRetriesPerRequest: 1, lazyConnect: true });
  try {
    await redis.connect();
    if (cmd.kind === "set") await redis.hset(SWITCH_KEY, cmd.field, cmd.value);
    for (const line of statusLines(await redis.hgetall(SWITCH_KEY))) console.log(line);
  } catch (e) {
    console.error(`redis: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  } finally {
    redis.disconnect();
  }
}
