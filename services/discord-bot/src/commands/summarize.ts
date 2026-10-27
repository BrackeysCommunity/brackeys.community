import Anthropic from "@anthropic-ai/sdk";

import { DiscordBackoffError } from "../../../../src/lib/discord-guard.ts";
import {
  clampEmbed,
  EMBED_DESCRIPTION_MAX,
  EMBED_TITLE_MAX,
  notFound,
  plural,
  type Reply,
  truncate,
} from "../reply.ts";
import { SINCE_MINE, type SummaryWindow } from "../summarize/buckets.ts";
import { ChannelUnreadableError } from "../summarize/history.ts";
import { SummaryRefusedError } from "../summarize/model.ts";
import type { Summary } from "../summarize/summarizer.ts";
import { formatStamp } from "../summarize/transcript.ts";

export type Summarize = (
  channelId: string,
  window: SummaryWindow,
  options: { question?: string; requesterId?: string },
) => Promise<Summary>;

/** Discord's option cap; also keeps the question a question rather than a prompt dump. */
export const QUESTION_MAX = 300;

/** Past this the member gets an answer, not a spinner; the work finishes into the cache. */
export const SUMMARY_TIMEOUT_MS = 60_000;

const SUMMARY_COLOR = 0x5865f2;

/**
 * A long summary as one or two embed descriptions, split at the last line
 * break that fits, so a cut never lands inside a bullet or a link.
 */
/** What the window covered: "the last 24h", or for since-I-last-posted the
 *  longest window, which it falls back to when the caller hadn't posted. */
function coveredSpan(window: SummaryWindow): string {
  return `the last ${window === SINCE_MINE ? "7 days" : window}`;
}

export function splitSummary(text: string, max = EMBED_DESCRIPTION_MAX): string[] {
  if (text.length <= max) return [text];
  const cut = text.lastIndexOf("\n", max);
  const at = cut > 0 ? cut : max;
  return [text.slice(0, at).trimEnd(), ...splitSummary(text.slice(at).trimStart(), max)];
}

/**
 * A summary that couldn't be made for a reason that isn't a bug. Carries
 * the line the member sees, so the adapter's failure path can show it
 * instead of the site-outage copy.
 */
export class SummaryUnavailableError extends Error {
  constructor(
    readonly reason: "unreadable" | "busy" | "refused" | "slow",
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
  },
  timeoutMs = SUMMARY_TIMEOUT_MS,
): Promise<Reply> {
  let summary: Summary;
  try {
    summary = await withTimeout(
      summarize(input.channelId, input.window, {
        question: input.question,
        requesterId: input.requesterId,
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
  const pages = splitSummary(summary.text);
  return {
    embeds: pages.map((description, i) =>
      clampEmbed({
        title: i === 0 ? title : undefined,
        description,
        color: SUMMARY_COLOR,
        footer: i === pages.length - 1 ? `${footer} · AI summary, may miss things` : undefined,
      }),
    ),
    buttons: [],
    ephemeral: !input.share,
    outcome: "hit",
  };
}
