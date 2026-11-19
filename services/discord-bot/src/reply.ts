import { type Button, clampEmbed, type Embed } from "../../../packages/discord-kit/src/embed.ts";

export * from "../../../packages/discord-kit/src/embed.ts";

/**
 * What a command answers with, as plain data. Commands build one of these
 * and never see a discord.js interaction; `discord/adapter.ts` is the only
 * file that turns it into a message. That split is what lets the command
 * layer run under `bun test` against a fake API with a fixed clock.
 */

export interface Reply {
  content?: string;
  embeds: Embed[];
  buttons: Button[];
  ephemeral: boolean;
  /** Plain-text reply notice shown in the first embed's footer. */
  notice?: string;
  /** What the API said, for the command telemetry. Thrown errors carry the
   *  other two outcomes. */
  outcome: "hit" | "not_found";
}

/**
 * The site as a member knows it: the production domain in prod, the
 * staging host on staging. Every user-facing mention of the site
 * derives from `APP_URL` through this, so the copy cannot name a domain the
 * bot is not actually talking to.
 */
export function siteName(appUrl: string): string {
  try {
    return new URL(appUrl).host.replace(/^www\./, "");
  } catch {
    return appUrl;
  }
}

export function embedReply(
  embed: Embed,
  options: { buttons?: Button[]; ephemeral: boolean; outcome?: Reply["outcome"] },
): Reply {
  return {
    embeds: [clampEmbed(embed)],
    buttons: options.buttons ?? [],
    ephemeral: options.ephemeral,
    outcome: options.outcome ?? "hit",
  };
}

/** A short ephemeral line — "no such jam", "run the command again". */
export function textReply(content: string, outcome: Reply["outcome"] = "hit"): Reply {
  return { content, embeds: [], buttons: [], ephemeral: true, outcome };
}

export function notFound(content: string): Reply {
  return textReply(content, "not_found");
}

/**
 * Attach a notice to a reply, folding it into the first embed's footer.
 * A reply with no embed carries it as content instead — a refusal has to
 * be visible even when the answer is one line of text.
 */
export function withNotice(reply: Reply, notice: string): Reply {
  const [first, ...rest] = reply.embeds;
  if (!first) {
    return { ...reply, content: reply.content ? `${reply.content}\n-# ${notice}` : notice };
  }
  const footer = first.footer ? `${first.footer} · ${notice}` : notice;
  return { ...reply, embeds: [clampEmbed({ ...first, footer }), ...rest], notice };
}
