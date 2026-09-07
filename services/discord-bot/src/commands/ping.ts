import type { PublicApi } from "../api.ts";
import { embedReply, type Reply } from "../reply.ts";
import type { CommandContext } from "./context.ts";

/**
 * Proves the whole path — interaction → defer → edge → origin → embed —
 * with the one public read that takes no input, and reports how long the
 * round trip took.
 */
export async function ping(api: PublicApi, ctx: CommandContext): Promise<Reply> {
  const startedAt = performance.now();
  const stats = await api.getBoardStats();
  const ms = Math.round(performance.now() - startedAt);
  return embedReply(
    {
      title: "Pong",
      url: ctx.appUrl,
      description: `${ctx.appUrl} answered in **${ms} ms** · ${stats.open.all} open collab posts`,
    },
    { ephemeral: true },
  );
}
