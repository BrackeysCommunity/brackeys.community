import type { BotCommand } from "@/data/commands";

/**
 * Build the Discord slash-command string a user copies: `/cmd opt1: opt2:`.
 *
 * Options naming a person (`mention`, `user`) are filled with the signed-in
 * user's handle when there is one, and dropped entirely when there isn't —
 * a bare `mention:` placeholder is not a runnable command.
 */
export function buildCopyText(command: BotCommand, username?: string): string {
  if (!command.options?.length) return command.cmd;
  const opts = command.options
    .filter((o) => username || !["mention", "user"].includes(o.name))
    .map((o) =>
      ["mention", "user"].includes(o.name) && username
        ? `${o.name}:@${username}`
        : `${o.name}:${o.default}`,
    )
    .join(" ");
  return opts ? `${command.cmd} ${opts}` : command.cmd;
}
