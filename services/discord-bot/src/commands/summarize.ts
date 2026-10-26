import Anthropic from "@anthropic-ai/sdk";

import { DiscordBackoffError } from "../../../../src/lib/discord-guard.ts";
import { embedReply, notFound, plural, type Reply } from "../reply.ts";
import type { SummaryWindow } from "../summarize/buckets.ts";
import { ChannelUnreadableError } from "../summarize/history.ts";
import { SummaryRefusedError } from "../summarize/model.ts";
import type { Summary } from "../summarize/summarizer.ts";
import { formatStamp } from "../summarize/transcript.ts";

export type Summarize = (channelId: string, window: SummaryWindow) => Promise<Summary>;

/** Past this the member gets an answer, not a spinner; the work finishes into the cache. */
export const SUMMARY_TIMEOUT_MS = 60_000;

const SUMMARY_COLOR = 0x5865f2;

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
  input: { channelId: string; window: SummaryWindow; share: boolean },
  timeoutMs = SUMMARY_TIMEOUT_MS,
): Promise<Reply> {
  let summary: Summary;
  try {
    summary = await withTimeout(summarize(input.channelId, input.window), timeoutMs);
  } catch (error) {
    throw unavailable(error) ?? error;
  }

  if (!summary.text) return notFound(`Nothing was said here in the last ${input.window}.`);

  const span = `${formatStamp(summary.from)} – ${formatStamp(summary.to)} UTC`;
  const footer = summary.truncated
    ? `Newest ${plural(summary.messageCount, "message")} only · ${span}`
    : `${plural(summary.messageCount, "message")} · ${span}`;
  return embedReply(
    {
      title: `Catch-up: the last ${input.window}`,
      description: summary.text,
      color: SUMMARY_COLOR,
      footer: `${footer} · AI summary, may miss things`,
    },
    { ephemeral: !input.share },
  );
}
