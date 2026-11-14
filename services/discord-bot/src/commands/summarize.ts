import Anthropic from "@anthropic-ai/sdk";

import { DiscordBackoffError } from "../../../../src/lib/discord-guard.ts";
import { clampEmbed, EMBED_TITLE_MAX, notFound, plural, type Reply, truncate } from "../reply.ts";
import { SINCE_MINE, type SummaryWindow } from "../summarize/buckets.ts";
import { ChannelUnreadableError } from "../summarize/history.ts";
import { SummaryRefusedError } from "../summarize/model.ts";
import { type PageSet, paginate, type SummaryPages } from "../summarize/pages.ts";
import type { Summary, SummaryOptions } from "../summarize/summarizer.ts";
import { formatStamp } from "../summarize/transcript.ts";
import { pagerButtons } from "./format.ts";

export type Summarize = (
  channelId: string,
  window: SummaryWindow,
  options: Pick<SummaryOptions, "question" | "requesterId" | "requesterName" | "shared">,
) => Promise<Summary>;

/** Discord's option cap; also keeps the question a question rather than a prompt dump. */
export const QUESTION_MAX = 300;

/**
 * Past this the member gets an answer, not a spinner; the work finishes
 * into the cache. Discord stops taking the reply 15 minutes after the
 * command, and a private answer at its full length needs most of that.
 */
export const SUMMARY_TIMEOUT_MS = 12 * 60_000;

const SUMMARY_COLOR = 0x5865f2;

/** What the window covered: "the last 24h", or for since-I-last-posted the
 *  longest window, which it falls back to when the caller hadn't posted. */
function coveredSpan(window: SummaryWindow): string {
  return `the last ${window === SINCE_MINE ? "7 days" : window}`;
}

/**
 * A summary that couldn't be made for a reason that isn't a bug. Carries
 * the line the member sees, so the adapter's failure path can show it
 * instead of the site-outage copy.
 */
export class SummaryUnavailableError extends Error {
  constructor(
    readonly reason: "unreadable" | "busy" | "refused" | "slow" | "expired",
    readonly userMessage: string,
  ) {
    super(`summary unavailable: ${reason}`);
    this.name = "SummaryUnavailableError";
  }
}

function unavailable(error: unknown): SummaryUnavailableError | null {
  if (error instanceof ChannelUnreadableError) {
    return new SummaryUnavailableError("unreadable", "I can't read this channel's history.");
  }
  if (error instanceof DiscordBackoffError) {
    return new SummaryUnavailableError(
      "busy",
      "Discord is rate-limiting the bot right now. Try again in a few minutes.",
    );
  }
  if (error instanceof SummaryRefusedError) {
    return new SummaryUnavailableError("refused", "The summarizer declined this stretch of chat.");
  }
  if (
    error instanceof Anthropic.RateLimitError ||
    error instanceof Anthropic.APIConnectionError ||
    (error instanceof Anthropic.APIError && (error.status ?? 0) >= 500)
  ) {
    return new SummaryUnavailableError(
      "busy",
      "The summarizer is busy right now. Try again in a minute.",
    );
  }
  return null;
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new SummaryUnavailableError(
            "slow",
            "That took too long. Try again shortly (it will be quicker), or pick a shorter window.",
          ),
        ),
      ms,
    );
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

export async function summarizeChannel(
  summarize: Summarize,
  input: {
    channelId: string;
    window: SummaryWindow;
    share: boolean;
    question?: string;
    requesterId?: string;
    requesterName?: string;
  },
  { pages, timeoutMs = SUMMARY_TIMEOUT_MS }: { pages?: SummaryPages; timeoutMs?: number } = {},
): Promise<Reply> {
  let summary: Summary;
  try {
    summary = await withTimeout(
      summarize(input.channelId, input.window, {
        question: input.question,
        requesterId: input.requesterId,
        requesterName: input.requesterName,
        shared: input.share,
      }),
      timeoutMs,
    );
  } catch (error) {
    throw unavailable(error) ?? error;
  }

  if (!summary.text) {
    return notFound(
      summary.sinceLastPost
        ? "Nothing new here since you last posted."
        : `Nothing was said here in ${coveredSpan(input.window)}.`,
    );
  }

  const span = `${formatStamp(summary.from)} – ${formatStamp(summary.to)} UTC`;
  const noPost =
    summary.sinceLastPost === false ? " · You haven't posted here in the last 7 days" : "";
  const footer = summary.truncated
    ? `Newest ${plural(summary.messageCount, "message")} only · ${span}${noPost}`
    : `${plural(summary.messageCount, "message")} · ${span}${noPost}`;
  const title = input.question
    ? truncate(`“${input.question}”`, EMBED_TITLE_MAX)
    : `Catch-up: ${summary.sinceLastPost ? "since you last posted" : coveredSpan(input.window)}`;
  const set: PageSet = {
    channelId: input.channelId,
    title,
    footer: `${footer} · AI summary, may miss things`,
    pages: paginate(summary.text),
  };
  const token = set.pages.length > 1 ? ((await pages?.save(set)) ?? null) : null;
  return summaryPage(set, 0, token, !input.share);
}

/**
 * One page of a summary. A reply never carries more than one: Discord
 * rejects a message whose embeds pass 6000 characters between them.
 * Without a token the rest couldn't be kept, and the footer says so
 * rather than offering buttons that would go nowhere.
 */
function summaryPage(set: PageSet, page: number, token: string | null, ephemeral: boolean): Reply {
  const count = set.pages.length;
  const at = Math.min(Math.max(page, 0), count - 1);
  const position =
    count === 1
      ? ""
      : token
        ? `Page ${at + 1}/${count} · `
        : `Page 1/${count}, the rest couldn't be kept: run it again · `;
  return {
    embeds: [
      clampEmbed({
        title: set.title,
        description: set.pages[at],
        color: SUMMARY_COLOR,
        footer: `${position}${set.footer}`,
      }),
    ],
    buttons: token ? pagerButtons({ kind: "summary", token, page: at }, count) : [],
    ephemeral,
    outcome: "hit",
  };
}

/** A press on a summary's page buttons. */
export async function summaryPageTurn(
  pages: SummaryPages | undefined,
  state: { token: string; page: number },
  ephemeral: boolean,
): Promise<Reply> {
  const set = await pages?.load(state.token);
  if (!set) {
    throw new SummaryUnavailableError(
      "expired",
      "The rest of this one is no longer kept. Run the command again for a fresh copy.",
    );
  }
  return summaryPage(set, state.page, state.token, ephemeral);
}
