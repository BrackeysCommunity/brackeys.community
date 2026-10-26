import {
  DIRECT_LIMIT,
  MAX_FETCH,
  QUIET_BELOW,
  type Span,
  type SummaryWindow,
  WINDOWS,
  bucketStart,
  planWindow,
  snowflakeAt,
  snowflakeTime,
  splitParts,
} from "./buckets.ts";
import type { ReadHistory } from "./history.ts";
import {
  type ModelUsage,
  PROMPT_VERSION,
  type SummaryModel,
  summaryWords,
  usageCostUsd,
} from "./model.ts";
import { RefTable, fitLinks, numberLinks, resolveLinks, storeLinks } from "./refs.ts";
import { type TranscriptMessage, formatLines, formatStamp, toTranscript } from "./transcript.ts";

/** The commands used, typed structurally so tests can pass a fake. */
export interface SummaryRedis {
  get(key: string): Promise<string | null>;
  mget(...keys: string[]): Promise<(string | null)[]>;
  set(key: string, value: string, mode: "EX", seconds: number): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
}

export interface Summary {
  /** Empty when nothing was said in the window. */
  text: string;
  /** What the summary covers; later than the window's start when `truncated`. */
  from: number;
  to: number;
  messageCount: number;
  truncated: boolean;
  finalCached: boolean;
  buckets: { cached: number; summarized: number; raw: number };
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

interface CachedBucket {
  count: number;
  parts: string[];
}

/** Derived summaries only, never messages, and never kept longer than this. */
const BUCKET_TTL_SECONDS = 30 * 86_400;
/** Several people asking about the same busy channel at once cost one call. */
const FINAL_TTL_SECONDS = 300;
const CHUNK_CONCURRENCY = 6;
/** Discord's embed description limit is 4096; the rest is headroom. */
const MAX_SUMMARY_CHARS = 4_000;

const bucketKey = (channelId: string, bucket: number) =>
  `summarize:v${PROMPT_VERSION}:${channelId}:${bucket}`;
/** Bumped on any deletion in the channel, so cached final answers miss. */
const generationKey = (channelId: string) => `summarize:gen:${channelId}`;

async function quietly<T>(work: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await work();
  } catch {
    return fallback;
  }
}

async function pooled<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const index = next++;
      results[index] = await tasks[index]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

function header(from: number, to: number, count: number, kind: "raw" | "summary") {
  return `### ${formatStamp(from)} – ${formatStamp(to)} UTC · ${count} messages · ${kind}`;
}

export function createSummarizer(deps: {
  redis: SummaryRedis;
  readHistory: ReadHistory;
  model: SummaryModel;
  /** For the message links the summary cites. */
  guildId: string;
}) {
  const { redis, readHistory, model, guildId } = deps;

  /** `[from, to)` newest page first; stops early once `budget` messages are read. */
  async function readRange(channelId: string, from: number, to: number, budget: number) {
    const messages: TranscriptMessage[] = [];
    let before = snowflakeAt(to);
    let read = 0;
    for (;;) {
      const page = await readHistory(channelId, before);
      read += page.length;
      for (const raw of page) {
        if (snowflakeTime(raw.id) < from)
          return { messages: messages.reverse(), read, reached: null };
        const message = toTranscript(raw);
        if (message) messages.push(message);
      }
      if (page.length < 100) return { messages: messages.reverse(), read, reached: null };
      before = page.at(-1)!.id;
      if (read >= budget) {
        return { messages: messages.reverse(), read, reached: snowflakeTime(before) };
      }
    }
  }

  async function summarize(
    channelId: string,
    window: SummaryWindow,
    now = Date.now(),
  ): Promise<Summary> {
    const start = now - WINDOWS[window];
    const usage: ModelUsage[] = [];
    const result = (fields: Partial<Summary>): Summary => ({
      text: "",
      from: start,
      to: now,
      messageCount: 0,
      truncated: false,
      finalCached: false,
      buckets: { cached: 0, summarized: 0, raw: 0 },
      inputTokens: usage.reduce((sum, u) => sum + u.inputTokens, 0),
      outputTokens: usage.reduce((sum, u) => sum + u.outputTokens, 0),
      costUsd: usage.reduce((sum, u) => sum + usageCostUsd(u), 0),
      ...fields,
    });

    const [latest] = await readHistory(channelId, snowflakeAt(now + 1), 1);
    if (!latest || snowflakeTime(latest.id) < start) return result({});

    const generation = (await quietly(() => redis.get(generationKey(channelId)), null)) ?? "0";
    const finalKey = `summarize:final:v${PROMPT_VERSION}:${channelId}:${generation}:${window}:${latest.id}`;
    const cachedFinal = await quietly(() => redis.get(finalKey), null);
    if (cachedFinal) return { ...(JSON.parse(cachedFinal) as Summary), finalCached: true };

    const spans = planWindow(now, WINDOWS[window]);
    const whole = spans.filter((span) => span.bucket !== null);
    const stored = await quietly(
      async () =>
        whole.length ? redis.mget(...whole.map((s) => bucketKey(channelId, s.bucket!))) : [],
      [] as (string | null)[],
    );
    const hits = new Map<Span, CachedBucket>();
    whole.forEach((span, i) => {
      if (stored[i]) hits.set(span, JSON.parse(stored[i]!) as CachedBucket);
    });

    // Contiguous spans with no cached summary are read in one pass each,
    // newest first, so a budget cut drops the oldest part of the window.
    const ranges: Span[][] = [];
    for (const span of spans) {
      if (hits.has(span)) continue;
      const last = ranges.at(-1);
      if (last && last.at(-1)!.to === span.from) last.push(span);
      else ranges.push([span]);
    }
    const fetched = new Map<Span, TranscriptMessage[]>();
    let budget = MAX_FETCH;
    let cut: number | null = null;
    for (const range of ranges.reverse()) {
      const read = await readRange(channelId, range[0].from, range.at(-1)!.to, budget);
      budget -= read.read;
      for (const span of range) {
        fetched.set(
          span,
          read.messages.filter((m) => m.at >= span.from && m.at < span.to),
        );
      }
      if (read.reached !== null) {
        cut = read.reached;
        break;
      }
    }

    const kept = cut === null ? spans : spans.filter((span) => span.to > cut);
    const isPartial = (span: Span) => cut !== null && span.from < cut;
    const count = kept.reduce(
      (sum, span) => sum + (hits.get(span)?.count ?? fetched.get(span)?.length ?? 0),
      0,
    );
    const from = cut ?? start;
    if (count === 0) return result({ from, truncated: cut !== null });

    const buckets = { cached: 0, summarized: 0, raw: 0 };
    type Section =
      | { from: number; to: number; kind: "raw"; messages: TranscriptMessage[] }
      | { from: number; to: number; kind: "summary"; count: number; parts: string[] };
    let sections: Section[];
    if (!kept.some((span) => hits.has(span)) && count <= DIRECT_LIMIT) {
      const all = kept.flatMap((span) => fetched.get(span) ?? []);
      buckets.raw = kept.filter((span) => fetched.get(span)?.length).length;
      sections = [{ from, to: now, kind: "raw", messages: all }];
    } else {
      const work = kept.map((span) => async (): Promise<Section | null> => {
        const hit = hits.get(span);
        if (hit) {
          buckets.cached++;
          return { from: span.from, to: span.to, kind: "summary", ...hit };
        }
        const messages = fetched.get(span) ?? [];
        if (!messages.length) return null;
        if (span.bucket === null || isPartial(span) || messages.length < QUIET_BELOW) {
          buckets.raw++;
          return { from: Math.max(span.from, from), to: span.to, kind: "raw", messages };
        }
        const parts = await Promise.all(
          splitParts(messages).map(async (part) => {
            const refs = new RefTable();
            const reply = await model.chunk(formatLines(part, refs));
            usage.push(reply.usage);
            return storeLinks(reply.text, refs);
          }),
        );
        const entry: CachedBucket = { count: messages.length, parts };
        await quietly(
          () =>
            redis.set(
              bucketKey(channelId, span.bucket!),
              JSON.stringify(entry),
              "EX",
              BUCKET_TTL_SECONDS,
            ),
          null,
        );
        buckets.summarized++;
        return { from: span.from, to: span.to, kind: "summary", count: messages.length, parts };
      });
      sections = (await pooled(work, CHUNK_CONCURRENCY)).filter((s): s is Section => s !== null);
    }

    // Numbered in time order once everything is in, so #1 is the oldest.
    const refs = new RefTable();
    const history = sections
      .map((section) =>
        section.kind === "raw"
          ? `${header(section.from, section.to, section.messages.length, "raw")}\n${formatLines(section.messages, refs)}`
          : `${header(section.from, section.to, section.count, "summary")}\n${numberLinks(section.parts.join("\n\n"), refs)}`,
      )
      .join("\n\n");
    const final = await model.final(history, summaryWords(count));
    usage.push(final.usage);
    const messageUrl = (id: string) => `https://discord.com/channels/${guildId}/${channelId}/${id}`;
    const summary = result({
      text: fitLinks(resolveLinks(final.text, refs, messageUrl), MAX_SUMMARY_CHARS),
      from,
      messageCount: count,
      truncated: cut !== null,
      buckets,
    });
    await quietly(
      () => redis.set(finalKey, JSON.stringify(summary), "EX", FINAL_TTL_SECONDS),
      null,
    );
    return summary;
  }

  /** Drops every cached summary that included one of these messages. */
  async function invalidate(channelId: string, messageIds: string[]): Promise<void> {
    const keys = [
      ...new Set(messageIds.map((id) => bucketKey(channelId, bucketStart(snowflakeTime(id))))),
    ];
    await quietly(async () => {
      if (keys.length) await redis.del(...keys);
      await redis.incr(generationKey(channelId));
      await redis.expire(generationKey(channelId), BUCKET_TTL_SECONDS);
    }, undefined);
  }

  return { summarize, invalidate };
}
